import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  getAllElencos,
  getFotos,
  getRodadaStatus,
  MAX_SUBS_AO_VIVO,
} from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../lib/historico.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import Field, {
  type BancoPino,
  type Escalacao,
  type Pino,
} from "../components/Field.tsx";
import CollapsibleTeamRow from "../islands/CollapsibleTeamRow.tsx";
import LeagueChart, { type LinhaTime } from "../islands/LeagueChart.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";

const CHAVE_USUARIO = "aguiar";

const POS_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

interface TimeLinha {
  chave: string;
  nome: string;
  dono: string;
  pontuacaoRodada: number;
  total: number;
  rodadasJogadas: number;
  escalacao: Escalacao | null;
  banco: BancoPino[];
  historico: Record<string, number>;
  subsAplicadas: number;
}

interface Data {
  rodada: number;
  aoVivo: boolean;
  subsMax: number;
  times: TimeLinha[];
  meuChave: string;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

import type { State } from "./_middleware.ts";

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, rodada, fotos] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
      getFotos(kv),
    ]);

    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const calculados = calcularMelhorTime(Object.values(elenco.jogadores));
      const escalados = calculados.filter((j) => j.escalacao === "Sim");
      const reservas = calculados.filter((j) => j.escalacao === "Banco");
      const subsAplicadas = escalados.filter((j) => j.substituido).length;
      const banco: BancoPino[] = reservas.map((j) => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        posicao: j.posicao,
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        subSaiu: j.descido === true,
      }));
      const ptsRodada = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      const historico = await getHistorico(kv, chave);

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
      const escalacao: Escalacao | null = escalados.length
        ? {
          gk: gk ? pino(gk) : {},
          def: def.map(pino),
          mid: mid.map(pino),
          ata: ata.map(pino),
        }
        : null;

      times.push({
        chave,
        nome: elenco.nome_time,
        dono: elenco.dono,
        pontuacaoRodada: ptsRodada,
        total: totalPontos(historico),
        rodadasJogadas: Object.keys(historico).length,
        escalacao,
        banco,
        historico,
        subsAplicadas,
      });
    }

    times.sort((a, b) =>
      b.total - a.total || b.pontuacaoRodada - a.pontuacaoRodada
    );

    return ctx.render({
      rodada: rodada?.rodada ?? 0,
      aoVivo: rodada?.status === "ao_vivo",
      subsMax: MAX_SUBS_AO_VIVO,
      times,
      meuChave: ctx.state.session?.chave ?? CHAVE_USUARIO,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function Liga({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Liga · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=73" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <header class="bf-liga-hero">
          <span class="bf-label-micro">Liga</span>
          <h1 class="bf-liga-hero__title">LIGA DA SEXTA</h1>
          <div class="bf-liga-hero__meta">
            <span class="bf-liga-hero__rodada">Rodada {data.rodada}</span>
            <span class="bf-liga-hero__sep">·</span>
            <span class="bf-liga-hero__count">
              {data.times.length} jogadores
            </span>
          </div>
        </header>

        <div class="bf-liga-list">
          {data.times.map((t, i) => {
            const pos = i + 1;
            const visual = timeLigaInfo(t.chave);
            const displayName = visual?.displayName ?? t.nome;
            const isMe = t.chave === data.meuChave;
            const accent = visual?.accent ?? "var(--bf-fg-2)";
            return (
              <CollapsibleTeamRow
                key={t.chave}
                chave={t.chave}
                pos={pos}
                displayName={displayName}
                dono={t.dono}
                totalFmt={t.total.toFixed(1).replace(".", ",")}
                accent={accent}
                isMine={isMe}
                historico={t.historico}
                subsBadge={data.aoVivo
                  ? { aplicadas: t.subsAplicadas, max: data.subsMax }
                  : null}
              >
                <div class="bf-team-row__expanded">
                  {t.escalacao
                    ? (
                      <Field
                        jogadores={t.escalacao}
                        showPoints={!data.aoVivo}
                        accent={accent}
                        banco={t.banco}
                      />
                    )
                    : (
                      <div class="bf-empty-state">
                        Sem escalação no elenco
                      </div>
                    )}
                </div>
              </CollapsibleTeamRow>
            );
          })}
        </div>

        <SectionHeader>Evolução</SectionHeader>
        <LeagueChart
          times={data.times.map((t): LinhaTime => {
            const info = timeLigaInfo(t.chave);
            return {
              chave: t.chave,
              nome: info?.displayName ?? t.nome,
              accent: info?.accent ?? "#888",
              logo: info?.logo,
              pontosPorRodada: t.historico,
            };
          })}
          destaque={data.meuChave}
        />

        <BottomNav active="liga" />
      </div>
    </>
  );
}
