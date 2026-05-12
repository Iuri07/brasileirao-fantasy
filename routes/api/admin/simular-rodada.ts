import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getRodadaStatus,
  setElenco,
  setRodadaStatus,
} from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/**
 * Simula uma rodada ao vivo (snapshot estático) pra testar a UI sem
 * depender do Cartola real.
 *
 * POST /api/admin/simular-rodada
 *   body opcional: { min?: number, max?: number, entrouPct?: number }
 *
 *   - Coloca rodada_atual em status="ao_vivo".
 *   - Pra cada jogador de cada elenco, sorteia pontos entre min..max
 *     (default -5..20) e marca entrou_em_campo=true em entrouPct% (default 70).
 *   - Atletas com status "Nulo" (status_id=6) ficam com pontos=0 e
 *     entrou_em_campo=false (não jogaram).
 *
 * POST /api/admin/simular-rodada?encerrar=1
 *   - Volta rodada_atual pra status="aguardando".
 *   - Mantém os pontos no elenco (zere manualmente se quiser).
 *
 * POST /api/admin/simular-rodada?encerrar=1&zerar=1
 *   - Mesmo do anterior + zera pontos e entrou_em_campo de todo mundo.
 */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas admin" }),
        { status: 403, headers: H },
      );
    }
    const url = new URL(req.url);
    const encerrar = url.searchParams.get("encerrar") === "1";
    const zerar = url.searchParams.get("zerar") === "1";

    const kv = await Deno.openKv();
    const status = await getRodadaStatus(kv);
    const rodadaAtual = status?.rodada ?? 1;
    const now = new Date().toISOString();

    if (encerrar) {
      // Libera o cron pra atualizar de novo a partir da Cartola real
      await kv.delete(["simulando"]);
      await setRodadaStatus(kv, {
        status: "aguardando",
        rodada: rodadaAtual,
        atualizadoEm: now,
        fechamento: status?.fechamento,
      });
      let tocados = 0;
      if (zerar) {
        const elencos = await getAllElencos(kv);
        for (const [chave, elenco] of Object.entries(elencos)) {
          for (const j of Object.values(elenco.jogadores)) {
            j.pontos = 0;
            j.entrou_em_campo = false;
          }
          await setElenco(kv, chave, elenco);
          tocados++;
        }
      }
      return new Response(
        JSON.stringify({ ok: true, encerrou: true, zerou: zerar, tocados }),
        { headers: H },
      );
    }

    // Body opcional
    let body: { min?: number; max?: number; entrouPct?: number } = {};
    try {
      body = await req.json();
    } catch {
      // body vazio é OK
    }
    const min = Number.isFinite(body.min) ? body.min! : -5;
    const max = Number.isFinite(body.max) ? body.max! : 20;
    const entrouPct = Number.isFinite(body.entrouPct) ? body.entrouPct! : 70;

    // Trava o cron pra não sobrescrever a simulação a cada 5min
    await kv.set(["simulando"], true);

    // 1. Marca rodada ao vivo
    await setRodadaStatus(kv, {
      status: "ao_vivo",
      rodada: rodadaAtual,
      atualizadoEm: now,
      // mantém fechamento se houver
      fechamento: status?.fechamento,
    });

    // 2. Sorteia pontos pra cada jogador de cada elenco
    const elencos = await getAllElencos(kv);
    let totalJogadores = 0;
    let totalEntraram = 0;
    for (const [chave, elenco] of Object.entries(elencos)) {
      for (const j of Object.values(elenco.jogadores)) {
        totalJogadores++;
        // Nulo (status_id=6) não joga
        if (j.status_id === 6) {
          j.pontos = 0;
          j.entrou_em_campo = false;
          continue;
        }
        const entrou = Math.random() * 100 < entrouPct;
        if (!entrou) {
          j.pontos = 0;
          j.entrou_em_campo = false;
          continue;
        }
        totalEntraram++;
        const range = max - min;
        // Distribuição com viés pra perto da média (soma de dois uniformes)
        const r1 = Math.random();
        const r2 = Math.random();
        const t = (r1 + r2) / 2;
        const raw = min + range * t;
        j.pontos = Math.round(raw * 10) / 10; // 1 casa decimal
        j.entrou_em_campo = true;
      }
      await setElenco(kv, chave, elenco);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        rodada: rodadaAtual,
        status: "ao_vivo",
        elencos: Object.keys(elencos).length,
        totalJogadores,
        totalEntraram,
        params: { min, max, entrouPct },
      }),
      { headers: H },
    );
  },
};
