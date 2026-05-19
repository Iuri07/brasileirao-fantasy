// Helper genérico pra singletons e small caches. Substitui as ~8
// tabelas singleton (rodada_atual, simulando, draft_meta, etc) por
// um único key-value store. SQL-light, mas pragmático pra essa escala.

import { getDb } from "./db.ts";

export function appStateGet<T = unknown>(key: string): T | null {
  const r = getDb().prepare("SELECT data_json FROM app_state WHERE key=?")
    .get<{ data_json: string }>(key);
  if (!r) return null;
  try {
    return JSON.parse(r.data_json) as T;
  } catch {
    return null;
  }
}

export function appStateSet(key: string, value: unknown): void {
  getDb().prepare(
    "INSERT INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (key) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
  ).run(key, JSON.stringify(value), Date.now());
}

export function appStateDelete(key: string): void {
  getDb().prepare("DELETE FROM app_state WHERE key=?").run(key);
}

/** Limpa todas entries que matcham prefix. Útil pra "namespace" lógico
 *  (ex: clear all `oauth:*`). */
export function appStateDeletePrefix(prefix: string): void {
  getDb().prepare("DELETE FROM app_state WHERE key LIKE ?").run(`${prefix}%`);
}
