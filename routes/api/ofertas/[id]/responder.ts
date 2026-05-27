import { Handlers } from "$fresh/server.ts";
import {
  criarNotif,
  getOferta,
  ofertaAtletasOferecidos,
  setOferta,
} from "../../../../lib/ofertas.ts";
import {
  getAVenda,
  getElenco,
  getRodadaStatus,
  isAoVivo,
  setAVenda,
  setElenco,
} from "../../../../lib/kv.ts";
import { registrarTroca } from "../../../../lib/historico-trocas.ts";
import {
  adjustTrocasMercadoCount,
  getMaxTrocasMercado,
  getTrocasMercadoCount,
} from "../../../../lib/trocas-mercado.ts";
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
    let body: { decisao?: "aceita" | "negada"; atletas_extra?: number[] };
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
    if (body.decisao === "aceita" && await isAoVivo()) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro:
            "Mercado fechado durante a rodada — só pode aceitar ofertas fora dela",
        }),
        { status: 423, headers: H },
      );
    }
    const oferta = await getOferta(ofertaId);
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
      const oferecidos = ofertaAtletasOferecidos(oferta);
      const n = oferecidos.length;
      const atletasExtra = Array.isArray(body.atletas_extra)
        ? body.atletas_extra.map(Number).filter(Boolean)
        : [];
      // Pra N=1 (oferta clássica 1:1), atletasExtra pode ser vazio.
      // Pra N>1, precisamos de N-1 extras.
      if (n > 1 && atletasExtra.length !== n - 1) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Precisa escolher ${
              n - 1
            } atleta(s) extra(s) pra completar a troca`,
          }),
          { status: 400, headers: H },
        );
      }
      if (new Set(atletasExtra).size !== atletasExtra.length) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Atletas extra duplicados" }),
          { status: 400, headers: H },
        );
      }
      if (atletasExtra.includes(oferta.atletaPedido)) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Atleta pedido não pode estar nos extras",
          }),
          { status: 400, headers: H },
        );
      }

      const elencoDe = await getElenco(oferta.deChave);
      const elencoPara = await getElenco(oferta.paraChave);
      if (!elencoDe || !elencoPara) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Elenco sumiu" }),
          { status: 500, headers: H },
        );
      }

      // Resolve todos os jogadores envolvidos.
      // Lado A → B (oferecidos vão pro destinatário):
      const jogOferecidos = oferecidos.map((id) =>
        elencoDe.jogadores[String(id)]
      );
      if (jogOferecidos.some((j) => !j)) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Algum atleta oferecido sumiu do elenco do ofertante",
          }),
          { status: 400, headers: H },
        );
      }
      // Lado B → A (pedido + extras vão pro ofertante):
      const jogPedido = elencoPara.jogadores[String(oferta.atletaPedido)];
      if (!jogPedido) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Atleta pedido sumiu" }),
          { status: 400, headers: H },
        );
      }
      const jogExtras = atletasExtra.map((id) =>
        elencoPara.jogadores[String(id)]
      );
      if (jogExtras.some((j) => !j)) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Algum atleta extra não está no seu elenco",
          }),
          { status: 400, headers: H },
        );
      }
      const ladoB = [jogPedido, ...jogExtras]; // o que vai pro deChave

      // Validação multiset de posições: o que sai do lado A precisa
      // bater com o que sai do lado B (mesma combinação de posições).
      const posA = jogOferecidos.map((j) => j!.posicao).sort();
      const posB = ladoB.map((j) => j!.posicao).sort();
      if (posA.length !== posB.length || posA.some((p, i) => p !== posB[i])) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Posições não combinam: oferecidos=[${
              posA.join(",")
            }] vs contrapartida=[${posB.join(",")}]`,
          }),
          { status: 400, headers: H },
        );
      }

      // Pareia 1:1 por posição. Cada jogador A casa com um do B na mesma
      // posição, e o destinatário herda a escalação que o equivalente
      // tinha (assim o "buraco" deixado é preenchido pela mesma função tática).
      const usadosB = new Set<number>();
      const pares: Array<{ a: JogadorKV; b: JogadorKV }> = [];
      for (const a of jogOferecidos) {
        const b = ladoB.find((j) =>
          !usadosB.has(j!.atleta_id) && j!.posicao === a!.posicao
        );
        if (!b) {
          // não deve acontecer dado o multiset bate, mas defensivo
          return new Response(
            JSON.stringify({ ok: false, erro: "Falha ao parear posições" }),
            { status: 500, headers: H },
          );
        }
        usadosB.add(b.atleta_id);
        pares.push({ a: a!, b });
      }

      // Aplica swaps + snapshots pra histórico (suporta desfazer).
      const snapshots: Array<{
        a: {
          atleta_id: number;
          apelido: string;
          escalacaoOriginal: typeof jogOferecidos[number]["escalacao"];
        };
        b: {
          atleta_id: number;
          apelido: string;
          escalacaoOriginal: typeof ladoB[number]["escalacao"];
        };
      }> = [];

      for (const { a, b } of pares) {
        const idA = String(a.atleta_id);
        const idB = String(b.atleta_id);
        const escAOrig = a.escalacao;
        const escBOrig = b.escalacao;
        // a (deChave) → paraChave herdando escalação do b
        const movidoA: JogadorKV = { ...a, escalacao: b.escalacao };
        // b (paraChave) → deChave herdando escalação do a
        const movidoB: JogadorKV = { ...b, escalacao: a.escalacao };
        delete elencoDe.jogadores[idA];
        delete elencoPara.jogadores[idB];
        elencoPara.jogadores[idA] = movidoA;
        elencoDe.jogadores[idB] = movidoB;
        snapshots.push({
          a: {
            atleta_id: a.atleta_id,
            apelido: a.apelido_api,
            escalacaoOriginal: escAOrig,
          },
          b: {
            atleta_id: b.atleta_id,
            apelido: b.apelido_api,
            escalacaoOriginal: escBOrig,
          },
        });
      }

      await setElenco(oferta.deChave, elencoDe);
      await setElenco(oferta.paraChave, elencoPara);

      // Transfere trocas com mercado (se a oferta incluía). deChave
      // passa N do seu saldo restante pro paraChave: deChave.count += N
      // (saldo cai), paraChave.count -= N (saldo sobe, pode ficar
      // negativo = bonus acima do max). Revalida saldo do ofertante —
      // pode ter mudado entre criação e aceite.
      const trocasOf = oferta.trocasOferecidas ?? 0;
      if (trocasOf > 0) {
        const rs = await getRodadaStatus();
        const rodada = rs?.rodada ?? 0;
        if (rodada > 0) {
          const max = getMaxTrocasMercado();
          const countDe = getTrocasMercadoCount(oferta.deChave, rodada);
          const restanteDe = max - countDe;
          if (trocasOf > restanteDe) {
            return new Response(
              JSON.stringify({
                ok: false,
                erro:
                  `${oferta.deChave} não tem mais ${trocasOf} troca(s) com mercado restantes — saldo caiu pra ${
                    Math.max(0, restanteDe)
                  } depois que a oferta foi criada`,
              }),
              { status: 423, headers: H },
            );
          }
          // adjust* permite count negativo (= bônus acima do max
          // pro paraChave). setTrocasMercadoCount clamparia em 0.
          await adjustTrocasMercadoCount(oferta.deChave, rodada, +trocasOf);
          await adjustTrocasMercadoCount(oferta.paraChave, rodada, -trocasOf);
        }
      }

      // Tira o atletaPedido do "negociável" do dono original (paraChave).
      // Extras não precisam tirar — eles não estavam negociáveis.
      const lista = await getAVenda(oferta.paraChave);
      await setAVenda(
        oferta.paraChave,
        lista.filter((id) => id !== oferta.atletaPedido),
      );

      // Histórico: registra UMA troca por par (mantém suporte do
      // desfazer existente, que opera em pares). Admin pode desfazer
      // jogador por jogador.
      for (const s of snapshots) {
        await registrarTroca({
          ofertaId: oferta.id,
          chaveA: oferta.deChave,
          atletaA: s.a,
          chaveB: oferta.paraChave,
          atletaB: s.b,
        });
      }

      // Persiste atletasExtra na oferta pra UI/admin saber o que foi escolhido
      oferta.atletasExtra = atletasExtra;
    }

    const status = body.decisao;
    await setOferta({
      ...oferta,
      status,
      respondidoEm: Date.now(),
    });
    await criarNotif({
      chave: oferta.deChave,
      tipo: status === "aceita" ? "oferta_aceita" : "oferta_negada",
      ofertaId: oferta.id,
    });

    return new Response(JSON.stringify({ ok: true, status }), { headers: H });
  },
};
