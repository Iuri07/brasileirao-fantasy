// Estado e mecânica do draft de free agents.

import { setDraftOrdem, TODAS_CHAVES } from "./kv.ts";
import { getHistorico, totalPontos } from "./historico.ts";
import { appStateGet, appStateSet } from "./app-state.ts";

export interface DraftMeta {
  ciclo: number;
  rodadaCiclo: number;
  rodadaBase: number;
}

/** Ciclo do draft tem 5 rodadas. Após a 5ª, reseta pro próximo ciclo. */
export const RODADAS_POR_CICLO = 5;

export function getDraftMeta(): Promise<DraftMeta | null> {
  return Promise.resolve(appStateGet<DraftMeta>("draft_meta"));
}

export function setDraftMeta(meta: DraftMeta): Promise<void> {
  appStateSet("draft_meta", meta);
  return Promise.resolve();
}

/** Calcula ciclo e rodadaCiclo automaticamente a partir da rodada atual
 *  da liga e do `rodadaBase` armazenado. Antes esses valores eram
 *  incrementados manualmente via avancarRodadaDraft (admin endpoint),
 *  o que deixava o estado defasado se não rodasse a cada rodada.
 *
 *  Regra: a cada rodada da liga, rodadaCiclo avança 1. Depois da 5ª,
 *  reseta pro próximo ciclo. */
export function computeDraftMeta(
  stored: DraftMeta,
  rodadaAtual: number,
): DraftMeta {
  const diff = Math.max(0, rodadaAtual - stored.rodadaBase);
  const cicloOffset = Math.floor(diff / RODADAS_POR_CICLO);
  const rodadaCiclo = (diff % RODADAS_POR_CICLO) + 1;
  return {
    ciclo: stored.ciclo + cicloOffset,
    rodadaCiclo,
    rodadaBase: stored.rodadaBase,
  };
}

export async function inverseRankingOrdem(): Promise<string[]> {
  const totals: Record<string, number> = {};
  for (const chave of TODAS_CHAVES) {
    const h = await getHistorico(chave);
    totals[chave] = totalPontos(h);
  }
  return [...TODAS_CHAVES].sort((a, b) => {
    const diff = totals[a] - totals[b];
    if (diff !== 0) return diff;
    return TODAS_CHAVES.indexOf(a) - TODAS_CHAVES.indexOf(b);
  });
}

export async function resetDraft(
  rodadaBase: number,
): Promise<{ ordem: string[]; meta: DraftMeta }> {
  const ordem = await inverseRankingOrdem();
  const anterior = await getDraftMeta();
  const meta: DraftMeta = {
    ciclo: (anterior?.ciclo ?? 0) + 1,
    rodadaCiclo: 1,
    rodadaBase,
  };
  await setDraftOrdem(ordem);
  await setDraftMeta(meta);
  return { ordem, meta };
}

export function aplicarShift(ordem: string[], pickers: string[]): string[] {
  const set = new Set(pickers);
  const naoUsaram = ordem.filter((c) => !set.has(c));
  const usaram = ordem.filter((c) => set.has(c));
  return [...naoUsaram, ...usaram];
}

/**
 * Aplica shift na ordem do draft — quem usou pick vai pro fim da fila.
 * NÃO altera ciclo/rodadaCiclo: esses são computados a partir da rodada
 * atual da liga (vide computeDraftMeta). Múltiplos shifts podem rolar
 * dentro do mesmo ciclo conforme picks/resoluções de conflito ocorrem.
 * Reset da ordem (inverso da classificação) só acontece via /admin
 * com `reset: true`.
 */
export async function avancarRodadaDraft(
  pickers: string[],
  rodadaAtualBR: number,
): Promise<{ ordem: string[]; meta: DraftMeta; resetou: boolean }> {
  const metaAtual = (await getDraftMeta()) ?? {
    ciclo: 1,
    rodadaCiclo: 1,
    rodadaBase: rodadaAtualBR,
  };
  const { getDraftOrdem } = await import("./kv.ts");
  const ordemAtual = await getDraftOrdem();
  const novaOrdem = aplicarShift(ordemAtual, pickers);
  await setDraftOrdem(novaOrdem);
  return {
    ordem: novaOrdem,
    meta: computeDraftMeta(metaAtual, rodadaAtualBR),
    resetou: false,
  };
}

// ============================================================
// Dias da semana em que conflitos do draft são resolvidos
// ============================================================

const DIAS_DEFAULT = [3]; // quarta-feira

export function getDiasResolucao(): Promise<number[]> {
  const stored = appStateGet<number[]>("draft_dias");
  if (!stored || stored.length === 0) return Promise.resolve([...DIAS_DEFAULT]);
  return Promise.resolve([...stored].sort((a, b) => a - b));
}

export function setDiasResolucao(dias: number[]): Promise<void> {
  const limpos = [
    ...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  appStateSet("draft_dias", limpos);
  return Promise.resolve();
}

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

export async function inicializarDraftSeNecessario(
  rodadaAtualBR: number,
): Promise<{ ordem: string[]; meta: DraftMeta; novo: boolean }> {
  const metaExistente = await getDraftMeta();
  if (metaExistente) {
    const { getDraftOrdem } = await import("./kv.ts");
    const ordem = await getDraftOrdem();
    // Retorna meta STORED (sem computar). Caller usa computeDraftMeta
    // com a rodada atual real pra obter ciclo/rodadaCiclo exibíveis.
    return { ordem, meta: metaExistente, novo: false };
  }
  const ordem = await inverseRankingOrdem();
  const meta: DraftMeta = {
    ciclo: 1,
    rodadaCiclo: 1,
    rodadaBase: rodadaAtualBR,
  };
  await setDraftOrdem(ordem);
  await setDraftMeta(meta);
  return { ordem, meta, novo: true };
}
