import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAVenda,
  getDraftOrdem,
  getRodadaStatus,
  isRodadaEmAndamento,
  TODAS_CHAVES,
} from "../lib/kv.ts";
import {
  type DraftMeta,
  getDiasResolucao,
  inicializarDraftSeNecessario,
  proximaResolucao,
} from "../lib/draft.ts";
import { fetchMercadoStatus } from "../lib/cartola.ts";
import { getNomeTimeDisplay } from "../lib/time-visual.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import MercadoBrowser from "../islands/MercadoBrowser.tsx";
import type { State } from "./_middleware.ts";

interface Data {
  /** Rodada rolando: mercado em modo read-only. */
  aoVivo: boolean;
  /** Chave do meu time (pra saber se já estou interessado) */
  minhaChave: string | null;
  /** Quantos jogadores do meu time estão à venda */
  qtdAVenda: number;
  /** Posição do meu time no draft (1-based) — null se não logado */
  posicaoDraft: number | null;
  /** Ordem completa do draft pra exibir contexto (tooltip/listagem) */
  draftOrdem: { chave: string; nome: string }[];
  /** Estado do ciclo: ciclo + rodadaCiclo (1..5) + rodadaBase */
  draftMeta: DraftMeta;
  /** Milissegundos até o fechamento do mercado (Cartola). null se sem info. */
  msAteFechamento: number | null;
  /** Timestamp absoluto (UTC ms) do fechamento. Pra renderizar dia/hora exatos. */
  fechamentoTs: number | null;
  /** Milissegundos até a próxima resolução de conflitos. null se sem config. */
  msAteResolucao: number | null;
  /** Timestamp absoluto (UTC ms) da próxima resolução. */
  resolucaoTs: number | null;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
  /** Admin sem chave própria — lista de times pra escolher "visualizar como". */
  timesDisponiveis: Array<{ chave: string; nome: string }>;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const T0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      timings.push(`${label};dur=${(performance.now() - since).toFixed(1)}`);
    };

    const chaveLogadaAux = ctx.state.session?.chave;

    // SSR enxuto: lê SÓ dados leves (KV pequenos). A grade de
    // atletas e meu elenco vêm via fetch client em /api/mercado/data
    // após hidratação — UI vira usável em ~150ms.
    // inicializarDraftSeNecessario rola em paralelo — passa rodada=1 como
    // default; em prod já está inicializado e o param é ignorado.
    const [
      rodadaStatus,
      draftOrdemKeys,
      diasResolucao,
      minhaAVendaArr,
      draftInit,
    ] = await Promise.all([
      getRodadaStatus(),
      getDraftOrdem(),
      getDiasResolucao(),
      chaveLogadaAux
        ? getAVenda(chaveLogadaAux)
        : Promise.resolve([] as number[]),
      inicializarDraftSeNecessario(1),
    ]);
    mark("kv", T0);
    const qtdAVenda = minhaAVendaArr.length;
    const draftMeta = draftInit.meta;
    const chaveLogada = chaveLogadaAux;

    const posicaoDraft = chaveLogada
      ? draftOrdemKeys.indexOf(chaveLogada) + 1 || null
      : null;
    const draftOrdem = draftOrdemKeys.map((c) => ({
      chave: c,
      nome: getNomeTimeDisplay(c, CHAVES_TIMES[c]?.nome_time),
    }));

    // Tempo até o fechamento do mercado (Cartola fornece timestamp em UTC s).
    let msAteFechamento: number | null = null;
    let fechTimestamp: number | null = rodadaStatus?.fechamento?.timestamp ??
      null;
    if (!fechTimestamp) {
      try {
        const m = await fetchMercadoStatus();
        if (m.status_mercado === 1 && !m.bola_rolando) {
          fechTimestamp = m.fechamento?.timestamp ?? null;
        }
      } catch {
        // ignora — indicador some
      }
    }
    if (fechTimestamp) {
      msAteFechamento = Math.max(0, fechTimestamp * 1000 - Date.now());
    }

    // Tempo até a próxima resolução de conflitos do draft (já temos
    // diasResolucao do round 1)
    const prox = proximaResolucao(diasResolucao);
    const msAteResolucao = prox ? prox.getTime() - Date.now() : null;

    mark("data", T0);
    const Trender = performance.now();
    const resp = await ctx.render({
      aoVivo: isRodadaEmAndamento(rodadaStatus?.status),
      minhaChave: ctx.state.session?.chave ?? null,
      qtdAVenda,
      posicaoDraft,
      draftOrdem,
      draftMeta,
      msAteFechamento,
      fechamentoTs: fechTimestamp ? fechTimestamp * 1000 : null,
      msAteResolucao,
      resolucaoTs: prox ? prox.getTime() : null,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
      timesDisponiveis: TODAS_CHAVES.map((c) => ({
        chave: c,
        nome: getNomeTimeDisplay(c, CHAVES_TIMES[c]?.nome_time),
      })),
    });
    mark("render", Trender);
    mark("total", T0);
    resp.headers.set("Server-Timing", timings.join(","));
    return resp;
  },
};

const TZ = "America/Sao_Paulo";
const DOW_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Parts de uma data no fuso BR — usa Intl em vez de toLocale* pra ser
 *  determinístico independente do TZ do container. */
function partsBR(d: Date): {
  weekday: number;
  day: number;
  month: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: dowMap[parts.weekday] ?? 0,
    day: Number(parts.day),
    month: Number(parts.month),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
  };
}

function hhmm(h: number, m: number): string {
  return m === 0 ? `${h}h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Timing {
  /** Texto curto pra aparecer no pill (ex: "qua 21h", "em 45min") */
  curto: string;
  /** Texto longo pro tooltip (ex: "sex 23/05 às 16:30 (em 1d 4h)") */
  longo: string;
  severity: "normal" | "warn" | "danger";
}

function formatTiming(ts: number, ms: number): Timing {
  const MIN = 60 * 1000;
  const H = 60 * MIN;
  const D = 24 * H;

  // Severity baseada no quão próximo está
  const severity: Timing["severity"] = ms <= 0
    ? "danger"
    : ms < 6 * H
    ? "danger"
    : ms < 24 * H
    ? "warn"
    : "normal";

  if (ms <= 0) {
    return { curto: "agora", longo: "agora", severity };
  }

  const alvo = partsBR(new Date(ts));
  const agora = partsBR(new Date());
  const mesmoDia = alvo.day === agora.day && alvo.month === agora.month;
  const dowAlvo = DOW_SHORT[alvo.weekday];
  const horaFmt = hhmm(alvo.hour, alvo.minute);

  // Relativa (pra tooltip e pra contagem curta)
  let rel: string;
  if (ms < H) {
    const min = Math.max(1, Math.ceil(ms / MIN));
    rel = `em ${min} min`;
  } else if (ms < D) {
    const h = Math.ceil(ms / H);
    rel = `em ${h}h`;
  } else {
    const d = Math.floor(ms / D);
    const hRest = Math.round((ms - d * D) / H);
    rel = hRest > 0 ? `em ${d}d ${hRest}h` : `em ${d}d`;
  }

  // Curto: quando faltar < 1h, mostra contagem regressiva (mais útil que
  // "qua 21:42" quando faltam 8 min). Acima disso, mostra dia + hora.
  let curto: string;
  if (ms < H) {
    const min = Math.max(1, Math.ceil(ms / MIN));
    curto = `${min}min`;
  } else if (mesmoDia) {
    curto = `hoje ${horaFmt}`;
  } else if (ms < 7 * D) {
    curto = `${dowAlvo} ${horaFmt}`;
  } else {
    curto = `${String(alvo.day).padStart(2, "0")}/${
      String(alvo.month).padStart(2, "0")
    } ${horaFmt}`;
  }

  const dataLonga = mesmoDia
    ? `hoje às ${horaFmt}`
    : `${dowAlvo} ${String(alvo.day).padStart(2, "0")}/${
      String(alvo.month).padStart(2, "0")
    } às ${horaFmt}`;

  return { curto, longo: `${dataLonga} (${rel})`, severity };
}

function renderTimingPills(data: Data) {
  const tFech = data.fechamentoTs != null && data.msAteFechamento != null
    ? formatTiming(data.fechamentoTs, data.msAteFechamento)
    : null;
  const tResol = data.resolucaoTs != null && data.msAteResolucao != null
    ? formatTiming(data.resolucaoTs, data.msAteResolucao)
    : null;
  if (!tFech && !tResol) return null;
  return (
    <div class="bf-mercado__timings">
      {tFech && (
        <span
          class={`bf-pill bf-pill--timing-${tFech.severity}`}
          title={`Mercado fecha ${tFech.longo}`}
        >
          <span class="bf-pill__lbl">Mercado fecha</span>
          <span class="bf-pill__val">{tFech.curto}</span>
        </span>
      )}
      {tResol && (
        <span
          class={`bf-pill bf-pill--timing-${tResol.severity}`}
          title={`Conflitos resolvem ${tResol.longo}`}
        >
          <span class="bf-pill__lbl">Draft</span>
          <span class="bf-pill__val">{tResol.curto}</span>
        </span>
      )}
    </div>
  );
}

export default function MercadoPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Mercado · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=144" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        <SectionHeader right={renderTimingPills(data)}>Mercado</SectionHeader>
        {data.aoVivo && (
          <div class="bf-mercado__fechado">
            Mercado <strong>fechado</strong>{" "}
            durante a rodada. Você pode visualizar, mas trocas e interesses só
            voltam quando a rodada terminar.
          </div>
        )}
        <MercadoBrowser
          aoVivo={data.aoVivo}
          lazy
          jogadores={[]}
          minhaChave={data.minhaChave}
          meuElenco={[]}
          qtdAVenda={data.qtdAVenda}
          posicaoDraft={data.posicaoDraft}
          draftOrdem={data.draftOrdem}
          draftMeta={data.draftMeta}
          meusInteresses={[]}
          isAdmin={data.userRole === "admin" && !data.minhaChave}
          timesDisponiveis={data.timesDisponiveis}
        />
        <BottomNav active="mercado" liveDisabled={!data.aoVivo} />
      </div>
    </>
  );
}
