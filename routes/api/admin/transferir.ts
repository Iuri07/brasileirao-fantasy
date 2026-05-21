import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, TODAS_CHAVES } from "../../../lib/kv.ts";
import {
  fetchAtletasMercadoCacheado,
  POSICAO_ID_NOME,
} from "../../../lib/cartola.ts";
import type { JogadorKV } from "../../../lib/types.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

interface Body {
  atleta_id: number;
  /** Time origem. null = vem do mercado (free agent → time). */
  from_chave: string | null;
  /** Time destino. null = vai pro mercado (time → free agent). */
  to_chave: string | null;
  /** Categoria no time destino. Default "Banco". Ignorado se to_chave null. */
  escalacao_destino?: "Sim" | "Banco" | "Não";
}

/**
 * Admin-only: move um atleta entre dois times, OU entre time e mercado
 * (free agent). Bypass total do fluxo de ofertas — usado pra corrigir
 * bugs, ajustar elencos manualmente, repor jogadores que foram
 * acidentalmente removidos, etc.
 *
 * Combinações:
 * - from_chave + to_chave (ambos): transfere entre times (comportamento original)
 * - from_chave + to_chave=null: remove jogador do time (vira free agent)
 * - from_chave=null + to_chave: adiciona free agent ao time (busca metadata
 *   no /atletas/mercado da Cartola)
 *
 * Não é atomic entre os 2 setElenco — KV.atomic só funciona dentro
 * da mesma operação. setElenco já é atomic per-key.
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

    const fromChave = body.from_chave?.toLowerCase() ?? null;
    const toChave = body.to_chave?.toLowerCase() ?? null;
    if (!body.atleta_id) {
      return new Response(
        JSON.stringify({ ok: false, erro: "atleta_id obrigatório" }),
        { status: 400, headers: H },
      );
    }
    if (!fromChave && !toChave) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Pelo menos um de from_chave ou to_chave deve ser informado",
        }),
        { status: 400, headers: H },
      );
    }
    if (fromChave && !TODAS_CHAVES.includes(fromChave)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Time origem inválido: ${fromChave}`,
        }),
        { status: 400, headers: H },
      );
    }
    if (toChave && !TODAS_CHAVES.includes(toChave)) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Time destino inválido: ${toChave}`,
        }),
        { status: 400, headers: H },
      );
    }
    if (fromChave && toChave && fromChave === toChave) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Origem e destino iguais" }),
        { status: 400, headers: H },
      );
    }

    const idStr = String(body.atleta_id);

    // Caso 1: mercado → time. Busca atleta no /atletas/mercado da Cartola,
    // verifica que não está em NENHUM outro elenco, monta o JogadorKV.
    if (!fromChave && toChave) {
      const to = await getElenco(toChave);
      if (!to) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Elenco destino ${toChave} não existe`,
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
      // Verifica se já tem dono em outro lugar — admin deveria usar
      // from_chave nesse caso. Evita ghost-duplicate de player em 2 times.
      const allElencos = await Promise.all(
        TODAS_CHAVES.map(async (c) => ({ chave: c, e: await getElenco(c) })),
      );
      for (const { chave, e } of allElencos) {
        if (e?.jogadores[idStr]) {
          return new Response(
            JSON.stringify({
              ok: false,
              erro:
                `Atleta ${idStr} já está no elenco de ${chave}. Use from_chave="${chave}" pra transferir.`,
            }),
            { status: 409, headers: H },
          );
        }
      }
      // Fetcha do mercado pra montar JogadorKV
      const mercado = await fetchAtletasMercadoCacheado();
      const a = mercado.atletas.find((x) => x.atleta_id === body.atleta_id);
      if (!a) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Atleta ${idStr} não encontrado no mercado Cartola`,
          }),
          { status: 404, headers: H },
        );
      }
      const clube = mercado.clubes[String(a.clube_id)];
      const novo: JogadorKV = {
        atleta_id: a.atleta_id,
        apelido_api: a.apelido,
        clube: clube?.nome_fantasia ?? clube?.nome ?? "",
        clube_id: a.clube_id,
        posicao: POSICAO_ID_NOME[a.posicao_id] ?? "Atacante",
        posicao_id: a.posicao_id,
        escalacao: body.escalacao_destino ?? "Banco",
        status_id: a.status_id ?? null,
        provavel: a.status_id === 7,
        lesionado: a.status_id === 5,
        suspenso: a.status_id === 3,
        nulo: a.status_id === 6,
        entrou_em_campo: null,
        clube_casa: null,
        clube_fora: null,
        pontos: null,
      };
      to.jogadores[idStr] = novo;
      await setElenco(toChave, to);
      return new Response(
        JSON.stringify({
          ok: true,
          atleta_id: body.atleta_id,
          from: null,
          to: toChave,
          apelido: novo.apelido_api,
        }),
        { headers: H },
      );
    }

    // Casos 2 e 3: precisamos do elenco origem
    const from = await getElenco(fromChave!);
    if (!from) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Elenco origem ${fromChave} não existe`,
        }),
        { status: 404, headers: H },
      );
    }
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

    // Caso 2: time → mercado. Só remove do elenco origem.
    if (!toChave) {
      delete from.jogadores[idStr];
      await setElenco(fromChave!, from);
      return new Response(
        JSON.stringify({
          ok: true,
          atleta_id: body.atleta_id,
          from: fromChave,
          to: null,
          apelido: jogador.apelido_api,
        }),
        { headers: H },
      );
    }

    // Caso 3: time → time (comportamento original)
    const to = await getElenco(toChave);
    if (!to) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Elenco destino ${toChave} não existe`,
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
    delete from.jogadores[idStr];
    to.jogadores[idStr] = {
      ...jogador,
      escalacao: body.escalacao_destino ?? "Banco",
    };
    await setElenco(fromChave!, from);
    await setElenco(toChave, to);
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
