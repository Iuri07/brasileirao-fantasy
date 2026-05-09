import { Handlers } from "$fresh/server.ts";
import { fetchAtletasMercado, fetchPartidas, POSICAO_ID_NOME, POSICAO_NOME_CHAVE } from "../../../lib/cartola.ts";
import { POSICAO_CHAVES_CACHE, getAllElencos, setElenco, setPartidasCache } from "../../../lib/kv.ts";
import type { AtletaCacheKV } from "../../../lib/types.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST() {
    try {
      const kv = await Deno.openKv();
      const [data, partidasData] = await Promise.all([
        fetchAtletasMercado(),
        fetchPartidas().catch(() => null),
      ]);
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
          clube:      clube?.nome_fantasia ?? clube?.nome ?? "",
          clube_id:   a.clube_id,
          posicao:    posNome,
          posicao_id: a.posicao_id,
          status_id:  a.status_id ?? null,
        };
        statusMap.set(a.atleta_id, a.status_id ?? null);
      }

      for (const [chave, atletas] of Object.entries(grupos)) {
        const cache: AtletaCacheKV = { atualizadoEm: now, atletas };
        await kv.set(["atletas_cache", chave], cache);
      }

      // Mapa clube_id → { casa, fora }
      const matchMap = new Map<number, { casa: string; fora: string }>();
      if (partidasData) {
        for (const p of partidasData.partidas) {
          const casaAbrev = partidasData.clubes[String(p.clube_casa_id)]?.abreviacao ?? String(p.clube_casa_id);
          const foraAbrev = partidasData.clubes[String(p.clube_visitante_id)]?.abreviacao ?? String(p.clube_visitante_id);
          matchMap.set(p.clube_casa_id, { casa: casaAbrev, fora: foraAbrev });
          matchMap.set(p.clube_visitante_id, { casa: casaAbrev, fora: foraAbrev });
        }
      }

      // Persiste partidas_cache no KV
      if (partidasData) {
        const partidasRecord: Record<string, { casa: string; fora: string }> = {};
        for (const [id, m] of matchMap) partidasRecord[String(id)] = m;
        await setPartidasCache(kv, partidasRecord);
      }

      // Atualiza status_id e partida nos elencos
      const elencos = await getAllElencos(kv);
      let elencosTocados = 0;
      for (const [chave, elenco] of Object.entries(elencos)) {
        let alterado = false;
        for (const [id, jogador] of Object.entries(elenco.jogadores)) {
          const sid = statusMap.has(jogador.atleta_id) ? statusMap.get(jogador.atleta_id)! : jogador.status_id;
          const match = matchMap.get(jogador.clube_id);
          const novoCasa = match ? match.casa : jogador.clube_casa;
          const novaFora = match ? match.fora : jogador.clube_fora;
          if (jogador.status_id === sid && jogador.clube_casa === novoCasa && jogador.clube_fora === novaFora) continue;
          elenco.jogadores[id] = {
            ...jogador,
            status_id: sid,
            provavel:  sid === 7,
            lesionado: sid === 5,
            suspenso:  sid === 3,
            nulo:      sid === 6,
            clube_casa: novoCasa,
            clube_fora: novaFora,
          };
          alterado = true;
        }
        if (alterado) { await setElenco(kv, chave, elenco); elencosTocados++; }
      }

      return new Response(
        JSON.stringify({ ok: true, total: data.atletas.length, elencosTocados, partidas: matchMap.size / 2, atualizadoEm: now }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: H });
    }
  },
};
