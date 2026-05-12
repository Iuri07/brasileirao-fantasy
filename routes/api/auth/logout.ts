import { Handlers } from "$fresh/server.ts";
import { buildClearCookie, deleteSession } from "../../../lib/auth.ts";
import type { State } from "../../_middleware.ts";

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.sessionId) {
      const kv = await Deno.openKv();
      await deleteSession(kv, ctx.state.sessionId);
    }
    const secure = new URL(req.url).protocol === "https:";
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/login",
        "Set-Cookie": buildClearCookie(secure),
      },
    });
  },
};
