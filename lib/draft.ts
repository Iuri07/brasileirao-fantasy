// Estado e mecânica do draft de free agents.
//
// Regra:
// 1. Ordem inicial = inverso da classificação acumulada (pior time → 1º pick)
// 2. A cada rodada do Brasileirão, quem não usou o pick sobe no ranking;
//    quem usou vai pro fim da fila (preservando ordem relativa entre si).
// 3. A cada 5 rodadas (rodadaCiclo > 5) o draft reseta pro inverso da
//    classificação atual e um novo ciclo começa.

import { setDraftOrdem, TODAS_CHAVES } from "./kv.ts";
import { getHistorico, totalPontos } from "./historico.ts";

export interface DraftMeta {
  /** Quantos ciclos de 5 rodadas já passaram (incrementa a cada reset). */
  ciclo: number;
  /** Rodada dentro do ciclo (1..5). Quando passa de 5, reseta. */
  rodadaCiclo: number;
  /** Rodada do Brasileirão em que o ciclo atual começou. */
  rodadaBase: number;
}

const META_KEY = ["draft_meta"];

export async function getDraftMeta(kv: Deno.Kv): Promise<DraftMeta | null> {
  const r = await kv.get<DraftMeta>(META_KEY);
  return r.value;
}

export async function setDraftMeta(
  kv: Deno.Kv,
  meta: DraftMeta,
): Promise<void> {
  await kv.set(META_KEY, meta);
}

/** Inverso da classificação acumulada (pior pontuação total → 1º pick).
 *  Times sem histórico ficam no início (pegam pick primeiro, faz sentido
 *  pra um time que tá pior). Empate: usa ordem dos seeds como tiebreaker. */
export async function inverseRankingOrdem(kv: Deno.Kv): Promise<string[]> {
  const totals: Record<string, number> = {};
  await Promise.all(
    TODAS_CHAVES.map(async (chave) => {
      const h = await getHistorico(kv, chave);
      totals[chave] = totalPontos(h);
    }),
  );
  return [...TODAS_CHAVES].sort((a, b) => {
    const diff = totals[a] - totals[b];
    if (diff !== 0) return diff;
    // tiebreaker estável: ordem dos seeds
    return TODAS_CHAVES.indexOf(a) - TODAS_CHAVES.indexOf(b);
  });
}

/** Reset completo: ordem = inverso da classificação, ciclo+=1, rodadaCiclo=1. */
export async function resetDraft(
  kv: Deno.Kv,
  rodadaBase: number,
): Promise<{ ordem: string[]; meta: DraftMeta }> {
  const ordem = await inverseRankingOrdem(kv);
  const anterior = await getDraftMeta(kv);
  const meta: DraftMeta = {
    ciclo: (anterior?.ciclo ?? 0) + 1,
    rodadaCiclo: 1,
    rodadaBase,
  };
  await setDraftOrdem(kv, ordem);
  await setDraftMeta(kv, meta);
  return { ordem, meta };
}

/** Aplica shift: os `pickers` (chaves que usaram pick essa rodada) vão pro
 *  fim da fila preservando ordem relativa entre si. Os outros sobem. */
export function aplicarShift(ordem: string[], pickers: string[]): string[] {
  const set = new Set(pickers);
  const naoUsaram = ordem.filter((c) => !set.has(c));
  const usaram = ordem.filter((c) => set.has(c));
  return [...naoUsaram, ...usaram];
}

/** Avança 1 rodada do draft. Se passa de 5, reseta automaticamente. */
export async function avancarRodadaDraft(
  kv: Deno.Kv,
  pickers: string[],
  rodadaAtualBR: number,
): Promise<
  { ordem: string[]; meta: DraftMeta; resetou: boolean }
> {
  const metaAtual = (await getDraftMeta(kv)) ?? {
    ciclo: 1,
    rodadaCiclo: 1,
    rodadaBase: rodadaAtualBR,
  };
  const proxRodadaCiclo = metaAtual.rodadaCiclo + 1;
  if (proxRodadaCiclo > 5) {
    const r = await resetDraft(kv, rodadaAtualBR);
    return { ...r, resetou: true };
  }
  // Lê ordem atual (sem usar getDraftOrdem pra evitar dep circular)
  const r = await kv.get<string[]>(["draft_ordem"]);
  const ordemAtual = r.value ?? (await inverseRankingOrdem(kv));
  const novaOrdem = aplicarShift(ordemAtual, pickers);
  const novaMeta: DraftMeta = {
    ...metaAtual,
    rodadaCiclo: proxRodadaCiclo,
  };
  await setDraftOrdem(kv, novaOrdem);
  await setDraftMeta(kv, novaMeta);
  return { ordem: novaOrdem, meta: novaMeta, resetou: false };
}

/* --- Dias da semana em que conflitos do draft são resolvidos --------- */

const DIAS_KEY = ["draft_dias_resolucao"];
/** Default: quarta-feira. Admin pode alterar. */
const DIAS_DEFAULT = [3];

/** Lê os dias da semana (0=domingo, 6=sábado) em que o admin resolve
 *  conflitos do draft. */
export async function getDiasResolucao(kv: Deno.Kv): Promise<number[]> {
  const r = await kv.get<number[]>(DIAS_KEY);
  if (r.value && r.value.length > 0) {
    return r.value.filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  }
  return [...DIAS_DEFAULT];
}

export async function setDiasResolucao(
  kv: Deno.Kv,
  dias: number[],
): Promise<void> {
  const limpos = [
    ...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  await kv.set(DIAS_KEY, limpos);
}

/** Próxima resolução: 23:59:59 do próximo dia configurado, contando hoje
 *  se ainda estiver dentro do dia. Retorna null se a lista estiver vazia. */
export function proximaResolucao(
  dias: number[],
  from: Date = new Date(),
): Date | null {
  if (dias.length === 0) return null;
  for (let i = 0; i < 8; i++) {
    const cand = new Date(from);
    cand.setDate(cand.getDate() + i);
    cand.setHours(23, 59, 59, 999);
    if (dias.includes(cand.getDay()) && cand.getTime() > from.getTime()) {
      return cand;
    }
  }
  return null;
}

/** Inicializa o draft se ainda não foi: ordem = inverso da classificação,
 *  meta = ciclo 1 rodadaCiclo 1. Idempotente: não faz nada se já existir meta. */
export async function inicializarDraftSeNecessario(
  kv: Deno.Kv,
  rodadaAtualBR: number,
): Promise<{ ordem: string[]; meta: DraftMeta; novo: boolean }> {
  const metaExistente = await getDraftMeta(kv);
  if (metaExistente) {
    const r = await kv.get<string[]>(["draft_ordem"]);
    const ordem = r.value ?? (await inverseRankingOrdem(kv));
    return { ordem, meta: metaExistente, novo: false };
  }
  const ordem = await inverseRankingOrdem(kv);
  const meta: DraftMeta = {
    ciclo: 1,
    rodadaCiclo: 1,
    rodadaBase: rodadaAtualBR,
  };
  await setDraftOrdem(kv, ordem);
  await setDraftMeta(kv, meta);
  return { ordem, meta, novo: true };
}
