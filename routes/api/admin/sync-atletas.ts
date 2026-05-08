import { Handlers } from "$fresh/server.ts";
import { fetchAtletasMercado, POSICAO_ID_NOME, POSICAO_NOME_CHAVE } from "../../../lib/cartola.ts";
import { POSICAO_CHAVES_CACHE, getAllElencos, setElenco } from "../../../lib/kv.ts";
import type { AtletaCacheKV } from "../../../lib/types.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST() {
    try {
      const kv = await Deno.openKv();
      const data = await fetchAtletasMercado();
      const now = new Date().toISOString();

      // Cache de atletas por posição (para busca/troca)
      const grupos: Record<string, Record<string, { apelido: string; clube: string; clube_id: number; posicao: string; posicao_id: number }>> = {};
      for (const c of POSICAO_CHAVES_CACHE) grupos[c] = {};

      const statusMap = new Map<number, number | null>();

      for (const a of data.atletas) {
        const posNome = POSICAO_ID_NOME[a.posicao_id];
        if (!posNome) continue;
        const posChave = POSICAO_NOME_CHAVE[posNome];
        if (!posChave) continue;
        const clube = data.clubes[String(a.clube_id)];
        grupos[posChave][String(a.atleta_id)] = {
          apelido:    a.apelido,
          clube:      clube?.nome ?? "",
          clube_id:   a.clube_id,
          posicao:    posNome,
          posicao_id: a.posicao_id,
        };
        statusMap.set(a.atleta_id, a.status_id ?? null);
      }

      for (const [chave, atletas] of Object.entries(grupos)) {
        const cache: AtletaCacheKV = { atualizadoEm: now, atletas };
        await kv.set(["atletas_cache", chave], cache);
      }

      // Atualiza status_id nos elencos (lesionado, suspenso, provável)
      const elencos = await getAllElencos(kv);
      let elencosTocados = 0;
      for (const [chave, elenco] of Object.entries(elencos)) {
        let alterado = false;
        for (const [id, jogador] of Object.entries(elenco.jogadores)) {
          const sid = statusMap.get(jogador.atleta_id);
          if (sid === undefined || jogador.status_id === sid) continue;
          elenco.jogadores[id] = {
            ...jogador,
            status_id: sid,
            provavel:  sid === 5,
            lesionado: sid === 2,
            suspenso:  sid === 3,
            nulo:      sid === 6,
          };
          alterado = true;
        }
        if (alterado) { await setElenco(kv, chave, elenco); elencosTocados++; }
      }

      return new Response(
        JSON.stringify({ ok: true, total: data.atletas.length, elencosTocados, atualizadoEm: now }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: H });
    }
  },
};
