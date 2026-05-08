import { Handlers } from "$fresh/server.ts";
import { getRodadaStatus } from "../../lib/kv.ts";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const handler: Handlers = {
  async GET() {
    try {
      const kv = await Deno.openKv();
      const status = await getRodadaStatus(kv);
      return new Response(JSON.stringify(status ?? null), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ erro: String(e) }), { status: 500, headers: H });
    }
  },
};
