// Backfill do snapshot de pontuação por atleta x rodada — usa Cartola
// pra puxar rodadas finalizadas que não temos local ainda.
//
// POST /api/admin/backfill-historico-atleta?rodadas=1-17
//   ou ?rodadas=5,8,12

import { Handlers } from "$fresh/server.ts";
import { getRodadaStatus } from "../../../lib/kv.ts";
import {
  type AtletaRodada,
  getRodadasComSnapshot,
  setHistoricoAtletaBatch,
} from "../../../lib/historico-atleta.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

interface PontuadosResp {
  atletas?: Record<string, {
    pontuacao?: number;
    entrou_em_campo?: boolean;
    scout?: Record<string, number>;
  } | undefined>;
}

async function fetchPontuadosRodada(rodada: number): Promise<PontuadosResp | null> {
  try {
    const r = await fetch(
      `https://api.cartola.globo.com/atletas/pontuados/${rodada}`,
      { headers: { "User-Agent": "BFFantasy" } },
    );
    if (!r.ok) return null;
    return await r.json() as PontuadosResp;
  } catch {
    return null;
  }
}

function parseRodadas(param: string | null, max: number): number[] {
  if (!param) {
    // Default: 1..max
    return Array.from({ length: max }, (_, i) => i + 1);
  }
  // Range "1-17" ou lista "5,8,12" ou combo "1-5,7,9-12"
  const out = new Set<number>();
  for (const chunk of param.split(",")) {
    const t = chunk.trim();
    if (t.includes("-")) {
      const [a, b] = t.split("-").map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let r = Math.max(1, a); r <= Math.min(max, b); r++) out.add(r);
      }
    } else {
      const r = Number(t);
      if (Number.isFinite(r) && r >= 1 && r <= max) out.add(r);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const url = new URL(req.url);
    const rodadaAtual = (await getRodadaStatus())?.rodada ?? 1;
    const rodadasParam = url.searchParams.get("rodadas");
    const rodadasPedidas = parseRodadas(rodadasParam, rodadaAtual);
    const skipExistentes = url.searchParams.get("skip_existentes") !== "0";

    const jaTem = skipExistentes
      ? new Set(await getRodadasComSnapshot())
      : new Set<number>();
    const rodadasParaBackfill = rodadasPedidas.filter((r) => !jaTem.has(r));

    if (rodadasParaBackfill.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          mensagem: "Nada pra fazer — todas as rodadas pedidas já têm snapshot",
          rodadasPedidas,
          rodadasComSnapshot: [...jaTem].sort((a, b) => a - b),
        }),
        { headers: H },
      );
    }

    const t0 = Date.now();
    const resultados: Array<{
      rodada: number;
      atletas: number;
      erro?: string;
    }> = [];
    for (const rodada of rodadasParaBackfill) {
      const resp = await fetchPontuadosRodada(rodada);
      if (!resp?.atletas) {
        resultados.push({ rodada, atletas: 0, erro: "Cartola retornou vazio" });
        continue;
      }
      const map = new Map<number, AtletaRodada>();
      for (const [idStr, p] of Object.entries(resp.atletas)) {
        if (!p) continue;
        map.set(Number(idStr), {
          pontos: p.pontuacao ?? 0,
          entrou_em_campo: p.entrou_em_campo ?? null,
          scout: p.scout ?? undefined,
        });
      }
      if (map.size > 0) {
        await setHistoricoAtletaBatch(rodada, map);
      }
      resultados.push({ rodada, atletas: map.size });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        duracaoMs: Date.now() - t0,
        rodadasProcessadas: resultados.length,
        resultados,
      }),
      { headers: H },
    );
  },
};
