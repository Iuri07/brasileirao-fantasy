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

/** Limite de substituições durante a rodada (ao_vivo). Fora da rodada o
    usuário tem trocas ilimitadas no mercado. */
export const MAX_SUBS_AO_VIVO = 3;

/** Quantas substituições banco↔escala o usuário já usou na rodada. */
export async function getSubsUsadas(
  kv: Deno.Kv,
  rodada: number,
  chave: string,
): Promise<number> {
  const r = await kv.get<number>(["subs", rodada, chave]);
  return r.value ?? 0;
}

export async function incrementSubsUsadas(
  kv: Deno.Kv,
  rodada: number,
  chave: string,
): Promise<number> {
  const atual = await getSubsUsadas(kv, rodada, chave);
  const proximo = atual + 1;
  await kv.set(["subs", rodada, chave], proximo);
  return proximo;
}

/* --- Mercado: jogadores marcados "à venda" pelos donos ---------------- */

/** Lê o set de atleta_ids que o dono colocou à venda. */
export async function getAVenda(
  kv: Deno.Kv,
  chave: string,
): Promise<number[]> {
  const r = await kv.get<number[]>(["a_venda", chave]);
  return r.value ?? [];
}

export async function setAVenda(
  kv: Deno.Kv,
  chave: string,
  ids: number[],
): Promise<void> {
  await kv.set(["a_venda", chave], Array.from(new Set(ids)));
}

export async function toggleAVenda(
  kv: Deno.Kv,
  chave: string,
  atletaId: number,
): Promise<{ aVenda: boolean }> {
  const atual = await getAVenda(kv, chave);
  const idx = atual.indexOf(atletaId);
  if (idx >= 0) {
    atual.splice(idx, 1);
    await setAVenda(kv, chave, atual);
    return { aVenda: false };
  }
  atual.push(atletaId);
  await setAVenda(kv, chave, atual);
  return { aVenda: true };
}

/** Map global: atleta_id → chave do dono que está oferecendo à venda. */
export async function getAVendaGlobal(
  kv: Deno.Kv,
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const chave of TODAS_CHAVES) {
    const ids = await getAVenda(kv, chave);
    for (const id of ids) out[id] = chave;
  }
  return out;
}

/* --- Lista de interessados em atletas (free agents) -------------------- */

/** Times que demonstraram interesse num atleta. */
export async function getInteressados(
  kv: Deno.Kv,
  atletaId: number,
): Promise<string[]> {
  const r = await kv.get<string[]>(["interessados", atletaId]);
  return r.value ?? [];
}

/** Alterna o time `chave` na lista de interessados pelo atleta. */
export async function toggleInteresse(
  kv: Deno.Kv,
  atletaId: number,
  chave: string,
): Promise<{ interessado: boolean; total: number }> {
  const atual = await getInteressados(kv, atletaId);
  const idx = atual.indexOf(chave);
  if (idx >= 0) {
    atual.splice(idx, 1);
    await kv.set(["interessados", atletaId], atual);
    return { interessado: false, total: atual.length };
  }
  atual.push(chave);
  await kv.set(["interessados", atletaId], atual);
  return { interessado: true, total: atual.length };
}

/** Map de todos os interessados (atleta_id → chaves[]) — pra renderizar
    a lista inteira de uma vez. Itera só sobre os atletas passados. */
export async function getInteressadosBatch(
  kv: Deno.Kv,
  atletaIds: number[],
): Promise<Record<number, string[]>> {
  const out: Record<number, string[]> = {};
  await Promise.all(
    atletaIds.map(async (id) => {
      const lista = await getInteressados(kv, id);
      if (lista.length) out[id] = lista;
    }),
  );
  return out;
}

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
