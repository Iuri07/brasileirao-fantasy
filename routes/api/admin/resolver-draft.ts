// Endpoint admin pra disparar resolução de draft manualmente.
// O cron também roda automaticamente nos dias/hora configurados — esse
// endpoint é pra forçar antes (ou re-rodar se algo travou).

import { Handlers } from "$fresh/server.ts";
import { resolverDraft } from "../../../lib/draft-resolver.ts";
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
    const resultado = await resolverDraft();
    return new Response(
      JSON.stringify({ ok: true, resultado }),
      { headers: H },
    );
  },
};
