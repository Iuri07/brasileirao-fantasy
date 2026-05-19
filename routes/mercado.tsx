import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAVenda,
  getDraftOrdem,
  getRodadaStatus,
  isRodadaEmAndamento,
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
  /** Milissegundos até a próxima resolução de conflitos. null se sem config. */
  msAteResolucao: number | null;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const T0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      timings.push(`${label};dur=${(performance.now() - since).toFixed(1)}`);
    };

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
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
      getRodadaStatus(kv),
      getDraftOrdem(kv),
      getDiasResolucao(kv),
      chaveLogadaAux
        ? getAVenda(kv, chaveLogadaAux)
        : Promise.resolve([] as number[]),
      inicializarDraftSeNecessario(kv, 1),
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
      msAteResolucao,
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

function formatTiming(
  ms: number,
): { texto: string; severity: "normal" | "warn" | "danger" } {
  const H = 60 * 60 * 1000;
  if (ms <= 0) return { texto: "agora", severity: "danger" };
  if (ms < 6 * H) {
    return { texto: `em ${Math.ceil(ms / H)}h`, severity: "danger" };
  }
  if (ms < 24 * H) {
    return { texto: `em ${Math.ceil(ms / H)}h`, severity: "warn" };
  }
  const d = Math.ceil(ms / (24 * H));
  return { texto: d === 1 ? "em 1 dia" : `em ${d} dias`, severity: "normal" };
}

/** Formata "em 4 dias" → "4D" / "em 6h" → "6H" — compacto pra caber no header. */
function compacto(t: { texto: string }): string {
  return t.texto
    .replace("em 1 dia", "1D")
    .replace(/em (\d+) dias?/, "$1D")
    .replace(/em (\d+)h/, "$1H")
    .replace("agora", "0H");
}

function renderTimingPills(data: Data) {
  const tFech = data.msAteFechamento != null
    ? formatTiming(data.msAteFechamento)
    : null;
  const tResol = data.msAteResolucao != null
    ? formatTiming(data.msAteResolucao)
    : null;
  if (!tFech && !tResol) return null;
  return (
    <div class="bf-mercado__timings">
      {tFech && (
        <span
          class={`bf-pill bf-pill--timing-${tFech.severity}`}
          title={`Mercado fecha ${tFech.texto}`}
        >
          <span class="bf-pill__lbl">Mkt</span>
          <span class="bf-pill__val">{compacto(tFech)}</span>
        </span>
      )}
      {tResol && (
        <span
          class={`bf-pill bf-pill--timing-${tResol.severity}`}
          title={`Conflitos resolvem ${tResol.texto}`}
        >
          <span class="bf-pill__lbl">Draft</span>
          <span class="bf-pill__val">{compacto(tResol)}</span>
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
        <link rel="stylesheet" href="/bf-styles.css?v=132" />
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
        />
        <BottomNav active="mercado" />
      </div>
    </>
  );
}
