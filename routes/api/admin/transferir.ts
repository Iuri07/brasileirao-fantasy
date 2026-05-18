import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

interface Body {
  atleta_id: number;
  from_chave: string;
  to_chave: string;
  /** Categoria no time destino. Default "Banco". */
  escalacao_destino?: "Sim" | "Banco" | "Não";
}

/**
 * Admin-only: transfere um atleta de um time pra outro, fora do fluxo
 * de ofertas/troca. Usado pra corrigir bugs, ajustar manualmente, ou
 * mover jogadores quando um dono novo entra na liga.
 *
 * Não é atomic entre os 2 setElenco — KV.atomic só funciona dentro
 * da mesma operação, e setElenco já é atomic per-key (elenco+cache).
 * Risco baixo: se segundo set falhar, jogador ficou só no destino —
 * admin pode rerun pra fixar.
 */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Admin only" }),
        { status: 403, headers: H },
      );
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }

    const fromChave = body.from_chave?.toLowerCase();
    const toChave = body.to_chave?.toLowerCase();
    if (!body.atleta_id || !fromChave || !toChave) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "atleta_id, from_chave e to_chave obrigatórios",
        }),
        { status: 400, headers: H },
      );
    }
    if (!TODAS_CHAVES.includes(fromChave)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Time origem inválido: ${fromChave}`,
        }),
        { status: 400, headers: H },
      );
    }
    if (!TODAS_CHAVES.includes(toChave)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Time destino inválido: ${toChave}`,
        }),
        { status: 400, headers: H },
      );
    }
    if (fromChave === toChave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Origem e destino iguais" }),
        { status: 400, headers: H },
      );
    }

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const [from, to] = await Promise.all([
      getElenco(kv, fromChave),
      getElenco(kv, toChave),
    ]);
    if (!from || !to) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Elenco origem/destino não existe" }),
        { status: 404, headers: H },
      );
    }

    const idStr = String(body.atleta_id);
    const jogador = from.jogadores[idStr];
    if (!jogador) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Atleta ${idStr} não está no elenco de ${fromChave}`,
        }),
        { status: 404, headers: H },
      );
    }
    if (to.jogadores[idStr]) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Atleta ${idStr} já está no elenco de ${toChave}`,
        }),
        { status: 409, headers: H },
      );
    }

    // Remove de origem, adiciona em destino (preserva metadados; só muda
    // o status de escalação se admin pediu).
    delete from.jogadores[idStr];
    to.jogadores[idStr] = {
      ...jogador,
      escalacao: body.escalacao_destino ?? "Banco",
    };
    await setElenco(kv, fromChave, from);
    await setElenco(kv, toChave, to);

    return new Response(
      JSON.stringify({
        ok: true,
        atleta_id: body.atleta_id,
        from: fromChave,
        to: toChave,
        apelido: jogador.apelido_api,
      }),
      { headers: H },
    );
  },
};
