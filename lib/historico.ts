// Histórico de pontuação por rodada por chave de elenco.
// Snapshot é gravado pelo cron `atualizarTudo` quando há pontos > 0
// pra rodada corrente. Idempotente (sobrescreve mesmo rodada/chave).

export type HistoricoKV = Record<string, number>; // rodada (string) → pontos

export async function getHistorico(
  kv: Deno.Kv,
  chave: string,
): Promise<HistoricoKV> {
  const r = await kv.get<HistoricoKV>(["historico", chave]);
  return r.value ?? {};
}

export async function setHistoricoRodada(
  kv: Deno.Kv,
  chave: string,
  rodada: number,
  pontos: number,
): Promise<void> {
  const atual = await getHistorico(kv, chave);
  atual[String(rodada)] = pontos;
  await kv.set(["historico", chave], atual);
}

export function totalPontos(h: HistoricoKV): number {
  return Object.values(h).reduce((s, p) => s + p, 0);
}

export function rodadasJogadas(h: HistoricoKV): number {
  return Object.keys(h).length;
}

/** Remove uma rodada do histórico. Usado pelo admin pra "limpar" células
 *  na matriz de edição. */
export async function deleteHistoricoRodada(
  kv: Deno.Kv,
  chave: string,
  rodada: number,
): Promise<void> {
  const atual = await getHistorico(kv, chave);
  delete atual[String(rodada)];
  await kv.set(["historico", chave], atual);
}

/** Lê o histórico de TODOS os times de uma vez. Útil pra construir a
 *  matriz times x rodadas que o admin edita. */
export async function getAllHistoricos(
  kv: Deno.Kv,
): Promise<Record<string, HistoricoKV>> {
  const out: Record<string, HistoricoKV> = {};
  for await (const e of kv.list<HistoricoKV>({ prefix: ["historico"] })) {
    const chave = String(e.key[1]);
    out[chave] = e.value;
  }
  return out;
}
