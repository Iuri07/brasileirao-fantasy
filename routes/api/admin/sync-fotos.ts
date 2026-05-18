import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getAtletasCache,
  POSICAO_CHAVES_CACHE,
} from "../../../lib/kv.ts";
import { fetchPlayerPhoto, sleep } from "../../../lib/sportsdb.ts";
import type { AtletaCacheEntry, AtletaCacheKV } from "../../../lib/types.ts";

const H = { "Content-Type": "application/json" };
const RATE_DELAY_MS = 2200; // ~27 req/min, dentro do free tier do TheSportsDB

export const handler: Handlers = {
  /**
   * Busca fotos REAIS no TheSportsDB pros atletas escalados em algum
   * elenco. Atualiza AtletaCacheEntry.foto se encontrar (preserva
   * silhueta da Cartola como fallback se retornar null).
   *
   * Demora: ~99 escalados únicos × 2.2s = ~3.5min na pior hipótese.
   * Pode ser interrompido — re-rodar continua de onde parou (skip se
   * foto não-silhueta já existe).
   */
  async POST() {
    try {
      const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);

      // 1. Coleta atleta_ids escalados (sim) em qualquer elenco
      const elencos = await getAllElencos(kv);
      const escaladosIds = new Set<number>();
      for (const elenco of Object.values(elencos)) {
        for (const j of Object.values(elenco.jogadores)) {
          if (j.escalacao === "Sim") escaladosIds.add(j.atleta_id);
        }
      }

      // 2. Carrega cache atual por posição, indexa por atleta_id
      const caches = new Map<string, AtletaCacheKV>();
      const entryByAtleta = new Map<
        number,
        { posChave: string; entry: AtletaCacheEntry }
      >();
      for (const pos of POSICAO_CHAVES_CACHE) {
        const c = await getAtletasCache(kv, pos);
        if (!c) continue;
        caches.set(pos, c);
        for (const [id, entry] of Object.entries(c.atletas)) {
          entryByAtleta.set(Number(id), { posChave: pos, entry });
        }
      }

      // 3. Pra cada escalado, busca no TheSportsDB se ainda não tem foto real
      let buscas = 0;
      let achados = 0;
      let pulados = 0;
      const tocadosPorPos = new Set<string>();

      for (const atletaId of escaladosIds) {
        const ref = entryByAtleta.get(atletaId);
        if (!ref) continue;
        // Skip se já tem foto do TheSportsDB (cutout transparente, homogêneo
        // no fundo preto). Reprocessa silhuetas Cartola e fotos com fundo
        // sólido da API-Football (média-sports.io) — não casam com o tema.
        const foto = ref.entry.foto;
        const isCutout = foto && foto.includes("thesportsdb.com");
        if (isCutout) {
          pulados++;
          continue;
        }
        buscas++;
        const url = await fetchPlayerPhoto(ref.entry.apelido, ref.entry.clube);
        if (url) {
          ref.entry.foto = url;
          tocadosPorPos.add(ref.posChave);
          achados++;
        }
        await sleep(RATE_DELAY_MS);
      }

      // 4. Persiste caches alterados
      for (const pos of tocadosPorPos) {
        const c = caches.get(pos);
        if (c) {
          c.atualizadoEm = new Date().toISOString();
          await kv.set(["atletas_cache", pos], c);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          escalados: escaladosIds.size,
          buscas,
          achados,
          pulados,
          tempoEstimadoMin: Math.round((buscas * RATE_DELAY_MS) / 60000),
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
