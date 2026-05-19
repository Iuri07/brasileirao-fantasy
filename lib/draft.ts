// Estado e mecânica do draft de free agents.

import { setDraftOrdem, TODAS_CHAVES } from "./kv.ts";
import { getHistorico, totalPontos } from "./historico.ts";
import { getDb } from "./db.ts";

export interface DraftMeta {
  ciclo: number;
  rodadaCiclo: number;
  rodadaBase: number;
}

export function getDraftMeta(): Promise<DraftMeta | null> {
  const r = getDb().prepare(
    "SELECT ciclo, rodada_ciclo, rodada_base FROM draft_meta WHERE id=1",
  ).get<{ ciclo: number; rodada_ciclo: number; rodada_base: number }>();
  if (!r) return Promise.resolve(null);
  return Promise.resolve({
    ciclo: r.ciclo,
    rodadaCiclo: r.rodada_ciclo,
    rodadaBase: r.rodada_base,
  });
}

export function setDraftMeta(meta: DraftMeta): Promise<void> {
  getDb().prepare(
    "INSERT INTO draft_meta (id, ciclo, rodada_ciclo, rodada_base) VALUES (1, ?, ?, ?) " +
      "ON CONFLICT (id) DO UPDATE SET " +
      "  ciclo=excluded.ciclo, rodada_ciclo=excluded.rodada_ciclo, rodada_base=excluded.rodada_base",
  ).run(meta.ciclo, meta.rodadaCiclo, meta.rodadaBase);
  return Promise.resolve();
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

export async function avancarRodadaDraft(
  pickers: string[],
  rodadaAtualBR: number,
): Promise<{ ordem: string[]; meta: DraftMeta; resetou: boolean }> {
  const metaAtual = (await getDraftMeta()) ?? {
    ciclo: 1,
    rodadaCiclo: 1,
    rodadaBase: rodadaAtualBR,
  };
  const proxRodadaCiclo = metaAtual.rodadaCiclo + 1;
  if (proxRodadaCiclo > 5) {
    const r = await resetDraft(rodadaAtualBR);
    return { ...r, resetou: true };
  }
  // Lê ordem atual via getDraftOrdem
  const { getDraftOrdem } = await import("./kv.ts");
  const ordemAtual = await getDraftOrdem();
  const novaOrdem = aplicarShift(ordemAtual, pickers);
  const novaMeta: DraftMeta = {
    ...metaAtual,
    rodadaCiclo: proxRodadaCiclo,
  };
  await setDraftOrdem(novaOrdem);
  await setDraftMeta(novaMeta);
  return { ordem: novaOrdem, meta: novaMeta, resetou: false };
}

// ============================================================
// Dias da semana em que conflitos do draft são resolvidos
// ============================================================

const DIAS_DEFAULT = [3]; // quarta-feira

export function getDiasResolucao(): Promise<number[]> {
  const rows = getDb().prepare(
    "SELECT dia_semana FROM draft_dias ORDER BY dia_semana",
  )
    .all<{ dia_semana: number }>();
  if (rows.length === 0) return Promise.resolve([...DIAS_DEFAULT]);
  return Promise.resolve(rows.map((r) => r.dia_semana));
}

export function setDiasResolucao(dias: number[]): Promise<void> {
  const limpos = [
    ...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM draft_dias").run();
    const ins = db.prepare("INSERT INTO draft_dias (dia_semana) VALUES (?)");
    for (const d of limpos) ins.run(d);
  })();
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
