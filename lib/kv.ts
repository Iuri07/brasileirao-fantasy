import type { AtletaCacheKV, ElencoKV, RodadaStatus } from "./types.ts";

export const DONOS_CHAVES: Record<string, string> = {
  "Aguiar": "aguiar",
  "Ian": "ian",
  "Costa": "costa",
  "Brito": "brito",
  "Domingos": "domingos",
  "José": "jose",
  "Leo": "leo",
  "Armando": "armando",
  "JP": "jp",
};

export const CHAVES_TIMES: Record<string, { nome_time: string; dono: string }> =
  {
    "aguiar": { nome_time: "FILHOS DE KIEZA", dono: "Aguiar" },
    "ian": { nome_time: "BOTAFOFO FR", dono: "Ian" },
    "costa": { nome_time: "MALVADINHOS FC", dono: "Costa" },
    "brito": { nome_time: "CHUTOCA FC", dono: "Brito" },
    "domingos": { nome_time: "BENDERMEM 23", dono: "Domingos" },
    "jose": { nome_time: "888 PARTNERS", dono: "José" },
    "leo": { nome_time: "TODOS COM BOLSONARO", dono: "Leo" },
    "armando": { nome_time: "PIRATAS DO CARILLE", dono: "Armando" },
    "jp": { nome_time: "DORIVAL JUNIORS", dono: "JP" },
  };

export const TODAS_CHAVES = Object.keys(CHAVES_TIMES);

export const POSICAO_CHAVES_CACHE = ["GOL", "LAT", "ZAG", "MEI", "ATA", "TEC"];

export async function getElenco(
  kv: Deno.Kv,
  chave: string,
): Promise<ElencoKV | null> {
  const r = await kv.get<ElencoKV>(["elenco", chave]);
  return r.value;
}

export async function setElenco(
  kv: Deno.Kv,
  chave: string,
  elenco: ElencoKV,
): Promise<void> {
  await kv.set(["elenco", chave], elenco);
}

export async function getAllElencos(
  kv: Deno.Kv,
): Promise<Record<string, ElencoKV>> {
  const result: Record<string, ElencoKV> = {};
  await Promise.all(
    TODAS_CHAVES.map(async (chave) => {
      const e = await getElenco(kv, chave);
      if (e) result[chave] = e;
    }),
  );
  return result;
}

export async function getRodadaStatus(
  kv: Deno.Kv,
): Promise<RodadaStatus | null> {
  const r = await kv.get<RodadaStatus>(["rodada_atual"]);
  return r.value;
}

export async function setRodadaStatus(
  kv: Deno.Kv,
  status: RodadaStatus,
): Promise<void> {
  await kv.set(["rodada_atual"], status);
}

export async function getAtletasCache(
  kv: Deno.Kv,
  posChave: string,
): Promise<AtletaCacheKV | null> {
  const r = await kv.get<AtletaCacheKV>(["atletas_cache", posChave]);
  return r.value;
}

export async function getPartidasCache(
  kv: Deno.Kv,
): Promise<Record<string, { casa: string; fora: string }> | null> {
  const r = await kv.get<Record<string, { casa: string; fora: string }>>([
    "partidas_cache",
  ]);
  return r.value;
}

export async function setPartidasCache(
  kv: Deno.Kv,
  data: Record<string, { casa: string; fora: string }>,
): Promise<void> {
  await kv.set(["partidas_cache"], data);
}

export function donoToChave(dono: string): string | undefined {
  return DONOS_CHAVES[dono];
}

/**
 * Constrói um Map atleta_id → foto URL lendo todos os caches por posição.
 * Os fotos são salvos por atleta dentro de AtletaCacheEntry (sync-atletas).
 */
export async function getFotos(kv: Deno.Kv): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    POSICAO_CHAVES_CACHE.map(async (pos) => {
      const cache = await getAtletasCache(kv, pos);
      if (!cache) return;
      for (const [id, a] of Object.entries(cache.atletas)) {
        if (a.foto) out[id] = a.foto;
      }
    }),
  );
  return out;
}
