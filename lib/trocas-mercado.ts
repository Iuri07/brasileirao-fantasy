// Contador LIFETIME (não reseta) de trocas com mercado por time.
// Antes: (chave, rodada, count) — 1 row por rodada, admin editava por
// rodada. Agora: contador único acumulado (rodada=0 como sentinel de
// "lifetime bucket"). Trocas user-to-user ficam ilimitadas (não passam
// por aqui).

import { getDb } from "./db.ts";

/** Compat: valor "máximo" antigo. Sem cap agora — retorna Infinity. */
export function getMaxTrocasMercado(): number {
  return Infinity;
}

/** Compat: aceita mas ignora. */
export function setMaxTrocasMercado(_n: number): Promise<void> {
  return Promise.resolve();
}

/** Total ACUMULADO de trocas com mercado do time (SUM de todas as
 *  linhas — legacy per-rodada + lifetime bucket em rodada=0). */
export function getTrocasMercadoTotal(chave: string): number {
  const r = getDb().prepare(
    "SELECT COALESCE(SUM(count), 0) AS total FROM trocas_mercado WHERE chave=?",
  ).get<{ total: number }>(chave);
  return r?.total ?? 0;
}

/** Compat: retorna o total lifetime do time (ignora rodada). */
export function getTrocasMercadoCount(
  chave: string,
  _rodada?: number,
): number {
  return getTrocasMercadoTotal(chave);
}

/** Define o total lifetime do time (admin override). Zera todas as
 *  linhas do chave e insere 1 linha em rodada=0 com o novo total. */
export function setTrocasMercadoTotal(
  chave: string,
  total: number,
): Promise<void> {
  const c = Math.max(0, Math.trunc(total));
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM trocas_mercado WHERE chave=?").run(chave);
    db.prepare(
      "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, 0, ?)",
    ).run(chave, c);
  })();
  return Promise.resolve();
}

/** Compat: encaminha pro setTrocasMercadoTotal (o rodada é ignorado). */
export function setTrocasMercadoCount(
  chave: string,
  _rodada: number,
  count: number,
): Promise<void> {
  return setTrocasMercadoTotal(chave, count);
}

/** Incrementa o contador lifetime do time em 1. Retorna o NOVO total.
 *  Sempre grava em rodada=0 pra manter 1 linha por time. */
export function incTrocasMercadoCount(
  chave: string,
  _rodada?: number,
): Promise<number> {
  const db = getDb();
  db.prepare(
    "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, 0, 1) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET count=count + 1",
  ).run(chave);
  return Promise.resolve(getTrocasMercadoTotal(chave));
}

/** Ajusta o count em ±delta (pode ser negativo). Usado por transferência
 *  de trocas em ofertas aceitas. Sempre no bucket lifetime (rodada=0). */
export function adjustTrocasMercadoCount(
  chave: string,
  _rodada: number,
  delta: number,
): Promise<number> {
  const d = Math.trunc(delta);
  const db = getDb();
  db.prepare(
    "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, 0, ?) " +
      "ON CONFLICT (chave, rodada) DO UPDATE SET count=count + excluded.count",
  ).run(chave, d);
  return Promise.resolve(getTrocasMercadoTotal(chave));
}

/** Compat: retorna 1 linha por chave (o total lifetime) — mesma
 *  assinatura da API antiga. `rodada` é ignorado. */
export function getTrocasMercadoRodada(
  _rodada: number,
): Promise<Array<{ chave: string; count: number }>> {
  const rows = getDb().prepare(
    "SELECT chave, COALESCE(SUM(count), 0) AS count FROM trocas_mercado GROUP BY chave ORDER BY chave",
  ).all<{ chave: string; count: number }>();
  return Promise.resolve(rows);
}

/** Migração one-shot: para cada chave, soma todas as linhas legacy
 *  (rodada != 0) e move o total pra 1 única linha em rodada=0.
 *  Idempotente: se o chave já tem só rodada=0, nada acontece. */
export function migrarTrocasMercadoPraLifetime(): Promise<
  { chaves_migradas: number }
> {
  const db = getDb();
  let migradas = 0;
  db.transaction(() => {
    const chaves = db.prepare(
      "SELECT DISTINCT chave FROM trocas_mercado WHERE rodada != 0",
    ).all<{ chave: string }>();
    for (const { chave } of chaves) {
      const totalRow = db.prepare(
        "SELECT COALESCE(SUM(count), 0) AS total FROM trocas_mercado WHERE chave=?",
      ).get<{ total: number }>(chave);
      const total = totalRow?.total ?? 0;
      db.prepare("DELETE FROM trocas_mercado WHERE chave=?").run(chave);
      db.prepare(
        "INSERT INTO trocas_mercado (chave, rodada, count) VALUES (?, 0, ?)",
      ).run(chave, total);
      migradas++;
    }
  })();
  return Promise.resolve({ chaves_migradas: migradas });
}
