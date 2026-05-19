// Histórico de eventos da rodada — detectado pelo cron via diff entre
// snapshots do scout Cartola.

import { getDb } from "./db.ts";

export interface EventoHist {
  ts: number;
  rodada: number;
  atletaId: number;
  codigo: string;
  qtd: number;
}

export function getEstadoScout(
  rodada: number,
  atletaId: number,
): Promise<Record<string, number>> {
  const rows = getDb().prepare(
    "SELECT codigo, qtd FROM scout_estado WHERE rodada=? AND atleta_id=?",
  ).all<{ codigo: string; qtd: number }>(rodada, atletaId);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.codigo] = r.qtd;
  return Promise.resolve(out);
}

export function setEstadoScout(
  rodada: number,
  atletaId: number,
  scout: Record<string, number>,
): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM scout_estado WHERE rodada=? AND atleta_id=?")
      .run(rodada, atletaId);
    const ins = db.prepare(
      "INSERT INTO scout_estado (rodada, atleta_id, codigo, qtd) VALUES (?, ?, ?, ?)",
    );
    for (const [codigo, qtd] of Object.entries(scout)) {
      ins.run(rodada, atletaId, codigo, qtd);
    }
  })();
  return Promise.resolve();
}

export function appendEvento(evento: EventoHist): Promise<void> {
  // INSERT OR REPLACE pra cobrir colisão (mesmo atleta+codigo+ts+rodada).
  getDb().prepare(
    "INSERT OR REPLACE INTO evento_hist (rodada, ts, atleta_id, codigo, qtd) " +
      "VALUES (?, ?, ?, ?, ?)",
  ).run(evento.rodada, evento.ts, evento.atletaId, evento.codigo, evento.qtd);
  return Promise.resolve();
}

export function listarEventos(
  rodada: number,
  limit = 100,
): Promise<EventoHist[]> {
  const rows = getDb().prepare(
    "SELECT ts, atleta_id, codigo, qtd FROM evento_hist " +
      "WHERE rodada=? ORDER BY ts DESC LIMIT ?",
  ).all<{ ts: number; atleta_id: number; codigo: string; qtd: number }>(
    rodada,
    limit,
  );
  return Promise.resolve(rows.map((r) => ({
    ts: r.ts,
    rodada,
    atletaId: r.atleta_id,
    codigo: r.codigo,
    qtd: r.qtd,
  })));
}

export function limparRodada(rodada: number): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM scout_estado WHERE rodada=?").run(rodada);
    db.prepare("DELETE FROM evento_hist WHERE rodada=?").run(rodada);
  })();
  return Promise.resolve();
}
