import { Handlers } from "$fresh/server.ts";
import {
  getOferta,
  listarNotifs,
  marcarNotifLida,
  type Notif,
  type Oferta,
} from "../../lib/ofertas.ts";
import { getAllElencos } from "../../lib/kv.ts";
import type { State } from "../_middleware.ts";

const H = { "Content-Type": "application/json" };

export interface NotifPayload extends Notif {
  oferta: Oferta | null;
  /** Nomes resolvidos pra exibir na UI */
  nomeOferecido: string | null;
  nomePedido: string | null;
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
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const [notifs, elencos] = await Promise.all([
      listarNotifs(kv, chave),
      getAllElencos(kv),
    ]);
    // Resolve atleta_id → nome procurando em todos os elencos (jogador
    // pode ter mudado de time entre a criação e a leitura)
    const nomes: Record<number, string> = {};
    for (const e of Object.values(elencos)) {
      for (const [id, j] of Object.entries(e.jogadores)) {
        nomes[Number(id)] = j.apelido_api;
      }
    }
    const payload: NotifPayload[] = await Promise.all(
      notifs.map(async (n) => {
        const oferta = await getOferta(kv, n.ofertaId);
        return {
          ...n,
          oferta,
          nomeOferecido: oferta ? nomes[oferta.atletaOferecido] ?? null : null,
          nomePedido: oferta ? nomes[oferta.atletaPedido] ?? null : null,
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
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    await marcarNotifLida(kv, chave, body.id);
    return new Response(JSON.stringify({ ok: true }), { headers: H });
  },
};
