import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../../../lib/kv.ts";
import type { State } from "../../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(JSON.stringify({ ok: false, erro: "Time não encontrado" }), { status: 404, headers: H });
    }
    const session = ctx.state.session;
    const isAdmin = session?.role === "admin";
    const isDono = session?.chave === chave;
    if (!isAdmin && !isDono) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só o dono do time (ou admin)" }),
        { status: 403, headers: H },
      );
    }

    let body: { atleta_id: number };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), { status: 400, headers: H });
    }

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const elenco = await getElenco(kv, chave);
    if (!elenco) {
      return new Response(JSON.stringify({ ok: false, erro: "Elenco não encontrado" }), { status: 404, headers: H });
    }

    const id = String(body.atleta_id);
    if (!elenco.jogadores[id]) {
      return new Response(JSON.stringify({ ok: false, erro: "Jogador não encontrado" }), { status: 404, headers: H });
    }

    delete elenco.jogadores[id];
    await setElenco(kv, chave, elenco);

    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
