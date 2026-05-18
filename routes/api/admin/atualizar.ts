import { Handlers } from "$fresh/server.ts";
import { atualizarTudo } from "../../../lib/crons.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST() {
    try {
      const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
      await atualizarTudo(kv);
      const status = await kv.get(["rodada_atual"]);
      return new Response(JSON.stringify({ ok: true, status: status.value }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: H });
    }
  },
};
