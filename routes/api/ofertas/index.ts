import { Handlers } from "$fresh/server.ts";
import {
  criarOferta,
  listarOfertasRecebidas,
} from "../../../lib/ofertas.ts";
import { getAllElencos, getAVendaGlobal } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async GET(_req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    const kv = await Deno.openKv();
    const recebidas = await listarOfertasRecebidas(kv, chave);
    return new Response(JSON.stringify({ ok: true, recebidas }), {
      headers: H,
    });
  },

  async POST(req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    let body: {
      atleta_oferecido?: number;
      atleta_pedido?: number;
      mensagem?: string;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    const oferecido = Number(body.atleta_oferecido);
    const pedido = Number(body.atleta_pedido);
    if (!oferecido || !pedido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "atleta_oferecido e atleta_pedido obrigatórios",
        }),
        { status: 400, headers: H },
      );
    }

    const kv = await Deno.openKv();
    const elencos = await getAllElencos(kv);

    // Valida: oferecido está no meu elenco
    const jogOferecido = elencos[chave]?.jogadores[String(oferecido)];
    if (!jogOferecido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Jogador oferecido não está no seu elenco",
        }),
        { status: 400, headers: H },
      );
    }

    // Valida: pedido está em algum elenco (não meu) E está à venda
    let paraChave: string | null = null;
    let jogPedido = null;
    for (const [k, e] of Object.entries(elencos)) {
      if (k === chave) continue;
      if (e.jogadores[String(pedido)]) {
        paraChave = k;
        jogPedido = e.jogadores[String(pedido)];
        break;
      }
    }
    if (!paraChave || !jogPedido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Jogador pedido não está em nenhum outro time",
        }),
        { status: 400, headers: H },
      );
    }
    const aVendaGlobal = await getAVendaGlobal(kv);
    if (aVendaGlobal[pedido] !== paraChave) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Jogador pedido não está à venda",
        }),
        { status: 400, headers: H },
      );
    }

    // Posições devem ser iguais
    if (jogOferecido.posicao !== jogPedido.posicao) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Posições incompatíveis: ${jogOferecido.posicao} ↔ ${jogPedido.posicao}`,
        }),
        { status: 400, headers: H },
      );
    }

    const oferta = await criarOferta(kv, {
      deChave: chave,
      paraChave,
      atletaOferecido: oferecido,
      atletaPedido: pedido,
      mensagem: body.mensagem,
    });
    return new Response(JSON.stringify({ ok: true, oferta }), { headers: H });
  },
};
