import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getRodadaStatus,
  setElenco,
  setRodadaStatus,
} from "../../../lib/kv.ts";
import { fetchPartidas } from "../../../lib/cartola.ts";
import { getDb } from "../../../lib/db.ts";
import type { JogadorKV } from "../../../lib/types.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

/** Gera scout aleatório plausível pra um atleta que entrou em campo,
 *  baseado na posição. Retorna o objeto scout e a pontuação derivada
 *  (somando os valores de cada evento × peso Cartola simplificado). */
function gerarScout(posicao: string): {
  scout: Record<string, number>;
  pontos: number;
} {
  const s: Record<string, number> = {};

  // Probabilidades por posição. Multiplica por 1 chance, depois sortear
  // a quantidade (1, 2 ou 3 eventos quando pega).
  // [probabilidade, max_qtd, pesoCartola]
  type Evt = [string, number, number, number];
  const EVENTOS: Record<string, Evt[]> = {
    Goleiro: [
      ["DD", 0.5, 3, 3],
      ["DP", 0.05, 1, 7],
      ["GS", 0.45, 3, -2],
      ["SG", 0.4, 1, 5], // só conta se não tomou gol — corrige depois
      ["PI", 0.6, 3, -0.1],
      ["CA", 0.07, 1, -2],
      ["CV", 0.01, 1, -5],
    ],
    Lateral: [
      ["G", 0.04, 1, 8],
      ["A", 0.08, 1, 5],
      ["FT", 0.04, 1, 3],
      ["FD", 0.1, 2, 1.7],
      ["FF", 0.2, 2, 0.7],
      ["FS", 0.6, 4, 0.5],
      ["DS", 0.7, 5, 1.5],
      ["PI", 0.7, 6, -0.1],
      ["CA", 0.18, 1, -2],
      ["CV", 0.02, 1, -5],
      ["SG", 0.4, 1, 5],
    ],
    Zagueiro: [
      ["G", 0.05, 1, 8],
      ["A", 0.05, 1, 5],
      ["FT", 0.03, 1, 3],
      ["FF", 0.1, 1, 0.7],
      ["FS", 0.4, 3, 0.5],
      ["DS", 0.75, 6, 1.5],
      ["PI", 0.7, 5, -0.1],
      ["CA", 0.22, 1, -2],
      ["CV", 0.03, 1, -5],
      ["SG", 0.4, 1, 5],
    ],
    Meia: [
      ["G", 0.12, 1, 8],
      ["A", 0.22, 1, 5],
      ["FT", 0.1, 1, 3],
      ["FD", 0.3, 2, 1.7],
      ["FF", 0.45, 2, 0.7],
      ["FS", 0.7, 4, 0.5],
      ["DS", 0.5, 4, 1.5],
      ["PI", 0.85, 8, -0.1],
      ["I", 0.1, 1, -0.1],
      ["CA", 0.12, 1, -2],
      ["CV", 0.015, 1, -5],
    ],
    Atacante: [
      ["G", 0.3, 2, 8],
      ["A", 0.2, 1, 5],
      ["FT", 0.25, 1, 3],
      ["FD", 0.55, 3, 1.7],
      ["FF", 0.65, 3, 0.7],
      ["FS", 0.7, 4, 0.5],
      ["I", 0.25, 2, -0.1],
      ["PI", 0.7, 5, -0.1],
      ["CA", 0.1, 1, -2],
      ["CV", 0.012, 1, -5],
    ],
    Técnico: [], // técnico não tem scout
  };

  const eventos = EVENTOS[posicao] ?? [];
  let pontos = 0;
  for (const [codigo, prob, maxQtd, peso] of eventos) {
    if (Math.random() < prob) {
      const qtd = 1 + Math.floor(Math.random() * maxQtd);
      s[codigo] = qtd;
      pontos += qtd * peso;
    }
  }
  // SG (sem sofrer gols) anula se tem GS
  if (s.GS && s.SG) {
    pontos -= 5;
    delete s.SG;
  }
  return { scout: s, pontos: Math.round(pontos * 10) / 10 };
}

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

    const status = await getRodadaStatus();
    const rodadaAtual = status?.rodada ?? 1;
    const now = new Date().toISOString();

    if (encerrar) {
      // Libera o cron pra atualizar de novo a partir da Cartola real
      const db = getDb();
      db.prepare("DELETE FROM simulando").run();
      db.prepare("DELETE FROM sim_scout").run();
      db.prepare("DELETE FROM sim_partidas").run();
      await setRodadaStatus({
        status: "aguardando",
        rodada: rodadaAtual,
        atualizadoEm: now,
        fechamento: status?.fechamento,
      });
      let tocados = 0;
      if (zerar) {
        const elencos = await getAllElencos();
        for (const [chave, elenco] of Object.entries(elencos)) {
          for (const j of Object.values(elenco.jogadores)) {
            j.pontos = 0;
            j.entrou_em_campo = false;
          }
          await setElenco(chave, elenco);
          tocados++;
        }
      }
      return new Response(
        JSON.stringify({ ok: true, encerrou: true, zerou: zerar, tocados }),
        { headers: H },
      );
    }

    // Body opcional
    let body: { entrouPct?: number } = {};
    try {
      body = await req.json();
    } catch {
      // body vazio é OK
    }
    const entrouPct = Number.isFinite(body.entrouPct) ? body.entrouPct! : 70;

    // Trava o cron pra não sobrescrever a simulação a cada 5min
    getDb().prepare(
      "INSERT INTO simulando (id, ativo) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET ativo=1",
    ).run();

    // 1. Marca rodada ao vivo
    await setRodadaStatus({
      status: "ao_vivo",
      rodada: rodadaAtual,
      atualizadoEm: now,
      fechamento: status?.fechamento,
    });

    // 2. Gera scout + pontos derivados pra cada jogador
    const elencos = await getAllElencos();
    const scoutMap: Record<string, Record<string, number>> = {};
    let totalJogadores = 0;
    let totalEntraram = 0;
    for (const [chave, elenco] of Object.entries(elencos)) {
      for (const j of Object.values(elenco.jogadores) as JogadorKV[]) {
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
        const { scout, pontos } = gerarScout(j.posicao);
        j.pontos = pontos;
        j.entrou_em_campo = true;
        if (Object.keys(scout).length > 0) {
          scoutMap[String(j.atleta_id)] = scout;
        }
      }
      await setElenco(chave, elenco);
    }

    // 3. Salva scout pro proxy /api/live retornar
    getDb().prepare(
      "INSERT INTO sim_scout (id, data_json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data_json=excluded.data_json",
    ).run(JSON.stringify(scoutMap));

    // 4. Gera placares simulados das partidas da rodada atual. Pega o
    //    schedule da Cartola e sorteia placares 0..3 com bias pra valores
    //    baixos. Estado "EM ANDAMENTO" pra todas.
    let comPartidas = 0;
    try {
      const real = await fetchPartidas();
      const rand = () => {
        // 0..3, com viés pra 0/1
        const r = Math.random();
        if (r < 0.3) return 0;
        if (r < 0.65) return 1;
        if (r < 0.88) return 2;
        return 3;
      };
      const partidas = (real.partidas ?? []).map((p) => ({
        ...p,
        placar_oficial_mandante: rand(),
        placar_oficial_visitante: rand(),
        status_transmissao_tr: "EM ANDAMENTO",
      }));
      getDb().prepare(
        "INSERT INTO sim_partidas (id, data_json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data_json=excluded.data_json",
      ).run(JSON.stringify({ ...real, partidas }));
      comPartidas = partidas.length;
    } catch {
      // Sem Cartola disponível — pula partidas, o proxy cai no fallback
    }

    return new Response(
      JSON.stringify({
        ok: true,
        rodada: rodadaAtual,
        status: "ao_vivo",
        elencos: Object.keys(elencos).length,
        totalJogadores,
        totalEntraram,
        comScout: Object.keys(scoutMap).length,
        comPartidas,
      }),
      { headers: H },
    );
  },
};
