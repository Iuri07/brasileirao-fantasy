import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  getAllElencos,
  getFotos,
  getRodadaStatus,
  isRodadaEmAndamento,
} from "../lib/kv.ts";
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
import ReservasRow from "../components/ReservasRow.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getNomeTimeDisplay } from "../lib/time-visual.ts";
import { cdn } from "../lib/cdn.ts";

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
  /** Banco oficial — quem o dono marcou como "Banco" (pode entrar via
      auto-sub durante a rodada). */
  banco: BancoPino[];
  /** Resto do elenco — marcados como "Não" (fora do banco). */
  naoEscalados: BancoPino[];
  historico: Record<string, number>;
}

interface Data {
  rodada: number;
  rodadaStatus: "aguardando" | "aguardando_inicio" | "ao_vivo";
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
    const T0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      timings.push(`${label};dur=${(performance.now() - since).toFixed(1)}`);
    };

    const [elencos, rodada, fotos] = await Promise.all([
      getAllElencos(),
      getRodadaStatus(),
      getFotos(),
    ]);
    mark("kv1", T0);

    // Lê TODOS os históricos em paralelo (antes era sequencial dentro do
    // for, custava 9× latência KV)
    const Thist = performance.now();
    const chavesArr = Object.keys(elencos);
    const historicos = await Promise.all(
      chavesArr.map((c) => getHistorico(c)),
    );
    const historicoPorChave = new Map<string, Record<string, number>>();
    chavesArr.forEach((c, i) => historicoPorChave.set(c, historicos[i]));
    mark("hist", Thist);

    // /liga mostra a escalação FIRMADA pelo dono — sem aplicar
    // calcularMelhorTime (que reescreve o `escalacao` field pra
    // simular auto-subs). Aqui lemos elenco.jogadores direto: quem
    // o usuário marcou como "Sim" é titular, "Banco" é reserva ativa
    // (auto-sub elegível), "Não" é resto do elenco.
    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const todos = Object.values(elenco.jogadores);
      const escalados = todos.filter((j) => j.escalacao === "Sim");
      const toBanco = (j: typeof todos[number]): BancoPino => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        posicao: j.posicao,
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
      });
      const banco: BancoPino[] = todos
        .filter((j) => j.escalacao === "Banco")
        .map(toBanco);
      const naoEscalados: BancoPino[] = todos
        .filter((j) => j.escalacao === "Não")
        .map(toBanco);
      const ptsRodada = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      const historico = historicoPorChave.get(chave) ?? {};

      const pino = (j: typeof escalados[number]): Pino => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
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
        nome: getNomeTimeDisplay(chave, elenco.nome_time),
        dono: elenco.dono,
        pontuacaoRodada: ptsRodada,
        total: totalPontos(historico),
        rodadasJogadas: Object.keys(historico).length,
        escalacao,
        banco,
        naoEscalados,
        historico,
      });
    }

    times.sort((a, b) =>
      b.total - a.total || b.pontuacaoRodada - a.pontuacaoRodada
    );

    mark("data", T0);
    const Trender = performance.now();
    const resp = await ctx.render({
      rodada: rodada?.rodada ?? 0,
      rodadaStatus: rodada?.status ?? "aguardando",
      times,
      meuChave: ctx.state.session?.chave ?? CHAVE_USUARIO,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
    mark("render", Trender);
    mark("total", T0);
    resp.headers.set("Server-Timing", timings.join(","));
    return resp;
  },
};

export default function Liga({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Liga · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=137" />
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
          <h1 class="bf-liga-hero__title">LIGA PRO CLUBS</h1>
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
              >
                <div class="bf-team-row__expanded">
                  {t.escalacao
                    ? (
                      <>
                        <Field
                          jogadores={t.escalacao}
                          showPoints={false}
                          showStatus={false}
                          accent={accent}
                        />
                        <ReservasRow
                          label="Banco"
                          jogadores={t.banco}
                          showPoints={false}
                          showStatus={false}
                        />
                        <ReservasRow
                          label="Não escalados"
                          jogadores={t.naoEscalados}
                          showPoints={false}
                          showStatus={false}
                        />
                      </>
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

        <SectionHeader>Evolucao</SectionHeader>
        <LeagueChart
          times={data.times.map((t): LinhaTime => {
            const info = timeLigaInfo(t.chave);
            return {
              chave: t.chave,
              nome: info?.displayName ?? t.nome,
              accent: info?.accent ?? "#888",
              // wrap pelo CDN — em prod /times_escudos/* não existe localmente
              logo: cdn(info?.logo ?? null),
              pontosPorRodada: t.historico,
            };
          })}
          destaque={data.meuChave}
        />

        <BottomNav
          active="liga"
          liveDisabled={!isRodadaEmAndamento(data.rodadaStatus)}
        />
      </div>
    </>
  );
}
