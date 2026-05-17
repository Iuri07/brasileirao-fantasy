import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getFotos,
  getRodadaStatus,
  isRodadaEmAndamento,
  MAX_SUBS_AO_VIVO,
} from "../../lib/kv.ts";
import { getMelhorTimeCached } from "../../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../../lib/historico.ts";
import TopBar from "../../components/TopBar.tsx";
import BottomNav from "../../components/BottomNav.tsx";
import TeamCrest from "../../components/TeamCrest.tsx";
import SectionHeader from "../../components/SectionHeader.tsx";
import Field, { type Escalacao, type Pino } from "../../components/Field.tsx";
import { escudoUrl } from "../../lib/escudos.ts";
import { coresClube } from "../../lib/cores.ts";
import { fotoUrl } from "../../lib/fotos.ts";
import { timeLigaInfo } from "../../lib/times-liga.ts";

const POS_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

interface Data {
  chave: string;
  nome: string;
  dono: string;
  rodada: number;
  pontuacaoRodada: number;
  total: number;
  rodadasJogadas: number;
  posicao: number | null;
  totalTimes: number;
  escalacao: Escalacao | null;
  aoVivo: boolean;
  subsAplicadas: number;
  subsMax: number;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

import type { State } from "../_middleware.ts";

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const { chave } = ctx.params;
    const meta = CHAVES_TIMES[chave];
    if (!meta) return new Response("Not found", { status: 404 });

    const kv = await Deno.openKv();
    const [elencos, rodada, fotos, historico] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
      getFotos(kv),
      getHistorico(kv, chave),
    ]);

    const elenco = elencos[chave];
    if (!elenco) return new Response("Elenco não seedado", { status: 404 });

    // Melhor time pra ranking + escalação (cache hit = quase gratuito)
    const melhoresPorChave = new Map<
      string,
      Awaited<ReturnType<typeof getMelhorTimeCached>>
    >();
    await Promise.all(
      Object.entries(elencos).map(async ([k, e]) => {
        const r = await getMelhorTimeCached(kv, k, e);
        melhoresPorChave.set(k, r);
      }),
    );

    const ranking = Object.keys(elencos)
      .map((k) => {
        const escalados = (melhoresPorChave.get(k) ?? [])
          .filter((j) => j.escalacao === "Sim");
        const pts = Math.round(
          escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
        ) / 100;
        return { chave: k, pts };
      })
      .sort((a, b) => b.pts - a.pts);
    const posicao = ranking.findIndex((t) => t.chave === chave) + 1;

    // Escalação do time (com auto-subs aplicadas pelo algoritmo, máx 3)
    const calculados = melhoresPorChave.get(chave) ?? [];
    const escalados = calculados.filter((j) => j.escalacao === "Sim");
    const subsAplicadas = escalados.filter((j) => j.substituido).length;
    const ptsRodada = Math.round(
      escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
    ) / 100;

    const pino = (j: typeof escalados[number]): Pino => ({
      nome: j.apelido_api,
      pts: j.pontos,
      escudo: escudoUrl(j.clube),
      cores: coresClube(j.clube),
      pos: POS_ABREV[j.posicao],
      statusId: j.status_id,
      foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
      subEntrou: j.substituido,
    });
    const gk = escalados.find((j) => j.posicao === "Goleiro");
    const def = escalados.filter((j) =>
      j.posicao === "Zagueiro" || j.posicao === "Lateral"
    );
    const mid = escalados.filter((j) => j.posicao === "Meia");
    const ata = escalados.filter((j) => j.posicao === "Atacante");
    const escalacao: Escalacao = {
      gk: gk ? pino(gk) : {},
      def: def.map(pino),
      mid: mid.map(pino),
      ata: ata.map(pino),
    };

    return ctx.render({
      chave,
      nome: meta.nome_time,
      dono: meta.dono,
      rodada: rodada?.rodada ?? 0,
      pontuacaoRodada: ptsRodada,
      total: totalPontos(historico),
      rodadasJogadas: Object.keys(historico).length,
      posicao: posicao || null,
      totalTimes: ranking.length,
      escalacao: escalados.length ? escalacao : null,
      aoVivo: isRodadaEmAndamento(rodada?.status),
      subsAplicadas,
      subsMax: MAX_SUBS_AO_VIVO,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function TimeDetalhe({ data }: PageProps<Data>) {
  const visual = timeLigaInfo(data.chave);
  const displayName = visual?.displayName ?? data.nome;
  const ptsRodadaFmt = data.pontuacaoRodada.toFixed(1).replace(".", ",");

  return (
    <>
      <Head>
        <title>{displayName} · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=123" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <article class="bf-card bf-status-card">
          <div class="bf-status-card__top">
            <TeamCrest chave={data.chave} size={56} />
            <div class="bf-status-card__name">
              <h3>{displayName}</h3>
              <span class="bf-status-card__sub">{data.dono}</span>
            </div>
            <div class="bf-status-card__rank">
              {data.posicao ? `${data.posicao}º` : "—"}
            </div>
          </div>

          <div class="bf-status-card__metrics">
            <div class="bf-status-card__metric">
              <span class="bf-label-micro">Rodada {data.rodada}</span>
              <span class="bf-status-card__metric-value">{ptsRodadaFmt}</span>
              <span class="bf-status-card__metric-foot">parcial</span>
            </div>
            <div class="bf-status-card__divider"></div>
            <div class="bf-status-card__metric">
              <span class="bf-label-micro">Total</span>
              <span class="bf-status-card__metric-value bf-status-card__metric-value--sm">
                {data.rodadasJogadas > 0
                  ? data.total.toFixed(1).replace(".", ",")
                  : "—"}
              </span>
              <span class="bf-status-card__metric-foot">
                {data.rodadasJogadas > 0
                  ? `${data.rodadasJogadas} rodadas`
                  : "sem histórico"}
              </span>
            </div>
          </div>
        </article>

        <SectionHeader
          right={data.aoVivo
            ? (
              <span
                class={`bf-pill bf-pill--timing-${
                  data.subsAplicadas >= data.subsMax ? "danger" : "normal"
                }`}
              >
                <span class="bf-pill__lbl">Subs</span>
                <span class="bf-pill__val">
                  {data.subsAplicadas}/{data.subsMax}
                </span>
              </span>
            )
            : null}
        >
          Escalacao
        </SectionHeader>
        {data.escalacao
          ? (
            <Field
              jogadores={data.escalacao}
              showPoints
              accent={visual?.accent}
            />
          )
          : <div class="bf-empty-state">Sem escalação no elenco</div>}

        <BottomNav active="liga" />
      </div>
    </>
  );
}
