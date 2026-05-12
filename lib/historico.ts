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
