import { Handlers } from "$fresh/server.ts";
import { TODAS_CHAVES } from "../../../lib/kv.ts";
import {
  deleteHistoricoRodada,
  getAllHistoricos,
  setHistoricoRodada,
} from "../../../lib/historico.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

function exigirAdmin(ctx: { state: State }): boolean {
  return ctx.state.session?.role === "admin";
}

function jsonErr(status: number, erro: string): Response {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: H });
}

/**
 * GET  /api/admin/historico          → { ok, historicos: { [chave]: { [rodada]: pontos } } }
 * POST /api/admin/historico          → body { chave, rodada, pontos } | { chave, rodada, pontos: null }
 *                                      pontos null deleta a célula.
 *                                      Pode mandar batch: { updates: [{chave, rodada, pontos}, ...] }
 */
export const handler: Handlers<unknown, State> = {
  async GET(_req, ctx) {
    if (!exigirAdmin(ctx)) return jsonErr(403, "Apenas admin");
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const historicos = await getAllHistoricos(kv);
    return new Response(JSON.stringify({ ok: true, historicos }), { headers: H });
  },

  async POST(req, ctx) {
    if (!exigirAdmin(ctx)) return jsonErr(403, "Apenas admin");
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);

    let body: {
      chave?: string;
      rodada?: number;
      pontos?: number | null;
      updates?: Array<{ chave: string; rodada: number; pontos: number | null }>;
    };
    try {
      body = await req.json();
    } catch {
      return jsonErr(400, "JSON inválido");
    }

    const updates = body.updates ??
      (body.chave !== undefined && body.rodada !== undefined
        ? [{ chave: body.chave, rodada: body.rodada, pontos: body.pontos ?? null }]
        : []);

    if (updates.length === 0) return jsonErr(400, "Sem updates");

    const aplicados: Array<{ chave: string; rodada: number; pontos: number | null }> = [];
    for (const u of updates) {
      const chave = String(u.chave ?? "").toLowerCase();
      const rodada = Number(u.rodada);
      if (!TODAS_CHAVES.includes(chave)) {
        return jsonErr(400, `chave inválida: ${u.chave}`);
      }
      if (!Number.isFinite(rodada) || rodada < 1 || rodada > 50) {
        return jsonErr(400, `rodada inválida: ${u.rodada}`);
      }
      if (u.pontos === null || u.pontos === undefined) {
        await deleteHistoricoRodada(kv, chave, rodada);
        aplicados.push({ chave, rodada, pontos: null });
      } else {
        const pontos = Number(u.pontos);
        if (!Number.isFinite(pontos)) {
          return jsonErr(400, `pontos inválidos: ${u.pontos}`);
        }
        // arredonda pra 1 casa pra evitar inflar com float garbage
        const arred = Math.round(pontos * 10) / 10;
        await setHistoricoRodada(kv, chave, rodada, arred);
        aplicados.push({ chave, rodada, pontos: arred });
      }
    }

    return new Response(JSON.stringify({ ok: true, aplicados }), { headers: H });
  },
};
