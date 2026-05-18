import { Handlers } from "$fresh/server.ts";
import {
  fetchAtletasMercado,
  fetchPartidas,
  POSICAO_ID_NOME,
  POSICAO_NOME_CHAVE,
} from "../../../lib/cartola.ts";
import {
  getAllElencos,
  getAtletasCache,
  POSICAO_CHAVES_CACHE,
  setElenco,
  setPartidasCache,
} from "../../../lib/kv.ts";
import { CUTOUTS_DISPONIVEIS } from "../../../lib/cutouts-manifest.ts";
import type { AtletaCacheEntry, AtletaCacheKV } from "../../../lib/types.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST() {
    try {
      const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
      const [data, partidasData] = await Promise.all([
        fetchAtletasMercado(),
        fetchPartidas().catch(() => null),
      ]);
      const now = new Date().toISOString();

      // Preserva fotos REAIS já encontradas (TheSportsDB) pra não sobrescrever
      // com silhueta da Cartola.
      const cacheAtual = new Map<string, AtletaCacheEntry>();
      for (const pos of POSICAO_CHAVES_CACHE) {
        const c = await getAtletasCache(kv, pos);
        if (!c) continue;
        for (const [id, e] of Object.entries(c.atletas)) cacheAtual.set(id, e);
      }

      // Cache de atletas por posição (para busca/troca)
      const grupos: Record<string, Record<string, AtletaCacheEntry>> = {};
      for (const c of POSICAO_CHAVES_CACHE) grupos[c] = {};

      const statusMap = new Map<number, number | null>();
      const clubeNomeMap = new Map<number, string>();
      let fotosCount = 0;
      let cutoutsCount = 0;

      for (const a of data.atletas) {
        const posNome = POSICAO_ID_NOME[a.posicao_id];
        if (!posNome) continue;
        const posChave = POSICAO_NOME_CHAVE[posNome];
        if (!posChave) continue;
        const clube = data.clubes[String(a.clube_id)];
        const clubeNome = clube?.nome_fantasia ?? clube?.nome ?? "";
        const idStr = String(a.atleta_id);
        const fotoExistente = cacheAtual.get(idStr)?.foto;
        const cartolaFoto = a.foto ? a.foto.replace("FORMATO", "220x220") : null;
        // Prioridade: cutout local → foto real preservada → Cartola (silhueta)
        const foto = CUTOUTS_DISPONIVEIS.has(idStr)
          ? `/atletas/${idStr}.png`
          : fotoExistente && !fotoExistente.includes("silh")
          ? fotoExistente
          : cartolaFoto;
        if (foto) fotosCount++;
        if (CUTOUTS_DISPONIVEIS.has(idStr)) cutoutsCount++;
        grupos[posChave][String(a.atleta_id)] = {
          apelido: a.apelido,
          clube: clubeNome,
          clube_id: a.clube_id,
          posicao: posNome,
          posicao_id: a.posicao_id,
          status_id: a.status_id ?? null,
          foto,
        };
        statusMap.set(a.atleta_id, a.status_id ?? null);
        clubeNomeMap.set(a.atleta_id, clubeNome);
      }

      for (const [chave, atletas] of Object.entries(grupos)) {
        const cache: AtletaCacheKV = { atualizadoEm: now, atletas };
        await kv.set(["atletas_cache", chave], cache);
      }

      // Mapa clube_id → { casa, fora }
      const matchMap = new Map<number, { casa: string; fora: string }>();
      if (partidasData) {
        for (const p of partidasData.partidas) {
          const casaAbrev =
            partidasData.clubes[String(p.clube_casa_id)]?.abreviacao ??
              String(p.clube_casa_id);
          const foraAbrev =
            partidasData.clubes[String(p.clube_visitante_id)]?.abreviacao ??
              String(p.clube_visitante_id);
          matchMap.set(p.clube_casa_id, { casa: casaAbrev, fora: foraAbrev });
          matchMap.set(p.clube_visitante_id, {
            casa: casaAbrev,
            fora: foraAbrev,
          });
        }
      }

      // Persiste partidas_cache no KV
      if (partidasData) {
        const partidasRecord: Record<string, { casa: string; fora: string }> =
          {};
        for (const [id, m] of matchMap) partidasRecord[String(id)] = m;
        await setPartidasCache(kv, partidasRecord);
      }

      // Atualiza status_id, clube e partida nos elencos
      const elencos = await getAllElencos(kv);
      let elencosTocados = 0;
      for (const [chave, elenco] of Object.entries(elencos)) {
        let alterado = false;
        for (const [id, jogador] of Object.entries(elenco.jogadores)) {
          const sid = statusMap.has(jogador.atleta_id)
            ? statusMap.get(jogador.atleta_id)!
            : jogador.status_id;
          const novoClube = clubeNomeMap.get(jogador.atleta_id) ??
            jogador.clube;
          const match = matchMap.get(jogador.clube_id);
          const novoCasa = match ? match.casa : jogador.clube_casa;
          const novaFora = match ? match.fora : jogador.clube_fora;
          if (
            jogador.status_id === sid &&
            jogador.clube === novoClube &&
            jogador.clube_casa === novoCasa &&
            jogador.clube_fora === novaFora
          ) continue;
          elenco.jogadores[id] = {
            ...jogador,
            status_id: sid,
            provavel: sid === 7,
            lesionado: sid === 5,
            suspenso: sid === 3,
            nulo: sid === 6,
            clube: novoClube,
            clube_casa: novoCasa,
            clube_fora: novaFora,
          };
          alterado = true;
        }
        if (alterado) {
          await setElenco(kv, chave, elenco);
          elencosTocados++;
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          total: data.atletas.length,
          elencosTocados,
          partidas: matchMap.size / 2,
          fotos: fotosCount,
          cutouts: cutoutsCount,
          atualizadoEm: now,
        }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
        status: 500,
        headers: H,
      });
    }
  },
};
