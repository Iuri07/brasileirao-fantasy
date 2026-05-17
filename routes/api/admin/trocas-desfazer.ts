import { Handlers } from "$fresh/server.ts";
import { desfazerTroca } from "../../../lib/historico-trocas.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/** Admin only — desfaz uma troca concluída (move atletas de volta
 *  aos elencos originais com escalação original). Falha se a troca
 *  já foi desfeita ou se um atleta envolvido foi transferido depois. */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Admin only" }),
        { status: 403, headers: H },
      );
    }
    let body: { id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (!body.id) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id obrigatório" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv();
    const r = await desfazerTroca(kv, body.id);
    if (!r.ok) {
      return new Response(
        JSON.stringify(r),
        { status: 400, headers: H },
      );
    }
    return new Response(
      JSON.stringify(r),
      { headers: H },
    );
  },
};
