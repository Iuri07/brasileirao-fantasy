// Histórico de eventos da rodada — detectado pelo cron via diff entre
// snapshots do scout Cartola. Persistido em KV pra sobreviver reload
// (timeline client-side era só da sessão).
//
// KV layout:
// - ["scout_estado", rodada, atletaId] = { codigo: qtd, ... }
//   Última leitura do scout por atleta. Comparada com novo poll pra
//   detectar incrementos. Por-atleta pra ficar abaixo do limite 64KB.
// - ["evento_hist", rodada, -ts, atletaId, codigo] = EventoHist
//   Um por evento detectado. Timestamp negativo pra listar desc.

export interface EventoHist {
  /** Unix ms */
  ts: number;
  rodada: number;
  atletaId: number;
  /** Código Cartola: G, A, CA, CV, etc. */
  codigo: string;
  /** Quantidade detectada nesta detecção (diff vs anterior). */
  qtd: number;
}

export async function getEstadoScout(
  kv: Deno.Kv,
  rodada: number,
  atletaId: number,
): Promise<Record<string, number>> {
  const r = await kv.get<Record<string, number>>([
    "scout_estado",
    rodada,
    atletaId,
  ]);
  return r.value ?? {};
}

export async function setEstadoScout(
  kv: Deno.Kv,
  rodada: number,
  atletaId: number,
  scout: Record<string, number>,
): Promise<void> {
  await kv.set(["scout_estado", rodada, atletaId], scout);
}

export async function appendEvento(
  kv: Deno.Kv,
  evento: EventoHist,
): Promise<void> {
  // Key includes ts + atletaId + codigo pra unicidade. Negative ts
  // pra ordenação descending natural (mais recente primeiro com
  // kv.list ascending).
  await kv.set(
    [
      "evento_hist",
      evento.rodada,
      -evento.ts,
      evento.atletaId,
      evento.codigo,
    ],
    evento,
  );
}

export async function listarEventos(
  kv: Deno.Kv,
  rodada: number,
  limit = 100,
): Promise<EventoHist[]> {
  const out: EventoHist[] = [];
  for await (
    const entry of kv.list<EventoHist>({
      prefix: ["evento_hist", rodada],
    }, { limit })
  ) {
    out.push(entry.value);
  }
  return out;
}

/** Limpa estado scout + eventos de uma rodada — útil em testes ou
 *  pra resetar quando uma rodada termina. */
export async function limparRodada(
  kv: Deno.Kv,
  rodada: number,
): Promise<void> {
  for await (
    const entry of kv.list({ prefix: ["scout_estado", rodada] })
  ) {
    await kv.delete(entry.key);
  }
  for await (
    const entry of kv.list({ prefix: ["evento_hist", rodada] })
  ) {
    await kv.delete(entry.key);
  }
}
