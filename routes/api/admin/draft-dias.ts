import { Handlers } from "$fresh/server.ts";
import {
  getDiasResolucao,
  getHoraResolucao,
  setDiasResolucao,
  setHoraResolucao,
} from "../../../lib/draft.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Gerencia os dias da semana E hora em que conflitos do draft são resolvidos.
 *
 * GET  → { dias: number[], hora: number }
 *        (dias: 0=domingo … 6=sábado, hora: 0..23)
 * POST → body { dias?: number[], hora?: number }   (só admin)
 *
 * Defaults: dias=[3] (quarta), hora=23.
 */
export const handler: Handlers<unknown, State> = {
  async GET() {
    const [dias, hora] = await Promise.all([
      getDiasResolucao(),
      getHoraResolucao(),
    ]);
    return new Response(JSON.stringify({ ok: true, dias, hora }), {
      headers: H,
    });
  },

  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { dias?: unknown; hora?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (body.dias !== undefined) {
      if (!Array.isArray(body.dias)) {
        return new Response(
          JSON.stringify({ ok: false, erro: "dias: number[]" }),
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
      await setDiasResolucao(dias);
    }
    if (body.hora !== undefined) {
      const h = Number(body.hora);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        return new Response(
          JSON.stringify({ ok: false, erro: "hora deve ser inteiro 0..23" }),
          { status: 400, headers: H },
        );
      }
      await setHoraResolucao(h);
    }
    const [dias, hora] = await Promise.all([
      getDiasResolucao(),
      getHoraResolucao(),
    ]);
    return new Response(JSON.stringify({ ok: true, dias, hora }), {
      headers: H,
    });
  },
};
