import { Handlers } from "$fresh/server.ts";
import { cancelarOferta } from "../../../lib/ofertas.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/** Admin only — cancela uma oferta pendente por ID. */
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
    const oferta = await cancelarOferta(body.id);
    if (!oferta) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Oferta não encontrada" }),
        { status: 404, headers: H },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, oferta }),
      { headers: H },
    );
  },
};
