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

/** Map global: atleta_id → chave do dono que está oferecendo à venda.
 *  Reads paralelos (era sequencial, custava 9×latência KV ~ 800ms). */
export async function getAVendaGlobal(
  kv: Deno.Kv,
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const arrays = await Promise.all(
    TODAS_CHAVES.map((c) => getAVenda(kv, c)),
  );
  TODAS_CHAVES.forEach((chave, i) => {
    for (const id of arrays[i]) out[id] = chave;
  });
  return out;
}

/* --- Lista de interessados em atletas (free agents) -------------------- */

/** Manifestação de interesse num free agent: além de marcar interesse,
    o time precisa oferecer um jogador da mesma posição em troca. Quando o
    draft é resolvido, o time com melhor posição leva o free agent e o
    jogador oferecido vira free agent (ou volta pro pool). */
export interface InteresseRegistro {
  chave: string;
  /** atleta_id que o time ofereceu em troca */
  oferecido: number;
}

/** Lê os interesses registrados num atleta. Aceita formato legado
    (string[] sem oferta) coerce'ando pra oferecido=0. */
export async function getInteressados(
  kv: Deno.Kv,
  atletaId: number,
): Promise<InteresseRegistro[]> {
  const r = await kv.get<InteresseRegistro[] | string[]>([
    "interessados",
    atletaId,
  ]);
  const raw = r.value;
  if (!raw) return [];
  return raw.map((x) => typeof x === "string" ? { chave: x, oferecido: 0 } : x);
}

/** Registra interesse com jogador oferecido. Se já existe interesse
    do mesmo time, ATUALIZA a oferta. */
export async function setInteresse(
  kv: Deno.Kv,
  atletaId: number,
  chave: string,
  oferecido: number,
): Promise<{ total: number }> {
  const atual = await getInteressados(kv, atletaId);
  const idx = atual.findIndex((r) => r.chave === chave);
  if (idx >= 0) atual[idx] = { chave, oferecido };
  else atual.push({ chave, oferecido });
  await kv.set(["interessados", atletaId], atual);
  return { total: atual.length };
}

/** Remove o interesse do time `chave` num atleta. */
export async function removeInteresse(
  kv: Deno.Kv,
  atletaId: number,
  chave: string,
): Promise<{ total: number }> {
  const atual = await getInteressados(kv, atletaId);
  const novo = atual.filter((r) => r.chave !== chave);
  await kv.set(["interessados", atletaId], novo);
  return { total: novo.length };
}

/** Map de todos os interesses (atleta_id → registros[]) — pra renderizar
    a lista inteira de uma vez. Usa kv.list (1 round-trip) em vez de N
    gets individuais. */
export async function getInteressadosBatch(
  kv: Deno.Kv,
  atletaIds: number[],
): Promise<Record<number, InteresseRegistro[]>> {
  if (atletaIds.length === 0) return {};
  const out: Record<number, InteresseRegistro[]> = {};
  const wanted = new Set(atletaIds);
  const iter = kv.list<InteresseRegistro[] | string[]>({
    prefix: ["interessados"],
  });
  for await (const entry of iter) {
    const id = entry.key[1] as number;
    if (!wanted.has(id)) continue;
    const raw = entry.value;
    if (!raw || raw.length === 0) continue;
    out[id] = raw.map((x) =>
      typeof x === "string" ? { chave: x, oferecido: 0 } : x
    );
  }
  return out;
}

/* --- Prioridade pessoal de interesses (ordena dentro do meu próprio set) --- */

/** Lê a ordem de prioridade dos meus interesses (atleta_ids). Index 0 = top. */
export async function getMinhaPrioridade(
  kv: Deno.Kv,
  chave: string,
): Promise<number[]> {
  const r = await kv.get<number[]>(["minha_prioridade", chave]);
  return r.value ?? [];
}

export async function setMinhaPrioridade(
  kv: Deno.Kv,
  chave: string,
  ordem: number[],
): Promise<void> {
  await kv.set(["minha_prioridade", chave], ordem);
}

/** Adiciona um atleta ao fim da minha lista de prioridade. Idempotente. */
export async function appendPrioridade(
  kv: Deno.Kv,
  chave: string,
  atletaId: number,
): Promise<number[]> {
  const atual = await getMinhaPrioridade(kv, chave);
  if (atual.includes(atletaId)) return atual;
  const nova = [...atual, atletaId];
  await setMinhaPrioridade(kv, chave, nova);
  return nova;
}

/** Remove um atleta da minha lista de prioridade. Idempotente. */
export async function removePrioridade(
  kv: Deno.Kv,
  chave: string,
  atletaId: number,
): Promise<number[]> {
  const atual = await getMinhaPrioridade(kv, chave);
  const nova = atual.filter((id) => id !== atletaId);
  if (nova.length !== atual.length) {
    await setMinhaPrioridade(kv, chave, nova);
  }
  return nova;
}

/* --- Ordem do draft (resolução de interesses sobre free agents) ------- */

/** Lê a ordem do draft. Index 0 = primeira escolha. Default = ordem dos
    seeds (TODAS_CHAVES) quando nada foi configurado ainda. */
export async function getDraftOrdem(kv: Deno.Kv): Promise<string[]> {
  const r = await kv.get<string[]>(["draft_ordem"]);
  if (r.value && r.value.length > 0) {
    // Garante que tem todas as chaves (caso novo time tenha sido adicionado)
    const set = new Set(r.value);
    const faltando = TODAS_CHAVES.filter((c) => !set.has(c));
    return faltando.length === 0 ? r.value : [...r.value, ...faltando];
  }
  return [...TODAS_CHAVES];
}

export async function setDraftOrdem(
  kv: Deno.Kv,
  ordem: string[],
): Promise<void> {
  await kv.set(["draft_ordem"], ordem);
}

/** Posição do time no draft (1-based). null se chave inválida. */
export async function getPosicaoDraft(
  kv: Deno.Kv,
  chave: string,
): Promise<number | null> {
  const ordem = await getDraftOrdem(kv);
  const idx = ordem.indexOf(chave);
  return idx >= 0 ? idx + 1 : null;
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
  // Atomic: escreve elenco + invalida cache do melhor_time juntos pra
  // evitar leitura stale entre escritas.
  await kv.atomic()
    .set(["elenco", chave], elenco)
    .delete(["melhor_time", chave])
    .commit();
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

/** Verifica se a rodada está em andamento — cobre `ao_vivo` (bola
 *  rolando agora) E `aguardando_inicio` (mercado fechado mas entre
 *  jogos). Cartola só marca bola_rolando=true durante o 90min de
 *  cada jogo; entre jogos da mesma rodada cai pra false. Pra UX
 *  isso é tudo "rodada rolando". */
export function isRodadaEmAndamento(
  status: RodadaStatus["status"] | null | undefined,
): boolean {
  return status === "ao_vivo" || status === "aguardando_inicio";
}

export async function isAoVivo(kv: Deno.Kv): Promise<boolean> {
  const s = await getRodadaStatus(kv);
  return isRodadaEmAndamento(s?.status);
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
  const { cdn } = await import("./cdn.ts");
  const out: Record<string, string> = {};
  await Promise.all(
    POSICAO_CHAVES_CACHE.map(async (pos) => {
      const cache = await getAtletasCache(kv, pos);
      if (!cache) return;
      for (const [id, a] of Object.entries(cache.atletas)) {
        if (a.foto) {
          const wrapped = cdn(a.foto);
          if (wrapped) out[id] = wrapped;
        }
      }
    }),
  );
  return out;
}
