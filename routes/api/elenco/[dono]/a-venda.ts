import { Handlers } from "$fresh/server.ts";
import {
  getElenco,
  isAoVivo,
  TODAS_CHAVES,
  toggleAVenda,
} from "../../../../lib/kv.ts";
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
    // Só o dono ou admin pode marcar
    const session = ctx.state.session;
    const isAdmin = session?.role === "admin";
    const isDono = session?.chave === chave;
    if (!isAdmin && !isDono) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só o dono do time" }),
        { status: 403, headers: H },
      );
    }
    let body: { atleta_id?: number };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (!body.atleta_id) {
      return new Response(
        JSON.stringify({ ok: false, erro: "atleta_id obrigatório" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    if (await isAoVivo(kv)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Mercado fechado durante a rodada",
        }),
        { status: 423, headers: H },
      );
    }
    const elenco = await getElenco(kv, chave);
    if (!elenco?.jogadores[String(body.atleta_id)]) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Atleta não está no elenco" }),
        { status: 400, headers: H },
      );
    }
    const r = await toggleAVenda(kv, chave, body.atleta_id);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: H });
  },
};
