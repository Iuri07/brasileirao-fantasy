// One-shot: soma per-rodada e consolida em 1 linha lifetime por time.
// Idempotente. Chame depois de deploy nova versão do trocas-mercado.

import { Handlers } from "$fresh/server.ts";
import { migrarTrocasMercadoPraLifetime } from "../../../lib/trocas-mercado.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(_req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const r = await migrarTrocasMercadoPraLifetime();
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: H });
  },
};
