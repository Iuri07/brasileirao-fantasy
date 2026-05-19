import { Handlers } from "$fresh/server.ts";
import { atualizarTudo } from "../../../lib/crons.ts";
import { getRodadaStatus } from "../../../lib/kv.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST() {
    try {
      await atualizarTudo();
      const status = await getRodadaStatus();
      return new Response(JSON.stringify({ ok: true, status }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
        status: 500,
        headers: H,
      });
    }
  },
};
