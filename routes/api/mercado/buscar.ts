// Busca de atletas no mercado (free agents) — só admin usa via
// AdminTransferirPanel. Retorna só atletas que NÃO estão em nenhum
// elenco.

import { Handlers } from "$fresh/server.ts";
import { getAllElencos, getAtletasCache, POSICAO_CHAVES_CACHE } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async GET(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
    if (q.length < 2) {
      return new Response(
        JSON.stringify({ ok: true, atletas: [] }),
        { headers: H },
      );
    }

    // Coleta atletas de todas as posições no cache.
    const cachePorPos = await Promise.all(
      POSICAO_CHAVES_CACHE.map((p) => getAtletasCache(p)),
    );
    // Chaves de atletas que JÁ estão em elenco (pra excluir da busca).
    const elencos = await getAllElencos();
    const emElenco = new Set<number>();
    for (const e of Object.values(elencos)) {
      for (const id of Object.keys(e.jogadores)) {
        emElenco.add(Number(id));
      }
    }

    const matches: Array<{
      atleta_id: number;
      apelido: string;
      clube: string;
      posicao: string;
    }> = [];
    for (const cache of cachePorPos) {
      if (!cache) continue;
      for (const [idStr, a] of Object.entries(cache.atletas)) {
        const id = Number(idStr);
        if (emElenco.has(id)) continue;
        if (!a.apelido.toLowerCase().includes(q)) continue;
        matches.push({
          atleta_id: id,
          apelido: a.apelido,
          clube: a.clube,
          posicao: a.posicao,
        });
        if (matches.length >= 50) break;
      }
      if (matches.length >= 50) break;
    }
    matches.sort((x, y) => x.apelido.localeCompare(y.apelido, "pt-BR"));
    return new Response(
      JSON.stringify({ ok: true, atletas: matches.slice(0, 20) }),
      { headers: H },
    );
  },
};
