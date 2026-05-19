import { Handlers } from "$fresh/server.ts";
import { criarOferta, listarOfertasRecebidas } from "../../../lib/ofertas.ts";
import { getAllElencos, getAVendaGlobal, isAoVivo } from "../../../lib/kv.ts";
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
    const recebidas = await listarOfertasRecebidas(chave);
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
      atletas_oferecidos?: number[];
      atleta_oferecido?: number; // compat com clients antigos (1:1)
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

    // Normaliza: aceita array novo OU campo legacy single
    const oferecidos: number[] = Array.isArray(body.atletas_oferecidos)
      ? body.atletas_oferecidos.map(Number).filter(Boolean)
      : body.atleta_oferecido
      ? [Number(body.atleta_oferecido)]
      : [];
    const pedido = Number(body.atleta_pedido);

    if (oferecidos.length < 1 || oferecidos.length > 3) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Ofereça entre 1 e 3 jogadores",
        }),
        { status: 400, headers: H },
      );
    }
    if (!pedido) {
      return new Response(
        JSON.stringify({ ok: false, erro: "atleta_pedido obrigatório" }),
        { status: 400, headers: H },
      );
    }
    if (new Set(oferecidos).size !== oferecidos.length) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Atletas oferecidos duplicados" }),
        { status: 400, headers: H },
      );
    }

    if (await isAoVivo()) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Mercado fechado durante a rodada",
        }),
        { status: 423, headers: H },
      );
    }
    const elencos = await getAllElencos();

    // Valida: todos os oferecidos estão no meu elenco
    const meuElenco = elencos[chave]?.jogadores ?? {};
    const jogOferecidos = oferecidos.map((id) => meuElenco[String(id)]);
    if (jogOferecidos.some((j) => !j)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Algum jogador oferecido não está no seu elenco",
        }),
        { status: 400, headers: H },
      );
    }

    // Valida: pedido está em algum elenco (não meu)
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
    const aVendaGlobal = await getAVendaGlobal();
    if (aVendaGlobal[pedido] !== paraChave) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Jogador pedido não está negociável",
        }),
        { status: 400, headers: H },
      );
    }

    // Pelo menos UM oferecido tem que estar na mesma posição do pedido
    // (senão o destinatário não consegue devolver — multiset não fecha).
    const possuiPosPedido = jogOferecidos.some((j) =>
      j!.posicao === jogPedido!.posicao
    );
    if (!possuiPosPedido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro:
            `Pelo menos 1 dos oferecidos precisa ser ${jogPedido.posicao} (posição do pedido)`,
        }),
        { status: 400, headers: H },
      );
    }

    // Pra N>1: destinatário precisa ter pelo menos N-1 jogadores no elenco
    // (fora o atletaPedido) com posições que combinem com o resto dos
    // oferecidos. Validar só conta de posições — qualquer jogador serve
    // desde que casem as posições requeridas.
    if (oferecidos.length > 1) {
      // Posições oferecidas — 1 vai casar com o pedido, sobram N-1 pra extras
      const posOferecidas = jogOferecidos.map((j) => j!.posicao).sort();
      const posPedido = jogPedido.posicao;
      // Tira UMA ocorrência da pos do pedido pra deixar N-1 que precisam de extras
      const idx = posOferecidas.indexOf(posPedido);
      const posExtras = [...posOferecidas];
      posExtras.splice(idx, 1);

      // Conta quantos jogadores o destinatário tem por posição (excluindo o pedido)
      const paraJogadores = Object.values(elencos[paraChave].jogadores)
        .filter((j) => j.atleta_id !== pedido);
      const dispPorPos: Record<string, number> = {};
      for (const j of paraJogadores) {
        dispPorPos[j.posicao] = (dispPorPos[j.posicao] ?? 0) + 1;
      }
      const necessario: Record<string, number> = {};
      for (const p of posExtras) necessario[p] = (necessario[p] ?? 0) + 1;
      for (const [p, n] of Object.entries(necessario)) {
        if ((dispPorPos[p] ?? 0) < n) {
          return new Response(
            JSON.stringify({
              ok: false,
              erro:
                `${paraChave} não tem ${n} ${p}(s) extra(s) pra completar a troca`,
            }),
            { status: 400, headers: H },
          );
        }
      }
    }

    const oferta = await criarOferta({
      deChave: chave,
      paraChave,
      atletasOferecidos: oferecidos,
      atletaPedido: pedido,
      mensagem: body.mensagem,
    });
    return new Response(JSON.stringify({ ok: true, oferta }), { headers: H });
  },
};
