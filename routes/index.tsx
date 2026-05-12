import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getAVenda,
  getFotos,
  getRodadaStatus,
  getSubsUsadas,
  MAX_SUBS_AO_VIVO,
  TODAS_CHAVES,
} from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import {
  type CartolaClube,
  type CartolaPartida,
  fetchAtletasPontuados,
  fetchMercadoStatus,
  fetchPartidas,
} from "../lib/cartola.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import Pill from "../components/Pill.tsx";
import {
  type BancoPino,
  type Escalacao,
  type Pino,
} from "../components/Field.tsx";
import MeuTimeEditor, {
  type AtletaElenco,
} from "../islands/MeuTimeEditor.tsx";
import PartidasExpandable from "../islands/PartidasExpandable.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getHistorico, rodadasJogadas, totalPontos } from "../lib/historico.ts";

import type { State } from "./_middleware.ts";

/** Fallback dev — só usado se a sessão não tem chave (não acontece em prod). */
const CHAVE_FALLBACK_DEV = "aguiar";

interface TimeRanking {
  chave: string;
  nome: string;
  dono: string;
  pontuacao: number;
}

interface HomeData {
  chave: string;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
  rodada: number;
  status: "aguardando" | "aguardando_inicio" | "ao_vivo";
  /** True quando bola_rolando do Cartola; mais preciso que `status` que
      depende do cron rodar */
  aoVivoReal: boolean;
  /** Pontuação exibida no card "Esta rodada". Pode ser:
      - parcial ao vivo da rodada corrente (quando aoVivoReal)
      - parcial computada de pontuados (rodada não fechada no histórico)
      - última rodada fechada do histórico (entre rodadas, sem live data) */
  pontuacaoExibida: number | null;
  /** Rodada da pontuacaoExibida — pode diferir de `rodada` se entre rodadas */
  rodadaExibida: number;
  /** True → label "parcial"; false → "final" */
  exibidaParcial: boolean;
  meu: TimeRanking | null;
  posicao: number | null;
  totalTimes: number;
  escalacao: Escalacao | null;
  banco: BancoPino[];
  /** Lista plana de escalados+banco (formato do MeuTimeEditor) */
  atletas: AtletaElenco[];
  /** Substituições já usadas (somente quando ao vivo) */
  subsUsadas: number;
  /** Limite de substituições no ao vivo */
  subsMax: number;
  /** Edição da escalação bloqueada (mercado fechado / rodada rolando) */
  edicaoBloqueada: boolean;
  /** atleta_ids marcados como "à venda" pelo dono */
  aVendaIds: number[];
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

export const handler: Handlers<HomeData, State> = {
  async GET(_req, ctx) {
    const CHAVE_USUARIO = ctx.state.session?.chave ?? CHAVE_FALLBACK_DEV;
    const kv = await Deno.openKv();
    const [
      elencos,
      rodada,
      mercado,
      partidasResp,
      pontuadosResp,
      fotos,
      historico,
    ] = await Promise.all([
      getAllElencos(kv),
      getRodadaStatus(kv),
      // Cartola direto — caso de timeout/erro, fica null e oculta countdown
      fetchMercadoStatus().catch(() => null),
      fetchPartidas().catch(() => null),
      // Pontos parciais ao vivo — sobrescreve os pontos do KV (mais frescos
      // que esperar o cron rodar)
      fetchAtletasPontuados().catch(() => null),
      getFotos(kv),
      getHistorico(kv, CHAVE_USUARIO),
    ]);
    const livePts = pontuadosResp?.atletas ?? {};
    const liveP = (id: number, kvPts: number | null): number | null => {
      const live = livePts[String(id)]?.pontuacao;
      return live != null ? live : kvPts;
    };

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

    // Pra ranking: usar TOTAL ACUMULADO do histórico (consistente com /liga).
    // Fallback pra pontuação da rodada corrente quando histórico vazio.
    const totaisPorChave = new Map<string, number>();
    await Promise.all(
      Object.keys(elencos).map(async (chave) => {
        const h = await getHistorico(kv, chave);
        totaisPorChave.set(chave, totalPontos(h));
      }),
    );

    const ranking: TimeRanking[] = Object.entries(elencos)
      .map(([chave, elenco]) => {
        const todos = Object.values(elenco.jogadores);
        const escalados = calcularMelhorTime(todos)
          .filter((j) => j.escalacao === "Sim")
          .map((j) => ({ ...j, pontos: liveP(j.atleta_id, j.pontos) }));
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
      .sort((a, b) => {
        const totA = totaisPorChave.get(a.chave) ?? 0;
        const totB = totaisPorChave.get(b.chave) ?? 0;
        if (totA !== totB) return totB - totA;
        return b.pontuacao - a.pontuacao;
      });

    const meuIdx = ranking.findIndex((t) => t.chave === CHAVE_USUARIO);
    const meuEscalados = escaladosPorChave[CHAVE_USUARIO] ?? [];
    const escalacao = meuEscalados.length
      ? montarEscalacao(meuEscalados, fotos)
      : null;

    const meuElenco = elencos[CHAVE_USUARIO];
    const atletas: AtletaElenco[] = meuElenco
      ? Object.values(meuElenco.jogadores)
        // Inclui todos os 26 fixos: Sim (titular), Banco (reserva ativa),
        // Não (reserva inativa que pode subir via swap-escalacao)
        .filter((j) =>
          j.escalacao === "Sim" || j.escalacao === "Banco" ||
          j.escalacao === "Não"
        )
        .map((j) => ({
          atleta_id: j.atleta_id,
          apelido: j.apelido_api,
          clube: j.clube,
          posicao: j.posicao as AtletaElenco["posicao"],
          escalacao: j.escalacao as "Sim" | "Banco" | "Não",
          pontos: liveP(j.atleta_id, j.pontos),
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
          statusId: j.status_id,
        }))
      : [];
    const banco: BancoPino[] = meuElenco
      ? calcularMelhorTime(Object.values(meuElenco.jogadores))
        .filter((j) => j.escalacao === "Banco")
        .map((j) => ({
          nome: j.apelido_api,
          pts: liveP(j.atleta_id, j.pontos),
          escudo: escudoUrl(j.clube),
          cores: coresClube(j.clube),
          pos: POS_ABREV[j.posicao],
          posicao: j.posicao,
          statusId: j.status_id,
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
          entrouEmCampo: !!livePts[String(j.atleta_id)]?.entrou_em_campo,
        }))
      : [];
    // Countdown só faz sentido com mercado aberto (status_mercado===1)
    const fechamentoTexto =
      mercado && mercado.status_mercado === 1 && mercado.fechamento?.timestamp
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

    const rodadaAtual = rodada?.rodada ?? mercado?.rodada_atual ?? 0;
    const aoVivoReal = !!mercado?.bola_rolando ||
      (rodada?.status === "ao_vivo");
    const subsUsadas = aoVivoReal
      ? await getSubsUsadas(kv, rodadaAtual, CHAVE_USUARIO)
      : 0;
    const aVendaIds = await getAVenda(kv, CHAVE_USUARIO);
    const parcialLive = meuIdx >= 0 ? ranking[meuIdx].pontuacao : 0;
    const historicoAtual = historico[String(rodadaAtual)];
    const rodadasHistorico = Object.keys(historico)
      .map(Number)
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a);
    const ultimaRodadaHist = rodadasHistorico[0];

    // Decide qual rodada/valor exibir:
    // 1. live > 0 → rodada atual em parcial
    // 2. historico tem rodada atual → mostra ela como final
    // 3. tem qualquer rodada no historico → mostra a última como final
    // 4. nada → null
    let pontuacaoExibida: number | null = null;
    let rodadaExibida = rodadaAtual;
    let exibidaParcial = false;
    if (parcialLive > 0 || aoVivoReal) {
      pontuacaoExibida = parcialLive;
      exibidaParcial = true;
    } else if (historicoAtual != null) {
      pontuacaoExibida = historicoAtual;
      exibidaParcial = false;
    } else if (ultimaRodadaHist != null) {
      pontuacaoExibida = historico[String(ultimaRodadaHist)];
      rodadaExibida = ultimaRodadaHist;
      exibidaParcial = false;
    }

    const data: HomeData = {
      chave: CHAVE_USUARIO,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
      rodada: rodadaAtual,
      status: rodada?.status ?? "aguardando",
      aoVivoReal,
      pontuacaoExibida,
      rodadaExibida,
      exibidaParcial,
      meu: meuIdx >= 0 ? ranking[meuIdx] : null,
      posicao: meuIdx >= 0 ? meuIdx + 1 : null,
      totalTimes: ranking.length || TODAS_CHAVES.length,
      escalacao,
      banco,
      atletas,
      subsUsadas,
      subsMax: MAX_SUBS_AO_VIVO,
      // Edição só permitida com mercado aberto (status_mercado===1)
      edicaoBloqueada: mercado?.status_mercado !== 1,
      aVendaIds,
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
  const visual = timeLigaInfo(data.chave);
  const meta = CHAVES_TIMES[data.chave];
  const displayName = visual?.displayName ?? meta?.nome_time ?? "Time";
  const pontosFmt = data.pontuacaoExibida != null
    ? data.pontuacaoExibida.toFixed(1).replace(".", ",")
    : "—";
  const labelEstaRodada = data.rodadaExibida === data.rodada
    ? "Esta rodada"
    : `Rodada ${data.rodadaExibida}`;
  // Splatter accent na cor do crest do usuário (visual?.color = "magenta")
  const splatterUrl = visual ? `/assets/splatter-${visual.color}.png` : null;
  const top3 = data.posicao !== null && data.posicao <= 3;

  return (
    <>
      <Head>
        <title>Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=69" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          hasAlert
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome ?? meta?.dono}
          userPicture={data.userPicture}
        />

        <article
          class="bf-card bf-status-card"
          style={visual?.accent
            ? { "--user-accent": visual.accent } as Record<string, string>
            : undefined}
        >
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

          <div class="bf-status-card__top">
            <TeamCrest chave={data.chave} size={56} />
            <div class="bf-status-card__name">
              <h3>{displayName}</h3>
              <span class="bf-status-card__sub">
                Liga da Sexta · {data.totalTimes} times
              </span>
            </div>
            {data.aoVivoReal && <Pill variant="lime" live>Ao Vivo</Pill>}
          </div>

          <div class="bf-status-card__metrics">
            <div class="bf-status-card__metric">
              <span class="bf-label-micro">{labelEstaRodada}</span>
              <span class="bf-status-card__metric-value">
                {pontosFmt}
                {data.aoVivoReal && (
                  <span class="bf-status-card__live-dot" aria-hidden="true">
                  </span>
                )}
              </span>
              <span
                class={`bf-status-card__metric-foot ${
                  data.exibidaParcial
                    ? "bf-status-card__metric-foot--lime"
                    : ""
                }`}
              >
                {data.aoVivoReal
                  ? "parcial · ao vivo"
                  : data.exibidaParcial
                  ? "parcial"
                  : "final"}
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

        {data.atletas.length > 0
          ? (
            <MeuTimeEditor
              chave={data.chave}
              atletas={data.atletas}
              accent={visual?.accent ?? "#888"}
              aoVivo={data.aoVivoReal}
              subsUsadasInicial={data.subsUsadas}
              subsMax={data.subsMax}
              showPoints={data.aoVivoReal}
              edicaoBloqueada={data.edicaoBloqueada}
              fechamentoTexto={data.fechamentoTexto}
              aVendaIds={data.aVendaIds}
            />
          )
          : (
            <div class="bf-empty-state">
              Sem escalação ainda. Monte seu time no Mercado.
            </div>
          )}

        <SectionHeader>Próximos</SectionHeader>
        <PartidasExpandable
          partidas={data.partidas}
          clubes={data.clubesPartidas}
          limit={5}
        />

        <BottomNav active="home" />
      </div>
    </>
  );
}
