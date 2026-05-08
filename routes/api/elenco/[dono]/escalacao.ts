import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../../lib/kv.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(JSON.stringify({ ok: false, erro: "Time não encontrado" }), { status: 404, headers: H });
    }

    let body: { atleta_id: number; escalacao: "Sim" | "Banco" | "Não" };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), { status: 400, headers: H });
    }

    if (!body.atleta_id || !["Sim", "Banco", "Não"].includes(body.escalacao)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "atleta_id e escalacao obrigatórios" }),
        { status: 400, headers: H },
      );
    }

    const kv = await Deno.openKv();
    const elenco = await getElenco(kv, chave);
    if (!elenco) {
      return new Response(JSON.stringify({ ok: false, erro: "Elenco não encontrado" }), { status: 404, headers: H });
    }

    const id = String(body.atleta_id);
    if (!elenco.jogadores[id]) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Jogador não encontrado no elenco" }),
        { status: 404, headers: H },
      );
    }

    elenco.jogadores[id] = { ...elenco.jogadores[id], escalacao: body.escalacao };
    await setElenco(kv, chave, elenco);

    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
