import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { getAllElencos, getFotos, getRodadaStatus } from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../lib/historico.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import Field, { type Escalacao, type Pino } from "../components/Field.tsx";
import CollapsibleTeamRow from "../islands/CollapsibleTeamRow.tsx";
import LeagueChart, { type LinhaTime } from "../components/LeagueChart.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
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
  historico: Record<string, number>;
}

interface Data {
  rodada: number;
  times: TimeLinha[];
  meuChave: string;
}

export const handler: Handlers<Data> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, rodada, fotos] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
      getFotos(kv),
    ]);

    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const escalados = calcularMelhorTime(Object.values(elenco.jogadores))
        .filter((j) => j.escalacao === "Sim");
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
        foto: fotos[String(j.atleta_id)] ?? null,
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
        historico,
      });
    }

    times.sort((a, b) =>
      b.total - a.total || b.pontuacaoRodada - a.pontuacaoRodada
    );

    return ctx.render({
      rodada: rodada?.rodada ?? 0,
      times,
      meuChave: CHAVE_USUARIO,
    });
  },
};

export default function Liga({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Liga · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=1" />
      </Head>
      <div class="bf-viewport">
        <TopBar />

        <header class="bf-liga-hero">
          <span class="bf-label-micro">Liga</span>
          <h1 class="bf-liga-hero__title">LIGA DA SEXTA</h1>
          <span class="bf-label-micro">
            {data.times.length} jogadores · Rodada {data.rodada}
          </span>
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
              >
                <div class="bf-team-row__expanded">
                  {t.escalacao
                    ? (
                      <Field
                        jogadores={t.escalacao}
                        showPoints
                        accent={accent}
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
          times={data.times.map((t): LinhaTime => ({
            chave: t.chave,
            nome: timeLigaInfo(t.chave)?.displayName ?? t.nome,
            accent: timeLigaInfo(t.chave)?.accent ?? "#888",
            pontosPorRodada: t.historico,
          }))}
          destaque={data.meuChave}
        />

        <BottomNav active="liga" />
      </div>
    </>
  );
}
