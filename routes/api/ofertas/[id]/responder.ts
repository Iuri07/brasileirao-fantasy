import { Handlers } from "$fresh/server.ts";
import { criarNotif, getOferta, setOferta } from "../../../../lib/ofertas.ts";
import {
  getAVenda,
  getElenco,
  isAoVivo,
  setAVenda,
  setElenco,
} from "../../../../lib/kv.ts";
import { registrarTroca } from "../../../../lib/historico-trocas.ts";
import type { JogadorKV } from "../../../../lib/types.ts";
import type { State } from "../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    const ofertaId = ctx.params.id;
    let body: { decisao?: "aceita" | "negada" };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (body.decisao !== "aceita" && body.decisao !== "negada") {
      return new Response(
        JSON.stringify({ ok: false, erro: "decisao = aceita|negada" }),
        { status: 400, headers: H },
      );
    }
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    if (body.decisao === "aceita" && await isAoVivo(kv)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro:
            "Mercado fechado durante a rodada — só pode aceitar ofertas fora dela",
        }),
        { status: 423, headers: H },
      );
    }
    const oferta = await getOferta(kv, ofertaId);
    if (!oferta) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Oferta não encontrada" }),
        { status: 404, headers: H },
      );
    }
    if (oferta.paraChave !== chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Você não é o destinatário" }),
        { status: 403, headers: H },
      );
    }
    if (oferta.status !== "pendente") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Oferta já respondida" }),
        { status: 400, headers: H },
      );
    }

    if (body.decisao === "aceita") {
      // Executa a troca: oferecido vai pro elenco do destinatário (paraChave)
      // pedido vai pro elenco do ofertante (deChave).
      // Mantém a categoria de escalação que cada um já tinha no respectivo elenco
      // (o que entra herda a categoria do que sai).
      const elencoDe = await getElenco(kv, oferta.deChave);
      const elencoPara = await getElenco(kv, oferta.paraChave);
      if (!elencoDe || !elencoPara) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Elenco sumiu" }),
          { status: 500, headers: H },
        );
      }
      const idOf = String(oferta.atletaOferecido);
      const idPd = String(oferta.atletaPedido);
      const jogOferecido = elencoDe.jogadores[idOf];
      const jogPedido = elencoPara.jogadores[idPd];
      if (!jogOferecido || !jogPedido) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Jogadores não bateram" }),
          { status: 400, headers: H },
        );
      }
      // Snapshot da escalação ANTES do swap — pra histórico/desfazer.
      const escAOriginal = jogOferecido.escalacao;
      const escBOriginal = jogPedido.escalacao;

      const movido1: JogadorKV = {
        ...jogOferecido,
        escalacao: jogPedido.escalacao,
      };
      const movido2: JogadorKV = {
        ...jogPedido,
        escalacao: jogOferecido.escalacao,
      };
      delete elencoDe.jogadores[idOf];
      delete elencoPara.jogadores[idPd];
      elencoPara.jogadores[idOf] = movido1;
      elencoDe.jogadores[idPd] = movido2;
      await setElenco(kv, oferta.deChave, elencoDe);
      await setElenco(kv, oferta.paraChave, elencoPara);

      // Tira do "à venda" do dono original (paraChave)
      const lista = await getAVenda(kv, oferta.paraChave);
      await setAVenda(
        kv,
        oferta.paraChave,
        lista.filter((id) => id !== oferta.atletaPedido),
      );

      // Registra no histórico pra admin poder desfazer depois.
      await registrarTroca(kv, {
        ofertaId: oferta.id,
        chaveA: oferta.deChave,
        atletaA: {
          atleta_id: jogOferecido.atleta_id,
          apelido: jogOferecido.apelido_api,
          escalacaoOriginal: escAOriginal,
        },
        chaveB: oferta.paraChave,
        atletaB: {
          atleta_id: jogPedido.atleta_id,
          apelido: jogPedido.apelido_api,
          escalacaoOriginal: escBOriginal,
        },
      });
    }

    const status = body.decisao;
    await setOferta(kv, {
      ...oferta,
      status,
      respondidoEm: Date.now(),
    });
    await criarNotif(kv, {
      chave: oferta.deChave,
      tipo: status === "aceita" ? "oferta_aceita" : "oferta_negada",
      ofertaId: oferta.id,
    });

    return new Response(JSON.stringify({ ok: true, status }), { headers: H });
  },
};
