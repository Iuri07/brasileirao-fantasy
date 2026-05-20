import { Handlers } from "$fresh/server.ts";
import { fetchAtletasMercadoCacheado } from "../../../../lib/cartola.ts";
import { getAllElencos, getAVendaGlobal } from "../../../../lib/kv.ts";
import { getInteressados } from "../../../../lib/kv.ts";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/** GET /api/atleta/[id]/info
 *
 *  Agrega dados de um atleta pra modal de detalhes:
 *  - scout cumulativo da temporada (Cartola)
 *  - jogos jogados + média + última
 *  - se está em algum elenco da liga: chave do dono + nome do time
 *  - lista de chaves que demonstraram interesse (free agent)
 *
 *  Não retorna histórico per-rodada porque Cartola não expõe — só o
 *  total acumulado em `scout`.
 */
export const handler: Handlers = {
  async GET(_req, ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return new Response(
        JSON.stringify({ ok: false, erro: "id inválido" }),
        { status: 400, headers: H },
      );
    }
    try {
      const mercado = await fetchAtletasMercadoCacheado();
      const a = mercado.atletas.find((x) => x.atleta_id === id);
      if (!a) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Atleta não encontrado" }),
          { status: 404, headers: H },
        );
      }
      const clube = mercado.clubes[String(a.clube_id)];
      // Scout vem como Record<codigo, qtd> direto da Cartola
      // deno-lint-ignore no-explicit-any
      const scout = (a as any).scout as Record<string, number> | undefined;
      // deno-lint-ignore no-explicit-any
      const jogos = (a as any).jogos_num as number | undefined;
      // deno-lint-ignore no-explicit-any
      const media = (a as any).media_num as number | undefined;
      // deno-lint-ignore no-explicit-any
      const preco = (a as any).preco_num as number | undefined;
      // deno-lint-ignore no-explicit-any
      const variacao = (a as any).variacao_num as number | undefined;
      const ultima = a.pontos_num ?? null;

      // Dono na liga?
      const [elencos, aVenda] = await Promise.all([
        getAllElencos(),
        getAVendaGlobal(),
      ]);
      let donoChave: string | null = null;
      let donoNome: string | null = null;
      for (const [chave, elenco] of Object.entries(elencos)) {
        if (elenco.jogadores[String(id)]) {
          donoChave = chave;
          donoNome = elenco.nome_time;
          break;
        }
      }
      const negociavel = aVenda[id] != null;

      // Interesses (só pra free agents — quem ofereceu por ele)
      const interesses = donoChave ? [] : await getInteressados(id);

      return new Response(
        JSON.stringify({
          ok: true,
          atleta: {
            atleta_id: id,
            apelido: a.apelido,
            // deno-lint-ignore no-explicit-any
            nome_completo: (a as any).nome ?? null,
            // deno-lint-ignore no-explicit-any
            slug: (a as any).slug ?? null,
            posicao_id: a.posicao_id,
            clube_id: a.clube_id,
            clube_nome: clube?.nome_fantasia ?? clube?.nome ?? "",
            status_id: a.status_id ?? null,
            jogos: jogos ?? 0,
            ultima,
            media: media ?? null,
            preco: preco ?? null,
            variacao: variacao ?? null,
            scout: scout ?? {},
          },
          donoChave,
          donoNome,
          negociavel,
          interesses,
        }),
        { headers: H },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, erro: String(e) }),
        { status: 500, headers: H },
      );
    }
  },
};
