import { Handlers } from "$fresh/server.ts";
import { getAllElencos, getRodadaStatus } from "../../../lib/kv.ts";

// Proxy minimalista pra Cartola API com cache de 30s — evita
// problemas de CORS/mixed-content no browser e reduz hits diretos
// quando vários clientes pollings simultâneo (cache do servidor).
//
// Durante simulação admin (KV["simulando"]=true), intercepta os
// endpoints relevantes (atletas/pontuados, mercado/status, partidas)
// e responde com dados sintetizados do KV — assim a /ao-vivo
// funciona em modo simulado sem depender da Cartola.

const BASE = "https://api.cartola.globo.com";
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  body: string;
  contentType: string;
}
const cache = new Map<string, CacheEntry>();

const H = { "Content-Type": "application/json; charset=UTF-8" };

async function simularPontuados(kv: Deno.Kv): Promise<Response> {
  const [elencos, rodada, simScout] = await Promise.all([
    getAllElencos(kv),
    getRodadaStatus(kv),
    kv.get<Record<string, Record<string, number>>>(["sim_scout"]),
  ]);
  const scoutMap = simScout.value ?? {};
  const atletas: Record<
    string,
    {
      pontuacao: number;
      entrou_em_campo: boolean;
      scout: Record<string, number>;
    }
  > = {};
  for (const elenco of Object.values(elencos)) {
    for (const j of Object.values(elenco.jogadores)) {
      // Cartola só inclui atletas que entraram em campo
      if (!j.entrou_em_campo) continue;
      atletas[String(j.atleta_id)] = {
        pontuacao: j.pontos ?? 0,
        entrou_em_campo: true,
        scout: scoutMap[String(j.atleta_id)] ?? {},
      };
    }
  }
  return new Response(
    JSON.stringify({
      rodada_id: rodada?.rodada ?? 1,
      atletas,
    }),
    { headers: { ...H, "X-Cache": "SIM" } },
  );
}

async function simularMercadoStatus(kv: Deno.Kv): Promise<Response> {
  const rodada = await getRodadaStatus(kv);
  return new Response(
    JSON.stringify({
      status_mercado: 2, // 2 = fechado / rodada rolando
      rodada_atual: rodada?.rodada ?? 1,
      bola_rolando: true,
      fechamento: rodada?.fechamento,
    }),
    { headers: { ...H, "X-Cache": "SIM" } },
  );
}

async function simularPartidas(kv: Deno.Kv): Promise<Response | null> {
  // Se admin gerou partidas simuladas, usa elas; senão deixa o proxy
  // pegar as reais da Cartola (pra UI mostrar partidas da rodada atual).
  const r = await kv.get<unknown>(["sim_partidas"]);
  if (!r.value) return null;
  return new Response(
    JSON.stringify(r.value),
    { headers: { ...H, "X-Cache": "SIM" } },
  );
}

export const handler: Handlers = {
  async GET(req, ctx) {
    const path = (ctx.params.path as unknown as string) ?? "";

    // Intercepta endpoints quando simulação está ativa
    const kv = await Deno.openKv();
    const sim = await kv.get<boolean>(["simulando"]);
    if (sim.value) {
      if (path === "atletas/pontuados") return await simularPontuados(kv);
      if (path === "mercado/status") return await simularMercadoStatus(kv);
      if (path === "partidas") {
        const r = await simularPartidas(kv);
        if (r) return r;
        // fallthrough → Cartola real
      }
    }

    const url = new URL(req.url);
    const search = url.searchParams.toString();
    const target = `${BASE}/${path}${search ? `?${search}` : ""}`;

    const cached = cache.get(target);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=15",
          "X-Cache": "HIT",
        },
      });
    }

    try {
      const r = await fetch(target, {
        headers: { "User-Agent": "Mozilla/5.0 BFFantasy/1.0" },
      });
      const body = await r.text();
      const contentType = r.headers.get("content-type") ??
        "application/json; charset=UTF-8";
      if (r.ok) {
        cache.set(target, {
          body,
          contentType,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
      return new Response(body, {
        status: r.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=15",
          "X-Cache": "MISS",
        },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ erro: String(e) }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
