// Snapshot persistente da pontuação final de cada atleta por rodada.
// Substitui a dependência de /api/cartola/atletas/pontuados/{rodada} pra
// histórico — só rodada CORRENTE (live) ainda vai pra Cartola.

import { getDb, i64 } from "./db.ts";

export interface AtletaRodada {
  pontos: number;
  entrou_em_campo: boolean | null;
  scout?: Record<string, number>;
}

/** Salva snapshot da pontuação final de UM atleta numa rodada.
 *  Idempotente — overwrite se já existir (caso o cron rode de novo
 *  com dados ligeiramente diferentes). */
export function setHistoricoAtleta(
  atletaId: number,
  rodada: number,
  dados: AtletaRodada,
): Promise<void> {
  const ec = dados.entrou_em_campo === null ? null : dados.entrou_em_campo ? 1 : 0;
  const scoutJson = dados.scout ? JSON.stringify(dados.scout) : null;
  getDb().prepare(
    "INSERT INTO historico_atleta (atleta_id, rodada, pontos, entrou_em_campo, scout_json) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (atleta_id, rodada) DO UPDATE SET " +
      "pontos=excluded.pontos, entrou_em_campo=excluded.entrou_em_campo, scout_json=excluded.scout_json",
  ).run(atletaId, rodada, dados.pontos, ec, scoutJson);
  return Promise.resolve();
}

/** Snapshot em lote (1 transação) — muito mais rápido que loop de setHistoricoAtleta. */
export function setHistoricoAtletaBatch(
  rodada: number,
  atletas: Map<number, AtletaRodada>,
): Promise<void> {
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO historico_atleta (atleta_id, rodada, pontos, entrou_em_campo, scout_json) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (atleta_id, rodada) DO UPDATE SET " +
      "pontos=excluded.pontos, entrou_em_campo=excluded.entrou_em_campo, scout_json=excluded.scout_json",
  );
  db.transaction(() => {
    for (const [atletaId, d] of atletas.entries()) {
      const ec = d.entrou_em_campo === null ? null : d.entrou_em_campo ? 1 : 0;
      const scoutJson = d.scout ? JSON.stringify(d.scout) : null;
      ins.run(atletaId, rodada, d.pontos, ec, scoutJson);
    }
  })();
  return Promise.resolve();
}

/** Histórico completo de UM atleta — todas as rodadas que temos snapshot. */
export function getHistoricoAtleta(
  atletaId: number,
): Promise<Record<number, AtletaRodada>> {
  const rows = getDb().prepare(
    "SELECT rodada, pontos, entrou_em_campo, scout_json " +
      "FROM historico_atleta WHERE atleta_id=? ORDER BY rodada",
  ).all<{
    rodada: number;
    pontos: number;
    entrou_em_campo: number | null;
    scout_json: string | null;
  }>(atletaId);
  const out: Record<number, AtletaRodada> = {};
  for (const r of rows) {
    out[r.rodada] = {
      pontos: r.pontos,
      entrou_em_campo: r.entrou_em_campo === null
        ? null
        : r.entrou_em_campo === 1,
      scout: r.scout_json ? JSON.parse(r.scout_json) : undefined,
    };
  }
  return Promise.resolve(out);
}

/** Quais rodadas já foram snapshotadas (cuidado: array pode estar
 *  esparso se rodadas foram puladas). */
export function getRodadasComSnapshot(): Promise<number[]> {
  const rows = getDb().prepare(
    "SELECT DISTINCT rodada FROM historico_atleta ORDER BY rodada",
  ).all<{ rodada: number }>();
  return Promise.resolve(rows.map((r) => r.rodada));
}
