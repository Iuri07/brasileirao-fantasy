import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../../../lib/kv.ts";
import type { State } from "../../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Time não encontrado" }),
        { status: 404, headers: H },
      );
    }
    // Endpoint admin-only. Usuários normais movimentam elenco SÓ via
    // sistema de ofertas (que tem checks de mercado fechado, validação
    // do destinatário, etc.). Remover direto pela API bypass todo isso.
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }

    let body: { atleta_id: number };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }

    const elenco = await getElenco(chave);
    if (!elenco) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Elenco não encontrado" }),
        { status: 404, headers: H },
      );
    }

    const id = String(body.atleta_id);
    if (!elenco.jogadores[id]) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Jogador não encontrado" }),
        { status: 404, headers: H },
      );
    }

    delete elenco.jogadores[id];
    await setElenco(chave, elenco);

    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
