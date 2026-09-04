// Admin endpoint pra gerenciar o contador LIFETIME de trocas com
// mercado por time. Sem rodada — é acumulado (não reseta).
//
// GET  /api/admin/trocas-mercado → lifetime por time
// PUT  /api/admin/trocas-mercado → { counts: { chave: N } } — override

import { Handlers } from "$fresh/server.ts";
import {
  getTrocasMercadoTotal,
  setTrocasMercadoTotal,
} from "../../../lib/trocas-mercado.ts";
import { TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  GET(_req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const times = TODAS_CHAVES.map((chave) => ({
      chave,
      count: getTrocasMercadoTotal(chave),
    }));
    return new Response(
      JSON.stringify({ ok: true, times }),
      { headers: H },
    );
  },

  async PUT(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { counts?: Record<string, number> };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (body.counts && typeof body.counts === "object") {
      for (const [chave, count] of Object.entries(body.counts)) {
        if (!TODAS_CHAVES.includes(chave)) continue;
        if (typeof count !== "number") continue;
        await setTrocasMercadoTotal(chave, count);
      }
    }
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: H },
    );
  },
};
