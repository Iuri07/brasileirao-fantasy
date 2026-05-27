// Admin endpoint pra gerenciar limite + contagens de trocas com mercado.
//
// GET  /api/admin/trocas-mercado?rodada=N → snapshot da rodada N
// PUT  /api/admin/trocas-mercado          → atualiza limite e/ou
//                                           override de contagens

import { Handlers } from "$fresh/server.ts";
import {
  getMaxTrocasMercado,
  getTrocasMercadoRodada,
  setMaxTrocasMercado,
  setTrocasMercadoCount,
} from "../../../lib/trocas-mercado.ts";
import { getRodadaStatus, TODAS_CHAVES } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async GET(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const url = new URL(req.url);
    const rodadaParam = url.searchParams.get("rodada");
    const rodada = rodadaParam
      ? parseInt(rodadaParam, 10)
      : ((await getRodadaStatus())?.rodada ?? 0);
    const max = getMaxTrocasMercado();
    const rows = await getTrocasMercadoRodada(rodada);
    // Inclui chaves com count=0 pro admin ter todas as linhas pra editar
    const map = new Map(rows.map((r) => [r.chave, r.count]));
    const times = TODAS_CHAVES.map((chave) => ({
      chave,
      count: map.get(chave) ?? 0,
      restante: Math.max(0, max - (map.get(chave) ?? 0)),
    }));
    return new Response(
      JSON.stringify({ ok: true, rodada, max, times }),
      { headers: H },
    );
  },

  async PUT(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    let body: {
      max?: number;
      rodada?: number;
      counts?: Record<string, number>;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }
    if (typeof body.max === "number") {
      await setMaxTrocasMercado(body.max);
    }
    if (body.counts && typeof body.counts === "object") {
      const rodada = body.rodada ??
        ((await getRodadaStatus())?.rodada ?? 0);
      if (rodada === 0) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Rodada inválida (0)" }),
          { status: 400, headers: H },
        );
      }
      for (const [chave, count] of Object.entries(body.counts)) {
        if (!TODAS_CHAVES.includes(chave)) continue;
        if (typeof count !== "number") continue;
        await setTrocasMercadoCount(chave, rodada, count);
      }
    }
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: H },
    );
  },
};
