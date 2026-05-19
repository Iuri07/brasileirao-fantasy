import { Handlers } from "$fresh/server.ts";
import {
  fetchSquad,
  fetchTeams,
  hasKey,
  sleep,
} from "../../../lib/api-football.ts";
import {
  getAllElencos,
  getAtletasCache,
  POSICAO_CHAVES_CACHE,
  setAtletasCache,
} from "../../../lib/kv.ts";
import type { AtletaCacheKV } from "../../../lib/types.ts";

const H = { "Content-Type": "application/json" };

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Cartola usa nomes curtos; API-Football usa nomes completos.
// Mapping de aliases pra fechar o gap.
const CLUBE_ALIAS: Record<string, string> = {
  [norm("Athlético-PR")]: norm("Atletico Paranaense"),
  [norm("Athletico-PR")]: norm("Atletico Paranaense"),
  [norm("Bragantino")]: norm("RB Bragantino"),
  [norm("Vasco")]: norm("Vasco DA Gama"),
};

export const handler: Handlers = {
  /**
   * Sync de fotos via API-Football pra TODOS os atletas dos clubes
   * que aparecem nos elencos da liga. Custo: ~1 + N times distintos
   * = max 21 requests/dia. Free tier: 100/dia.
   *
   * Faz match clube_cartola → team_apifootball por nome normalizado,
   * depois match atleta dentro do squad por nome normalizado (substring).
   * Sobrescreve AtletaCacheEntry.foto quando encontra.
   */
  async POST() {
    if (!hasKey()) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "API_FOOTBALL_KEY não configurada no .env",
        }),
        { status: 400, headers: H },
      );
    }

    try {
      // 1. Times do Brasileirão na API-Football
      const afTeams = await fetchTeams(71);
      const afByNorm = new Map<string, { id: number; name: string }>();
      for (const t of afTeams) {
        afByNorm.set(norm(t.name), { id: t.id, name: t.name });
      }

      // 2. Coleta clubes únicos dos elencos
      const elencos = await getAllElencos();
      const clubesUnicos = new Map<string, string>(); // norm → display
      for (const e of Object.values(elencos)) {
        for (const j of Object.values(e.jogadores)) {
          if (j.escalacao !== "Sim") continue;
          clubesUnicos.set(norm(j.clube), j.clube);
        }
      }

      // 3. Pra cada clube, fetch squad da API-Football
      const squadByClube = new Map<string, Map<string, string>>();
      let teamsConsultados = 0;
      let teamsNaoEncontrados: string[] = [];
      // Free tier limita ~10 reqs/min — throttle 6.5s entre fetchSquads
      const THROTTLE_MS = 6500;
      let first = true;
      for (const [normClube, displayClube] of clubesUnicos) {
        const lookupKey = CLUBE_ALIAS[normClube] ?? normClube;
        const af = afByNorm.get(lookupKey);
        if (!af) {
          teamsNaoEncontrados.push(displayClube);
          continue;
        }
        if (!first) await sleep(THROTTLE_MS);
        first = false;
        const squad = await fetchSquad(af.id);
        teamsConsultados++;
        const playerByNorm = new Map<string, string>();
        for (const p of squad) {
          playerByNorm.set(norm(p.name), p.photo);
        }
        squadByClube.set(normClube, playerByNorm);
      }

      // 4. Itera atletas escalados, busca foto pelo nome, atualiza cache
      const caches = new Map<string, AtletaCacheKV>();
      let achados = 0;
      let buscados = 0;
      const tocadosPorPos = new Set<string>();

      for (const pos of POSICAO_CHAVES_CACHE) {
        const c = await getAtletasCache(pos);
        if (!c) continue;
        caches.set(pos, c);
      }

      for (const e of Object.values(elencos)) {
        for (const j of Object.values(e.jogadores)) {
          if (j.escalacao !== "Sim") continue;
          const squad = squadByClube.get(norm(j.clube));
          if (!squad) continue;
          buscados++;
          const apelidoNorm = norm(j.apelido_api);
          // Match exato OU substring (api-football usa nome completo às vezes)
          let foto: string | undefined = squad.get(apelidoNorm);
          if (!foto) {
            for (const [k, v] of squad) {
              if (k.includes(apelidoNorm) || apelidoNorm.includes(k)) {
                foto = v;
                break;
              }
            }
          }
          if (!foto) continue;

          // Acha posição no cache pra atualizar
          for (const [pos, c] of caches) {
            const entry = c.atletas[String(j.atleta_id)];
            if (entry) {
              entry.foto = foto;
              tocadosPorPos.add(pos);
              achados++;
              break;
            }
          }
        }
      }

      // 5. Persiste caches alterados
      const now = new Date().toISOString();
      for (const pos of tocadosPorPos) {
        const c = caches.get(pos);
        if (c) {
          c.atualizadoEm = now;
          await setAtletasCache(pos, c);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          teamsConsultados,
          teamsNaoEncontrados,
          buscados,
          achados,
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
