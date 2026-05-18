import { Handlers } from "$fresh/server.ts";
import { getDraftOrdem, setDraftOrdem, TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Gerencia a ordem do draft (resolução de interesses sobre free agents).
 *
 * GET  → retorna a ordem atual { ordem: chave[] } — qualquer usuário logado
 * POST → seta uma nova ordem (body: { ordem: chave[] }) — só admin
 */
export const handler: Handlers<unknown, State> = {
  async GET() {
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const ordem = await getDraftOrdem(kv);
    return new Response(JSON.stringify({ ok: true, ordem }), { headers: H });
  },

  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { ordem?: string[] };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    const ordem = body.ordem ?? [];
    if (!Array.isArray(ordem) || ordem.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, erro: "ordem: chave[] obrigatório" }),
        { status: 400, headers: H },
      );
    }
    const validas = new Set(TODAS_CHAVES);
    const desconhecidas = ordem.filter((c) => !validas.has(c));
    if (desconhecidas.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `chaves desconhecidas: ${desconhecidas.join(", ")}`,
        }),
        { status: 400, headers: H },
      );
    }
    if (new Set(ordem).size !== ordem.length) {
      return new Response(
        JSON.stringify({ ok: false, erro: "chaves duplicadas" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    await setDraftOrdem(kv, ordem);
    const nova = await getDraftOrdem(kv);
    return new Response(JSON.stringify({ ok: true, ordem: nova }), {
      headers: H,
    });
  },
};
