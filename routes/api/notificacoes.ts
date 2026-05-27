import { Handlers } from "$fresh/server.ts";
import {
  getOferta,
  listarNotifs,
  marcarNotifLida,
  type Notif,
  type Oferta,
  ofertaAtletasOferecidos,
} from "../../lib/ofertas.ts";
import { getAllElencos } from "../../lib/kv.ts";
import type { State } from "../_middleware.ts";

const H = { "Content-Type": "application/json" };

export interface NotifPayload extends Notif {
  oferta: Oferta | null;
  /** Nomes resolvidos pra exibir na UI — agora plural (lista de oferecidos). */
  nomesOferecidos: string[];
  posicoesOferecidas: string[];
  nomePedido: string | null;
  posicaoPedido: string | null;
}

export const handler: Handlers<unknown, State> = {
  async GET(_req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    const [notifs, elencos] = await Promise.all([
      listarNotifs(chave),
      getAllElencos(),
    ]);
    // Resolve atleta_id → { apelido, posicao } procurando em todos os
    // elencos (jogador pode ter mudado de time entre criação e leitura).
    const info: Record<number, { apelido: string; posicao: string }> = {};
    for (const e of Object.values(elencos)) {
      for (const [id, j] of Object.entries(e.jogadores)) {
        info[Number(id)] = { apelido: j.apelido_api, posicao: j.posicao };
      }
    }
    const payload: NotifPayload[] = await Promise.all(
      notifs.map(async (n) => {
        // troca_mercado usa ofertaId sintético (swap-<ts>) — pula o
        // join que vai falhar.
        const oferta = n.tipo === "troca_mercado"
          ? null
          : await getOferta(n.ofertaId);
        const oferecidos = oferta ? ofertaAtletasOferecidos(oferta) : [];
        return {
          ...n,
          oferta,
          nomesOferecidos: oferecidos.map((id) =>
            info[id]?.apelido ?? `#${id}`
          ),
          posicoesOferecidas: oferecidos.map((id) => info[id]?.posicao ?? "?"),
          nomePedido: oferta
            ? info[oferta.atletaPedido]?.apelido ?? null
            : null,
          posicaoPedido: oferta
            ? info[oferta.atletaPedido]?.posicao ?? null
            : null,
        };
      }),
    );
    return new Response(JSON.stringify({ ok: true, notifs: payload }), {
      headers: H,
    });
  },

  async POST(req, ctx) {
    // Marca notif como lida
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    let body: { id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (!body.id) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id obrigatório" }),
        { status: 400, headers: H },
      );
    }
    await marcarNotifLida(chave, body.id);
    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
