import { Handlers } from "$fresh/server.ts";
import { atribuirEmailATime, removerEmail } from "../../../lib/auth.ts";
import { TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

function exigirAdmin(ctx: { state: State }): boolean {
  return ctx.state.session?.role === "admin";
}

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (!exigirAdmin(ctx)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { chave?: string; email?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), {
        status: 400,
        headers: H,
      });
    }
    const chave = String(body.chave ?? "").toLowerCase();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Time inválido" }),
        { status: 400, headers: H },
      );
    }
    if (!email) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Email vazio — use DELETE pra limpar" }),
        { status: 400, headers: H },
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Email com formato inválido" }),
        { status: 400, headers: H },
      );
    }
    try {
      const kv = await Deno.openKv();
      await atribuirEmailATime(kv, email, chave);
      return new Response(JSON.stringify({ ok: true }), { headers: H });
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, erro: String((e as Error).message ?? e) }),
        { status: 400, headers: H },
      );
    }
  },

  async DELETE(req, ctx) {
    if (!exigirAdmin(ctx)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { chave?: string; email?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), {
        status: 400,
        headers: H,
      });
    }
    const kv = await Deno.openKv();
    if (body.email) {
      await removerEmail(kv, String(body.email));
      return new Response(JSON.stringify({ ok: true }), { headers: H });
    }
    if (body.chave) {
      // Remove o email atribuído à chave (lookup inverso)
      const r = await kv.get<Record<string, string>>(["auth", "email_map"]);
      const map = r.value ?? {};
      for (const [e, c] of Object.entries(map)) {
        if (c === body.chave) delete map[e];
      }
      await kv.set(["auth", "email_map"], map);
      return new Response(JSON.stringify({ ok: true }), { headers: H });
    }
    return new Response(
      JSON.stringify({ ok: false, erro: "chave ou email obrigatório" }),
      { status: 400, headers: H },
    );
  },
};
