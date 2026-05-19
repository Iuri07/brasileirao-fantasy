import { Handlers } from "$fresh/server.ts";
import { getAllElencos, getRodadaStatus } from "../../../lib/kv.ts";
import { fetchPartidasCacheado } from "../../../lib/cartola.ts";
import { type EventoHist, listarEventos } from "../../../lib/eventos-hist.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/** Admin only — estima timestamps de eventos antigos (registrados pelo
 *  cron de 5min, todos os lances de um ciclo ficaram com o mesmo ts).
 *
 *  Estratégia:
 *  - Agrupa eventos por ts (batches)
 *  - Pra cada batch >1, ordena por kickoff do jogo do clube + atleta
 *  - Espalha linearmente dentro da janela [ts-5min, ts]
 *
 *  Eventos novos (cron 1min) raramente formam batch >1 → não são alterados.
 *  Pra rodar manualmente: POST /api/admin/eventos-estimar { rodada? } */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Admin only" }),
        { status: 403, headers: H },
      );
    }
    let body: { rodada?: number; cycleMin?: number } = {};
    try {
      body = await req.json();
    } catch {
      // body opcional
    }
    const rodada = body.rodada ?? (await getRodadaStatus())?.rodada ?? 0;
    if (!rodada) {
      return new Response(
        JSON.stringify({ ok: false, erro: "rodada não encontrada" }),
        { status: 400, headers: H },
      );
    }
    const CYCLE_MS = (body.cycleMin ?? 5) * 60_000;

    // Mapa atleta_id → clube_id pra achar a partida
    const elencos = await getAllElencos();
    const clubePorAtleta = new Map<number, number>();
    for (const elenco of Object.values(elencos)) {
      for (const j of Object.values(elenco.jogadores)) {
        clubePorAtleta.set(j.atleta_id, j.clube_id);
      }
    }
    // Partidas → kickoff por clube (em ms)
    const partidasResp = await fetchPartidasCacheado().catch(() => null);
    const kickoffPorClube = new Map<number, number>();
    for (const p of partidasResp?.partidas ?? []) {
      const ts = p.timestamp * 1000;
      kickoffPorClube.set(p.clube_casa_id, ts);
      kickoffPorClube.set(p.clube_visitante_id, ts);
    }

    const eventos = await listarEventos(rodada, 10000);
    // Agrupa por ts original
    const byTs = new Map<number, EventoHist[]>();
    for (const e of eventos) {
      if (!byTs.has(e.ts)) byTs.set(e.ts, []);
      byTs.get(e.ts)!.push(e);
    }

    let updated = 0;
    let batchesProcessados = 0;
    for (const [batchTs, batch] of byTs) {
      if (batch.length <= 1) continue;
      batchesProcessados++;
      // Ordena por kickoff (jogos que começaram antes → eventos antes)
      // depois por atletaId/codigo pra tiebreak estável
      batch.sort((a, b) => {
        const ka = kickoffPorClube.get(clubePorAtleta.get(a.atletaId) ?? 0) ??
          0;
        const kb = kickoffPorClube.get(clubePorAtleta.get(b.atletaId) ?? 0) ??
          0;
        return ka - kb ||
          a.atletaId - b.atletaId ||
          a.codigo.localeCompare(b.codigo);
      });
      const startMs = batchTs - CYCLE_MS;
      const step = CYCLE_MS / batch.length;
      for (let i = 0; i < batch.length; i++) {
        const ev = batch[i];
        const novoTs = Math.round(startMs + (i + 0.5) * step);
        if (novoTs === ev.ts) continue;
        const { getDb, i64 } = await import("../../../lib/db.ts");
        const db = getDb();
        db.transaction(() => {
          db.prepare(
            "DELETE FROM evento_hist WHERE rodada=? AND ts=? AND atleta_id=? AND codigo=?",
          ).run(ev.rodada, i64(ev.ts), ev.atletaId, ev.codigo);
          db.prepare(
            "INSERT OR REPLACE INTO evento_hist (rodada, ts, atleta_id, codigo, qtd) VALUES (?, ?, ?, ?, ?)",
          ).run(ev.rodada, i64(novoTs), ev.atletaId, ev.codigo, ev.qtd);
        })();
        updated++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        rodada,
        cycleMin: CYCLE_MS / 60_000,
        totalEventos: eventos.length,
        batches: byTs.size,
        batchesProcessados,
        eventosAjustados: updated,
      }),
      { headers: H },
    );
  },
};
