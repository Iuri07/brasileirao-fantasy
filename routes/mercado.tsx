import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getAVenda,
  getAVendaGlobal,
  getDraftOrdem,
  getFotos,
  getInteressadosBatch,
  getMinhaPrioridade,
  getRodadaStatus,
} from "../lib/kv.ts";
import {
  type DraftMeta,
  getDiasResolucao,
  inicializarDraftSeNecessario,
  proximaResolucao,
} from "../lib/draft.ts";
import { fetchAtletasMercado, fetchMercadoStatus } from "../lib/cartola.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { coresClube } from "../lib/cores.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import MercadoBrowser, {
  type AtletaMercado,
  type AtletaMeuTime,
  type MeuInteresse,
} from "../islands/MercadoBrowser.tsx";
import type { State } from "./_middleware.ts";

const POSICAO: Record<number, AtletaMercado["posicao"]> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
};

interface Data {
  jogadores: AtletaMercado[];
  clubes: Record<string, string>; // clube_id → nome
  /** Chave do meu time (pra saber se já estou interessado) */
  minhaChave: string | null;
  /** Os 26 do meu elenco — pra aba "Meu time" */
  meuElenco: AtletaMeuTime[];
  /** Quantos jogadores do meu time estão à venda */
  qtdAVenda: number;
  /** Posição do meu time no draft (1-based) — null se não logado */
  posicaoDraft: number | null;
  /** Ordem completa do draft pra exibir contexto (tooltip/listagem) */
  draftOrdem: { chave: string; nome: string }[];
  /** Estado do ciclo: ciclo + rodadaCiclo (1..5) + rodadaBase */
  draftMeta: DraftMeta;
  /** Meus interesses em ordem de prioridade (top = primeiro). */
  meusInteresses: MeuInteresse[];
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
    const kv = await Deno.openKv();
    const rodadaStatus = await getRodadaStatus(kv);
    const rodadaAtualBR = rodadaStatus?.rodada ?? 1;
    // Bootstrap do draft no primeiro acesso (ciclo 1, ordem = inverso
    // da classificação). Idempotente: nada acontece se já inicializado.
    const draftInit = await inicializarDraftSeNecessario(kv, rodadaAtualBR);

    const [elencos, fotos, mercadoResp, aVenda, draftOrdemKeys] = await Promise
      .all([
        getAllElencos(kv),
        getFotos(kv),
        fetchAtletasMercado().catch(() => null),
        getAVendaGlobal(kv),
        getDraftOrdem(kv),
      ]);
    const draftMeta = draftInit.meta;

    // Dono de cada atleta (chave). Atletas sem dono → "free agent".
    const dono: Record<number, string> = {};
    for (const [chave, elenco] of Object.entries(elencos)) {
      for (const id of Object.keys(elenco.jogadores)) {
        dono[Number(id)] = chave;
      }
    }

    const clubes: Record<string, string> = {};
    for (const [cid, c] of Object.entries(mercadoResp?.clubes ?? {})) {
      clubes[cid] = c.nome_fantasia ?? c.nome ?? cid;
    }

    const idsDisponiveis: number[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      if (!owner || naVenda) idsDisponiveis.push(a.atleta_id);
    }
    const interessadosMap = await getInteressadosBatch(kv, idsDisponiveis);

    const chaveLogadaAux = ctx.state.session?.chave;

    const jogadores: AtletaMercado[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      // Disponíveis: free agents (sem dono) OU explicitamente à venda
      if (owner && !naVenda) continue;
      const pos = POSICAO[a.posicao_id];
      if (!pos) continue;
      const regs = interessadosMap[a.atleta_id] ?? [];
      const meuReg = chaveLogadaAux
        ? regs.find((r) => r.chave === chaveLogadaAux)
        : undefined;
      const clubeNome = clubes[String(a.clube_id)] ?? "";
      // Cutout real só de TheSportsDB ou /atletas/{id}.png. Cartola
      // silhueta vira null aqui — o island renderiza a camisa SVG.
      const fotoKV = fotos[String(a.atleta_id)];
      const fotoCutout = fotoKV &&
          (fotoKV.startsWith("/atletas/") || fotoKV.includes("thesportsdb"))
        ? fotoKV
        : fotoUrl(a.apelido);
      jogadores.push({
        atleta_id: a.atleta_id,
        nome: a.apelido,
        posicao: pos,
        clubeNome,
        clubeId: a.clube_id,
        statusId: a.status_id,
        foto: fotoCutout ?? null,
        cores: coresClube(clubeNome),
        pontosUltima: a.pontos_num ?? null,
        // deno-lint-ignore no-explicit-any
        mediaPontos: (a as any).media_num ?? null,
        donoChave: owner ?? null,
        donoTime: owner ? CHAVES_TIMES[owner]?.nome_time ?? null : null,
        interessados: regs.map((r) => r.chave),
        meuOferecido: meuReg?.oferecido ?? null,
      });
    }

    // Meu elenco (todos os 26 do dono logado) com flag aVenda
    const chaveLogada = chaveLogadaAux;
    const meuElenco: AtletaMeuTime[] = [];
    let qtdAVenda = 0;
    if (chaveLogada && elencos[chaveLogada]) {
      const minhaAVenda = new Set(await getAVenda(kv, chaveLogada));
      qtdAVenda = minhaAVenda.size;
      const mercadoIdx = new Map(
        (mercadoResp?.atletas ?? []).map((a) => [a.atleta_id, a]),
      );
      for (const j of Object.values(elencos[chaveLogada].jogadores)) {
        const cartola = mercadoIdx.get(j.atleta_id);
        const pos = POSICAO[cartola?.posicao_id ?? -1];
        if (!pos) continue;
        const fotoKV = fotos[String(j.atleta_id)];
        const fotoCutout = fotoKV &&
            (fotoKV.startsWith("/atletas/") || fotoKV.includes("thesportsdb"))
          ? fotoKV
          : fotoUrl(j.apelido_api);
        meuElenco.push({
          atleta_id: j.atleta_id,
          nome: j.apelido_api,
          posicao: pos,
          clubeNome: j.clube,
          clubeId: j.clube_id,
          statusId: j.status_id,
          foto: fotoCutout ?? null,
          cores: coresClube(j.clube),
          pontosUltima: cartola?.pontos_num ?? null,
          // deno-lint-ignore no-explicit-any
          mediaPontos: (cartola as any)?.media_num ?? null,
          donoChave: chaveLogada,
          donoTime: CHAVES_TIMES[chaveLogada]?.nome_time ?? null,
          interessados: [],
          aVenda: minhaAVenda.has(j.atleta_id),
        });
      }
    }

    const posicaoDraft = chaveLogada
      ? draftOrdemKeys.indexOf(chaveLogada) + 1 || null
      : null;
    const draftOrdem = draftOrdemKeys.map((c) => ({
      chave: c,
      nome: CHAVES_TIMES[c]?.nome_time ?? c,
    }));

    // Meus interesses em ordem de prioridade. Cada entrada inclui o
    // jogador oferecido pra exibir nome no card.
    const meusInteresses: MeuInteresse[] = [];
    if (chaveLogada) {
      const prioridade = await getMinhaPrioridade(kv, chaveLogada);
      const mercadoIdx = new Map(
        (mercadoResp?.atletas ?? []).map((a) => [a.atleta_id, a]),
      );
      const meuElencoIdx = new Map(
        (elencos[chaveLogada]?.jogadores
          ? Object.values(elencos[chaveLogada].jogadores)
          : []).map((j) => [j.atleta_id, j]),
      );
      for (const atletaId of prioridade) {
        const a = mercadoIdx.get(atletaId);
        if (!a) continue; // atleta sumiu do mercado
        const pos = POSICAO[a.posicao_id];
        if (!pos) continue;
        // Verifica que ainda tenho interesse ativo (caso o cron tenha
        // limpado por algum motivo)
        const regs = interessadosMap[atletaId] ?? [];
        const meuReg = regs.find((r) => r.chave === chaveLogada);
        if (!meuReg) continue;
        const oferecidoJog = meuElencoIdx.get(meuReg.oferecido);
        const clubeNomeAt = clubes[String(a.clube_id)] ?? "";
        const fotoKV = fotos[String(atletaId)];
        const fotoCutout = fotoKV &&
            (fotoKV.startsWith("/atletas/") || fotoKV.includes("thesportsdb"))
          ? fotoKV
          : fotoUrl(a.apelido);
        meusInteresses.push({
          atleta_id: atletaId,
          nome: a.apelido,
          posicao: pos,
          clubeNome: clubeNomeAt,
          foto: fotoCutout ?? null,
          cores: coresClube(clubeNomeAt),
          statusId: a.status_id,
          oferecidoId: meuReg.oferecido,
          oferecidoNome: oferecidoJog?.apelido_api ?? "—",
          totalInteressados: regs.length,
        });
      }
    }

    // Tempo até o fechamento do mercado (Cartola fornece timestamp em UTC s).
    // Tenta KV primeiro (preenchido pelo cron); fallback fetch direto da
    // Cartola caso o KV não tenha (deploy novo / mercado em rodada).
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

    // Tempo até a próxima resolução de conflitos do draft
    const diasResolucao = await getDiasResolucao(kv);
    const prox = proximaResolucao(diasResolucao);
    const msAteResolucao = prox ? prox.getTime() - Date.now() : null;

    return ctx.render({
      jogadores,
      clubes,
      minhaChave: ctx.state.session?.chave ?? null,
      meuElenco,
      qtdAVenda,
      posicaoDraft,
      draftOrdem,
      draftMeta,
      meusInteresses,
      msAteFechamento,
      msAteResolucao,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
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
        <link rel="stylesheet" href="/bf-styles.css?v=69" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        <SectionHeader right={renderTimingPills(data)}>Mercado</SectionHeader>
        <MercadoBrowser
          jogadores={data.jogadores}
          minhaChave={data.minhaChave}
          meuElenco={data.meuElenco}
          qtdAVenda={data.qtdAVenda}
          posicaoDraft={data.posicaoDraft}
          draftOrdem={data.draftOrdem}
          draftMeta={data.draftMeta}
          meusInteresses={data.meusInteresses}
        />
        <BottomNav active="mercado" />
      </div>
    </>
  );
}
