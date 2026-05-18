import { Handlers } from "$fresh/server.ts";
import { getDiasResolucao, setDiasResolucao } from "../../../lib/draft.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Gerencia os dias da semana em que conflitos do draft são resolvidos.
 *
 * GET  → { dias: number[] }    (0=domingo … 6=sábado)
 * POST → body { dias: number[] }   (só admin)
 *
 * Default = [3] (quarta-feira).
 */
export const handler: Handlers<unknown, State> = {
  async GET() {
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const dias = await getDiasResolucao(kv);
    return new Response(JSON.stringify({ ok: true, dias }), { headers: H });
  },

  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { dias?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (!Array.isArray(body.dias)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "dias: number[] obrigatório" }),
        { status: 400, headers: H },
      );
    }
    const dias = body.dias.map((d) => Number(d));
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "dias devem ser inteiros 0..6 (dom..sáb)",
        }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    await setDiasResolucao(kv, dias);
    const novos = await getDiasResolucao(kv);
    return new Response(JSON.stringify({ ok: true, dias: novos }), {
      headers: H,
    });
  },
};
