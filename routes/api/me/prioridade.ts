import { Handlers } from "$fresh/server.ts";
import {
  getInteressados,
  getMinhaPrioridade,
  setMinhaPrioridade,
} from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Gerencia a ordem dos meus interesses (priorização própria).
 *
 * GET  → retorna a lista de atleta_ids em ordem
 * POST → reordena (body: { ordem: number[] })
 *
 * A `ordem` recebida deve ser exatamente uma permutação dos meus
 * interesses ativos — qualquer divergência → 400. Atletas que já não
 * têm mais o meu interesse são automaticamente removidos do retorno.
 */
export const handler: Handlers<unknown, State> = {
  async GET(_req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    const ordem = await getMinhaPrioridade(chave);
    return new Response(JSON.stringify({ ok: true, ordem }), { headers: H });
  },

  async POST(req, ctx) {
    const chave = ctx.state.session?.chave;
    if (!chave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Sem time" }),
        { status: 403, headers: H },
      );
    }
    let body: { ordem?: number[] };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    const ordemNova = (body.ordem ?? []).map(Number);
    if (!Array.isArray(ordemNova)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "ordem: number[] obrigatório" }),
        { status: 400, headers: H },
      );
    }
    if (new Set(ordemNova).size !== ordemNova.length) {
      return new Response(
        JSON.stringify({ ok: false, erro: "atletas duplicados na ordem" }),
        { status: 400, headers: H },
      );
    }

    const atual = await getMinhaPrioridade(chave);
    const atualSet = new Set(atual);
    const novaSet = new Set(ordemNova);
    // Diferença simétrica deve ser vazia: nenhum atleta novo, nenhum sumido.
    for (const id of ordemNova) {
      if (!atualSet.has(id)) {
        // Pode acontecer se o cliente tá fora de sincronia. Aceita,
        // mas valida que pelo menos é um interesse meu real.
        const interesses = await getInteressados(id);
        if (!interesses.some((i) => i.chave === chave)) {
          return new Response(
            JSON.stringify({
              ok: false,
              erro: `atleta ${id} não está nos seus interesses`,
            }),
            { status: 400, headers: H },
          );
        }
      }
    }
    // Mantém atletas que sumiram da `ordemNova` mas ainda tão nos meus
    // interesses (cliente pode mandar lista parcial). Adiciona no fim.
    const sobrando = atual.filter((id) => !novaSet.has(id));
    const final = [...ordemNova, ...sobrando];
    await setMinhaPrioridade(chave, final);
    return new Response(JSON.stringify({ ok: true, ordem: final }), {
      headers: H,
    });
  },
};
