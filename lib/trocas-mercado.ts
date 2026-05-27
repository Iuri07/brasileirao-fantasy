// Contador de trocas com mercado por time/rodada. Limite (default 10)
// aplicado quando admin executa swap envolvendo o pool de free agents.
// Trocas user-to-user ficam ilimitadas (não passam por aqui).

import { getDb } from "./db.ts";
import { appStateGet, appStateSet } from "./app-state.ts";

const MAX_DEFAULT = 10;

export function getMaxTrocasMercado(): number {
  const stored = appStateGet<number>("max_trocas_mercado");
  if (typeof stored !== "number" || stored < 0) return MAX_DEFAULT;
  return Math.trunc(stored);
}

export function setMaxTrocasMercado(n: number): Promise<void> {
  const v = Math.max(0, Math.trunc(n));
  appStateSet("max_trocas_mercado", v);
  return Promise.resolve();
}

/** Quantas trocas com mercado o time já fez nessa rodada. 0 se nunca. */
export function getTrocasMercadoCount(
  chave: string,
  rodada: number,
): number {
  const r = getDb().prepare(
    "SELECT count FROM trocas_mercado WHERE chave=? AND rodada=?",
  ).get<{ count: number }>(chave, rodada);
  return r?.count ?? 0;
}

/** Define o count manualmente (admin override / backfill). */
export function setTrocasMercadoCount(
  chave: string,
  rodada: number,
  count: number,
): Promise<void> {
  const c = Math.max(0, Math.trunc(count));
  getDb().prepare(
    "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, ?, ?) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET count=excluded.count",
  ).run(chave, rodada, c);
  return Promise.resolve();
}

/** Incrementa o count em 1. Retorna o NOVO total. */
export function incTrocasMercadoCount(
  chave: string,
  rodada: number,
): Promise<number> {
  const db = getDb();
  // UPSERT atômico: insere com 1 ou incrementa existente.
  db.prepare(
    "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, ?, 1) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET count=count + 1",
  ).run(chave, rodada);
  return Promise.resolve(getTrocasMercadoCount(chave, rodada));
}

/** Ajusta o count em ±delta (pode ser negativo). Usado por transferência
 *  de trocas em ofertas aceitas — ofertante ganha delta (perde saldo),
 *  destinatário leva -delta (ganha saldo). count pode ficar negativo,
 *  representando "bônus" acima do max. */
export function adjustTrocasMercadoCount(
  chave: string,
  rodada: number,
  delta: number,
): Promise<number> {
  const d = Math.trunc(delta);
  const db = getDb();
  db.prepare(
    "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, ?, ?) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET count=count + excluded.count",
  ).run(chave, rodada, d);
  return Promise.resolve(getTrocasMercadoCount(chave, rodada));
}

/** Snapshot completo de uma rodada — todas as chaves com count > 0.
 *  Times sem registro contam como 0 (não aparecem no retorno). */
export function getTrocasMercadoRodada(
  rodada: number,
): Promise<Array<{ chave: string; count: number }>> {
  const rows = getDb().prepare(
    "SELECT chave, count FROM trocas_mercado WHERE rodada=? ORDER BY chave",
  ).all<{ chave: string; count: number }>(rodada);
  return Promise.resolve(rows);
}
