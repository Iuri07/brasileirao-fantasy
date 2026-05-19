import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../../lib/kv.ts";
import type { State } from "../../../_middleware.ts";

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
    // Só dono ou admin pode mudar escalação. Sem isso qualquer usuário
    // logado poderia chamar POST /api/elenco/<qualquer-chave>/escalacao
    // e mudar o time alheio (vulnerabilidade pré-existente).
    const session = ctx.state.session;
    const isAdmin = session?.role === "admin";
    const isDono = session?.chave === chave;
    if (!isAdmin && !isDono) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só o dono do time (ou admin)" }),
        { status: 403, headers: H },
      );
    }

    let body: { atleta_id: number; escalacao: "Sim" | "Banco" | "Não" };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }

    if (!body.atleta_id || !["Sim", "Banco", "Não"].includes(body.escalacao)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "atleta_id e escalacao obrigatórios",
        }),
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
        JSON.stringify({ ok: false, erro: "Jogador não encontrado no elenco" }),
        { status: 404, headers: H },
      );
    }

    elenco.jogadores[id] = {
      ...elenco.jogadores[id],
      escalacao: body.escalacao,
    };
    await setElenco(chave, elenco);

    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
