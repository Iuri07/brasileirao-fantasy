import { Handlers } from "$fresh/server.ts";
import { getRodadaStatus } from "../../../../lib/kv.ts";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

interface PontuadosAtleta {
  pontuacao: number;
  entrou_em_campo: boolean;
  scout?: Record<string, number>;
}
interface PontuadosResp {
  atletas?: Record<string, PontuadosAtleta | undefined>;
}

interface RodadaEntry {
  pontos: number;
  scout: Record<string, number>;
}

// Cache em memória 1h: histórico de um atleta muda raramente (só ao
// fim de cada rodada). Evita 17 fetches Cartola por abertura de modal.
const HIST_TTL_MS = 60 * 60 * 1000;
const cacheHistorico = new Map<
  number,
  {
    at: number;
    data: Record<number, RodadaEntry>;
    rodadaAtual: number;
  }
>();

async function fetchPontuadosRodada(
  rodada: number,
): Promise<PontuadosResp | null> {
  try {
    const r = await fetch(
      `https://api.cartola.globo.com/atletas/pontuados/${rodada}`,
      { headers: { "User-Agent": "BFFantasy" } },
    );
    if (!r.ok) return null;
    return await r.json() as PontuadosResp;
  } catch {
    return null;
  }
}

/** GET /api/atleta/[id]/historico
 *  Retorna { rodada: { pontos, scout } } por rodada onde o atleta entrou em
 *  campo. O scout vem da Cartola por rodada (G, A, FF, etc.) — usado pra
 *  detalhar a pontuação quando o usuário clica numa barra no chart. */
export const handler: Handlers = {
  async GET(_req, ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id inválido" }),
        { status: 400, headers: H },
      );
    }

    // Cache hit?
    const cached = cacheHistorico.get(id);
    if (cached && Date.now() - cached.at < HIST_TTL_MS) {
      return new Response(
        JSON.stringify({
          ok: true,
          historico: cached.data,
          rodadaAtual: cached.rodadaAtual,
          cached: true,
        }),
        { headers: H },
      );
    }

    const rodadaAtual = (await getRodadaStatus())?.rodada ?? 1;
    // Busca rodadas 1..N em paralelo (Cartola tolera ~20 concorrentes)
    const proms: Promise<PontuadosResp | null>[] = [];
    for (let r = 1; r <= rodadaAtual; r++) {
      proms.push(fetchPontuadosRodada(r));
    }
    const results = await Promise.all(proms);
    const historico: Record<number, RodadaEntry> = {};
    results.forEach((resp, idx) => {
      if (!resp?.atletas) return;
      const a = resp.atletas[String(id)];
      if (a && a.entrou_em_campo) {
        historico[idx + 1] = {
          pontos: a.pontuacao,
          scout: a.scout ?? {},
        };
      }
    });
    cacheHistorico.set(id, {
      at: Date.now(),
      data: historico,
      rodadaAtual,
    });
    return new Response(
      JSON.stringify({ ok: true, historico, rodadaAtual, cached: false }),
      { headers: H },
    );
  },
};
