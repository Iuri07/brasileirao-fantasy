import { Handlers } from "$fresh/server.ts";
import { avancarRodadaDraft, resetDraft } from "../../../lib/draft.ts";
import { getRodadaStatus, TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Fecha a rodada atual do draft, aplicando o shift baseado em quem usou
 * o pick. Quem usou vai pro fim da fila, quem não usou sobe.
 *
 * Se rodadaCiclo passa de 5, reseta automaticamente (nova ordem =
 * inverso da classificação).
 *
 * Body: { pickers: chave[] }   — quem ganhou pick essa rodada (admin define)
 *   ou { reset: true }          — força reset agora
 */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    let body: { pickers?: string[]; reset?: boolean };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const rodadaStatus = await getRodadaStatus(kv);
    const rodadaAtual = rodadaStatus?.rodada ?? 1;

    if (body.reset) {
      const r = await resetDraft(kv, rodadaAtual);
      return new Response(
        JSON.stringify({ ok: true, resetou: true, ...r }),
        { headers: H },
      );
    }

    const pickers = body.pickers ?? [];
    if (!Array.isArray(pickers)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "pickers: chave[] inválido" }),
        { status: 400, headers: H },
      );
    }
    const validas = new Set(TODAS_CHAVES);
    const desconhecidas = pickers.filter((c) => !validas.has(c));
    if (desconhecidas.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `pickers desconhecidos: ${desconhecidas.join(", ")}`,
        }),
        { status: 400, headers: H },
      );
    }

    const r = await avancarRodadaDraft(kv, pickers, rodadaAtual);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: H });
  },
};
