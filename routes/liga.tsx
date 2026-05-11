import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES, getAllElencos, getRodadaStatus } from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../lib/historico.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import { timeLigaInfo } from "../lib/times-liga.ts";

const CHAVE_USUARIO = "aguiar";

interface TimeLinha {
  chave: string;
  nome: string;
  dono: string;
  pontuacaoRodada: number;
  total: number;
  rodadasJogadas: number;
}

interface Data {
  rodada: number;
  times: TimeLinha[];
  meuChave: string;
}

export const handler: Handlers<Data> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, rodada] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
    ]);

    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const escalados = calcularMelhorTime(Object.values(elenco.jogadores))
        .filter((j) => j.escalacao === "Sim");
      const ptsRodada = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      const historico = await getHistorico(kv, chave);
      times.push({
        chave,
        nome: elenco.nome_time,
        dono: elenco.dono,
        pontuacaoRodada: ptsRodada,
        total: totalPontos(historico),
        rodadasJogadas: Object.keys(historico).length,
      });
    }

    // Ordena por total da temporada desc; quando todos zero (rodada 0)
    // o sort fica estável e segue ordem de inserção
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
            const top3 = pos <= 3;
            return (
              <a
                href={`/time/${t.chave}`}
                class={`bf-team-row ${isMe ? "bf-team-row--mine" : ""}`}
                key={t.chave}
              >
                <span
                  class={`bf-team-row__pos ${
                    top3 ? "bf-team-row__pos--top" : ""
                  }`}
                >
                  {pos}º
                </span>
                <TeamCrest chave={t.chave} size={36} />
                <div class="bf-team-row__meta">
                  <div class="bf-team-row__name">{displayName}</div>
                  <div class="bf-team-row__owner">{t.dono}</div>
                </div>
                <div class="bf-team-row__pts">
                  <span class="bf-team-row__pts-value">
                    {t.total.toFixed(1).replace(".", ",")}
                  </span>
                  <span class="bf-team-row__pts-foot">
                    {t.rodadasJogadas > 0 ? "total" : "—"}
                  </span>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.4)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="bf-team-row__chev"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </a>
            );
          })}
        </div>

        <BottomNav active="liga" />
      </div>
    </>
  );
}
