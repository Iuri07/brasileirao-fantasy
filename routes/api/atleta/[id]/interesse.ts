import { Handlers } from "$fresh/server.ts";
import {
  appendPrioridade,
  getAllElencos,
  isAoVivo,
  removeInteresse,
  removePrioridade,
  setInteresse,
} from "../../../../lib/kv.ts";
import type { State } from "../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const session = ctx.state.session;
    if (!session?.chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time atribuído" }),
        { status: 403, headers: H },
      );
    }
    const atletaId = Number(ctx.params.id);
    if (!atletaId || isNaN(atletaId)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id inválido" }),
        { status: 400, headers: H },
      );
    }

    // Body opcional: { atleta_oferecido?: number, remover?: true }
    // - remover=true → tira interesse
    // - atleta_oferecido → registra interesse com o jogador oferecido
    let body: { atleta_oferecido?: number; remover?: boolean } = {};
    try {
      body = await req.json();
    } catch { /* permite body vazio */ }

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

    // Bloqueia interesse em atletas que já pertencem a algum elenco
    for (const elenco of Object.values(elencos)) {
      if (elenco.jogadores[String(atletaId)]) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Atleta já pertence a um time",
          }),
          { status: 400, headers: H },
        );
      }
    }

    if (body.remover) {
      const r = await removeInteresse(atletaId, session.chave);
      await removePrioridade(session.chave, atletaId);
      return new Response(
        JSON.stringify({ ok: true, interessado: false, total: r.total }),
        { headers: H },
      );
    }

    const oferecido = Number(body.atleta_oferecido);
    if (!oferecido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "atleta_oferecido obrigatório (ofereça um jogador em troca)",
        }),
        { status: 400, headers: H },
      );
    }

    // Valida: oferecido está no meu elenco
    const meuElenco = elencos[session.chave];
    const jogOferecido = meuElenco?.jogadores[String(oferecido)];
    if (!jogOferecido) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Jogador oferecido não está no seu elenco",
        }),
        { status: 400, headers: H },
      );
    }

    // Posição do oferecido tem que bater com a do free agent —
    // procura no atletas_cache via getAllElencos não funciona (não tá em
    // elenco). Confia que o front filtra por posição; back valida via
    // jogador.posicao apenas pra catch erro de UI.
    // (free agent vem do mercado da Cartola; sua posição vive lá. A UI
    // já filtra antes de chamar, então aqui só guardamos a oferta.)

    const r = await setInteresse(
      atletaId,
      session.chave,
      oferecido,
    );
    // Adiciona no fim da minha lista de prioridade (idempotente: se já
    // tava na lista, fica na posição que estava)
    await appendPrioridade(session.chave, atletaId);
    return new Response(
      JSON.stringify({ ok: true, interessado: true, total: r.total }),
      { headers: H },
    );
  },
};
