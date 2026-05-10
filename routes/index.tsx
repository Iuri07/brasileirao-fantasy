import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getRodadaStatus,
  TODAS_CHAVES,
} from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import Crest, { type CrestColor } from "../components/Crest.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import Pill from "../components/Pill.tsx";
import Field, { type Escalacao, type Pino } from "../components/Field.tsx";

// Time do usuário "logado". Sem auth ainda — hardcoded por enquanto.
// Trocar pra cookie/sessão quando login entrar.
const CHAVE_USUARIO = "aguiar";

// Identidade visual por time (cor do crest + sigla curta).
const TIME_VISUAL: Record<
  string,
  { color: CrestColor; sigla: string; displayName?: string }
> = {
  aguiar: { color: "magenta", sigla: "FK" },
  ian: { color: "orange", sigla: "BF" },
  costa: { color: "yellow", sigla: "IP", displayName: "Ilha de Paquetá" },
  brito: { color: "green", sigla: "CG", displayName: "Crefilho da Gama" },
  domingos: { color: "blue", sigla: "B23" },
  jose: { color: "lime", sigla: "888" },
  leo: { color: "blue", sigla: "MOL", displayName: "Moleicester City" },
  armando: { color: "magenta", sigla: "PCH", displayName: "Papai Chegou FC" },
  jp: { color: "orange", sigla: "PAP", displayName: "Pedro Álvares Pardal" },
};

interface TimeRanking {
  chave: string;
  nome: string;
  dono: string;
  pontuacao: number;
}

interface HomeData {
  rodada: number;
  status: "aguardando" | "aguardando_inicio" | "ao_vivo";
  meu: TimeRanking | null;
  posicao: number | null;
  totalTimes: number;
  escalacao: Escalacao | null;
}

function montarEscalacao(
  jogadoresEscalados: Array<
    { apelido_api: string; posicao: string; pontos: number | null }
  >,
): Escalacao {
  const pino = (j: typeof jogadoresEscalados[number]): Pino => ({
    nome: j.apelido_api,
    pts: j.pontos,
  });
  const gk = jogadoresEscalados.find((j) => j.posicao === "Goleiro");
  const def = jogadoresEscalados.filter((j) =>
    j.posicao === "Zagueiro" || j.posicao === "Lateral"
  );
  const mid = jogadoresEscalados.filter((j) => j.posicao === "Meia");
  const ata = jogadoresEscalados.filter((j) => j.posicao === "Atacante");
  return {
    gk: gk ? pino(gk) : {},
    def: def.map(pino),
    mid: mid.map(pino),
    ata: ata.map(pino),
  };
}

export const handler: Handlers<HomeData> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, rodada] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
    ]);

    const escaladosPorChave: Record<
      string,
      Array<{ apelido_api: string; posicao: string; pontos: number | null }>
    > = {};

    const ranking: TimeRanking[] = Object.entries(elencos)
      .map(([chave, elenco]) => {
        const todos = Object.values(elenco.jogadores);
        const escalados = calcularMelhorTime(todos).filter((j) =>
          j.escalacao === "Sim"
        );
        escaladosPorChave[chave] = escalados;
        const pontuacao = Math.round(
          escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
        ) / 100;
        return {
          chave,
          nome: elenco.nome_time,
          dono: elenco.dono,
          pontuacao,
        };
      })
      .sort((a, b) => b.pontuacao - a.pontuacao);

    const meuIdx = ranking.findIndex((t) => t.chave === CHAVE_USUARIO);
    const meuEscalados = escaladosPorChave[CHAVE_USUARIO] ?? [];
    const data: HomeData = {
      rodada: rodada?.rodada ?? 0,
      status: rodada?.status ?? "aguardando",
      meu: meuIdx >= 0 ? ranking[meuIdx] : null,
      posicao: meuIdx >= 0 ? meuIdx + 1 : null,
      totalTimes: ranking.length || TODAS_CHAVES.length,
      escalacao: meuEscalados.length ? montarEscalacao(meuEscalados) : null,
    };

    return ctx.render(data);
  },
};

export default function Home({ data }: PageProps<HomeData>) {
  const visual = TIME_VISUAL[CHAVE_USUARIO] ??
    { color: "magenta" as CrestColor, sigla: "??" };
  const meta = CHAVES_TIMES[CHAVE_USUARIO];
  const displayName = visual.displayName ?? meta?.nome_time ?? "Time";
  const pontosFmt = data.meu?.pontuacao.toFixed(1).replace(".", ",") ?? "—";

  return (
    <>
      <Head>
        <title>Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=1" />
      </Head>
      <div class="bf-viewport">
        <TopBar hasAlert />

        <div class="bf-greeting">
          <span class="bf-label-micro">
            Olá, {meta?.dono ?? "—"} · Rodada {data.rodada}
          </span>
        </div>

        <article class="bf-card bf-status-card">
          <div class="bf-status-card__top">
            <Crest color={visual.color} sigla={visual.sigla} size={52} />
            <div class="bf-status-card__name">
              <h3>{displayName}</h3>
              <span class="bf-status-card__sub">
                {data.posicao ? `${data.posicao}º` : "—"} · Liga da Sexta
              </span>
            </div>
            {data.status === "ao_vivo" && (
              <Pill variant="lime" live>Ao Vivo</Pill>
            )}
          </div>

          <div class="bf-status-card__metrics">
            <div class="bf-status-card__metric">
              <span class="bf-label-micro">Esta rodada</span>
              <span class="bf-status-card__metric-value">{pontosFmt}</span>
              <span class="bf-status-card__metric-foot">
                {data.status === "ao_vivo" ? "parcial" : "final"}
              </span>
            </div>
            <div class="bf-status-card__divider"></div>
            <div class="bf-status-card__metric">
              <span class="bf-label-micro">Posição</span>
              <span class="bf-status-card__metric-value bf-status-card__metric-value--sm">
                {data.posicao ? `${data.posicao}º` : "—"}
              </span>
              <span class="bf-status-card__metric-foot">
                de {data.totalTimes}
              </span>
            </div>
          </div>
        </article>

        <SectionHeader>Sua escala</SectionHeader>
        {data.escalacao
          ? (
            <Field
              jogadores={data.escalacao}
              showPoints={data.status === "ao_vivo"}
            />
          )
          : (
            <div class="bf-empty-state">
              Sem escalação ainda. Monte seu time no Mercado.
            </div>
          )}

        <SectionHeader>Próximos</SectionHeader>
        <div class="bf-empty-state">
          API de partidas em construção
        </div>

        <BottomNav active="home" />
      </div>
    </>
  );
}
