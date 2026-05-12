import { Handlers } from "$fresh/server.ts";
import { getAllElencos, toggleInteresse } from "../../../../lib/kv.ts";
import type { State } from "../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(_req, ctx) {
    const session = ctx.state.session;
    if (!session?.chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time atribuído" }),
        { status: 403, headers: H },
      );
    }
    const atletaId = Number(ctx.params.id);
    if (!atletaId || isNaN(atletaId)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id inválido" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv();
    // Bloqueia interesse em atletas que já pertencem a algum elenco
    const elencos = await getAllElencos(kv);
    for (const elenco of Object.values(elencos)) {
      if (elenco.jogadores[String(atletaId)]) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Atleta já pertence a um time",
          }),
          { status: 400, headers: H },
        );
      }
    }
    const r = await toggleInteresse(kv, atletaId, session.chave);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: H });
  },
};
