import { Handlers } from "$fresh/server.ts";
import { getElenco, TODAS_CHAVES } from "../../../../lib/kv.ts";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const handler: Handlers = {
  async GET(_req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(JSON.stringify({ erro: "Time não encontrado" }), { status: 404, headers: H });
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const elenco = await getElenco(kv, chave);
    return new Response(JSON.stringify(elenco ?? null), { headers: H });
  },
};
