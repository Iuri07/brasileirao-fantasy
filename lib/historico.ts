// Histórico de pontuação por rodada por chave de elenco.
// Snapshot é gravado pelo cron `atualizarTudo` quando há pontos > 0
// pra rodada corrente. Idempotente (sobrescreve mesmo rodada/chave).

import { getDb } from "./db.ts";

export type HistoricoKV = Record<string, number>; // rodada (string) → pontos

export function getHistorico(chave: string): Promise<HistoricoKV> {
  const rows = getDb().prepare(
    "SELECT rodada, pontos FROM historico WHERE chave=? ORDER BY rodada",
  ).all<{ rodada: number; pontos: number }>(chave);
  const out: HistoricoKV = {};
  for (const r of rows) out[String(r.rodada)] = r.pontos;
  return Promise.resolve(out);
}

export function setHistoricoRodada(
  chave: string,
  rodada: number,
  pontos: number,
): Promise<void> {
  getDb().prepare(
    "INSERT INTO historico (chave, rodada, pontos) VALUES (?, ?, ?) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET pontos=excluded.pontos",
  ).run(chave, rodada, pontos);
  return Promise.resolve();
}

export function totalPontos(h: HistoricoKV): number {
  return Object.values(h).reduce((s, p) => s + p, 0);
}

export function rodadasJogadas(h: HistoricoKV): number {
  return Object.keys(h).length;
}

export function deleteHistoricoRodada(
  chave: string,
  rodada: number,
): Promise<void> {
  getDb().prepare("DELETE FROM historico WHERE chave=? AND rodada=?")
    .run(chave, rodada);
  return Promise.resolve();
}

export function getAllHistoricos(): Promise<Record<string, HistoricoKV>> {
  const rows = getDb().prepare(
    "SELECT chave, rodada, pontos FROM historico ORDER BY chave, rodada",
  ).all<{ chave: string; rodada: number; pontos: number }>();
  const out: Record<string, HistoricoKV> = {};
  for (const r of rows) {
    (out[r.chave] ??= {})[String(r.rodada)] = r.pontos;
  }
  return Promise.resolve(out);
}
