import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getFotos,
  getRodadaStatus,
  TODAS_CHAVES,
} from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import {
  type CartolaClube,
  type CartolaPartida,
  fetchMercadoStatus,
  fetchPartidas,
} from "../lib/cartola.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import Pill from "../components/Pill.tsx";
import Field, { type Escalacao, type Pino } from "../components/Field.tsx";
import Partidas from "../components/Partidas.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getHistorico, rodadasJogadas, totalPontos } from "../lib/historico.ts";

// Time do usuário "logado". Sem auth ainda — hardcoded por enquanto.
// Trocar pra cookie/sessão quando login entrar.
const CHAVE_USUARIO = "aguiar";

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
  /** Soma de pontos de todas as rodadas anteriores (sem a corrente) */
  total: number;
  rodadasJogadas: number;
  /** "Mercado fecha em 2d 3h 12min" — null se mercado fechado ou erro */
  fechamentoTexto: string | null;
  partidas: CartolaPartida[];
  clubesPartidas: Record<string, CartolaClube>;
}

function formatCountdown(unixSeconds: number): string | null {
  const diff = unixSeconds * 1000 - Date.now();
  if (diff <= 0) return null;
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

const POS_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

function montarEscalacao(
  jogadoresEscalados: Array<
    {
      atleta_id: number;
      apelido_api: string;
      posicao: string;
      pontos: number | null;
      clube: string;
      status_id: number | null;
    }
  >,
  fotos: Record<string, string>,
): Escalacao {
  const pino = (j: typeof jogadoresEscalados[number]): Pino => ({
    nome: j.apelido_api,
    pts: j.pontos,
    escudo: escudoUrl(j.clube),
    cores: coresClube(j.clube),
    pos: POS_ABREV[j.posicao],
    statusId: j.status_id,
    // Prefere PNG transparente do TheSportsDB (cutout sem fundo);
    // cai pro busto local quando não tem cutout
    foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
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
    const [elencos, rodada, mercado, partidasResp, fotos, historico] =
      await Promise.all([
        getAllElencos(kv),
        getRodadaStatus(kv),
        // Cartola direto — caso de timeout/erro, fica null e oculta countdown
        fetchMercadoStatus().catch(() => null),
        fetchPartidas().catch(() => null),
        getFotos(kv),
        getHistorico(kv, CHAVE_USUARIO),
      ]);

    const escaladosPorChave: Record<
      string,
      Array<
        {
          atleta_id: number;
          apelido_api: string;
          posicao: string;
          pontos: number | null;
          clube: string;
          status_id: number | null;
        }
      >
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
    const escalacao = meuEscalados.length
      ? montarEscalacao(meuEscalados, fotos)
      : null;
    const fechamentoTexto =
      mercado && mercado.status_mercado === 2 && mercado.fechamento?.timestamp
        ? formatCountdown(mercado.fechamento.timestamp)
        : null;

    // Sobrescreve URLs dos escudos das partidas pra preferir locais
    // (Cartola serve placeholders coloridos por sigla, não escudos reais)
    const clubesPartidas: Record<string, CartolaClube> = {};
    for (const [id, c] of Object.entries(partidasResp?.clubes ?? {})) {
      const nome = c.nome_fantasia ?? c.nome ?? "";
      const url = escudoUrl(nome);
      clubesPartidas[id] = url
        ? { ...c, escudos: { ...(c.escudos ?? {}), "30x30": url } }
        : c;
    }

    const data: HomeData = {
      rodada: rodada?.rodada ?? mercado?.rodada_atual ?? 0,
      status: rodada?.status ?? "aguardando",
      meu: meuIdx >= 0 ? ranking[meuIdx] : null,
      posicao: meuIdx >= 0 ? meuIdx + 1 : null,
      totalTimes: ranking.length || TODAS_CHAVES.length,
      escalacao,
      total: totalPontos(historico),
      rodadasJogadas: rodadasJogadas(historico),
      fechamentoTexto,
      partidas: partidasResp?.partidas ?? [],
      clubesPartidas,
    };

    return ctx.render(data);
  },
};

export default function Home({ data }: PageProps<HomeData>) {
  const visual = timeLigaInfo(CHAVE_USUARIO);
  const meta = CHAVES_TIMES[CHAVE_USUARIO];
  const displayName = visual?.displayName ?? meta?.nome_time ?? "Time";
  const pontosFmt = data.meu?.pontuacao.toFixed(1).replace(".", ",") ?? "—";
  // Splatter accent na cor do crest do usuário (visual?.color = "magenta")
  const splatterUrl = visual ? `/assets/splatter-${visual.color}.png` : null;
  const top3 = data.posicao !== null && data.posicao <= 3;

  return (
    <>
      <Head>
        <title>Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=1" />
      </Head>
      <div class="bf-viewport">
        <TopBar hasAlert />

        <article class="bf-card bf-status-card">
          {splatterUrl && (
            <div
              class="bf-status-card__splatter"
              style={{ backgroundImage: `url(${splatterUrl})` }}
            />
          )}

          <div class="bf-status-card__greeting">
            <span class="bf-status-card__hello">
              Olá, <strong>{meta?.dono ?? "—"}</strong>
            </span>
            <span class="bf-status-card__round">Rodada {data.rodada}</span>
          </div>
          {data.fechamentoTexto && (
            <div class="bf-status-card__market">
              <span class="bf-status-card__market-dot" aria-hidden="true">
              </span>
              Mercado fecha em <strong>{data.fechamentoTexto}</strong>
            </div>
          )}

          <div class="bf-status-card__top">
            <TeamCrest chave={CHAVE_USUARIO} size={56} />
            <div class="bf-status-card__name">
              <h3>{displayName}</h3>
              <span class="bf-status-card__sub">
                Liga da Sexta · {data.totalTimes} times
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
              <span
                class={`bf-status-card__metric-value bf-status-card__metric-value--sm ${
                  top3 ? "bf-status-card__metric-value--lime" : ""
                }`}
              >
                {data.posicao ? `${data.posicao}º` : "—"}
              </span>
              <span class="bf-status-card__metric-foot">
                de {data.totalTimes}
              </span>
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

        <SectionHeader>Sua escala</SectionHeader>
        {data.escalacao
          ? (
            <Field
              jogadores={data.escalacao}
              showPoints={data.status === "ao_vivo"}
              accent={visual?.accent}
            />
          )
          : (
            <div class="bf-empty-state">
              Sem escalação ainda. Monte seu time no Mercado.
            </div>
          )}

        <SectionHeader>Próximos</SectionHeader>
        <Partidas
          partidas={data.partidas}
          clubes={data.clubesPartidas}
          limit={5}
        />
        {data.partidas.length > 5 && (
          <div class="bf-section-footer">
            <a href="/partidas" class="bf-section-footer__link">
              Ver todos
            </a>
          </div>
        )}

        <BottomNav active="home" />
      </div>
    </>
  );
}
