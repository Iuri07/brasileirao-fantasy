import { Handlers } from "$fresh/server.ts";
import { getAllElencos, getRodadaStatus } from "../../../lib/kv.ts";
import { getDb } from "../../../lib/db.ts";

// Proxy minimalista pra Cartola API com cache de 30s.

const BASE = "https://api.cartola.globo.com";
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  body: string;
  contentType: string;
}
const cache = new Map<string, CacheEntry>();

const H = { "Content-Type": "application/json; charset=UTF-8" };

function isSimulando(): boolean {
  const r = getDb().prepare("SELECT ativo FROM simulando WHERE id=1")
    .get<{ ativo: number }>();
  return r?.ativo === 1;
}

function getSimScout(): Record<string, Record<string, number>> {
  const r = getDb().prepare("SELECT data_json FROM sim_scout WHERE id=1")
    .get<{ data_json: string }>();
  if (!r) return {};
  try {
    return JSON.parse(r.data_json) as Record<string, Record<string, number>>;
  } catch {
    return {};
  }
}

function getSimPartidas(): unknown | null {
  const r = getDb().prepare("SELECT data_json FROM sim_partidas WHERE id=1")
    .get<{ data_json: string }>();
  if (!r) return null;
  try {
    return JSON.parse(r.data_json);
  } catch {
    return null;
  }
}

async function simularPontuados(): Promise<Response> {
  const [elencos, rodada] = await Promise.all([
    getAllElencos(),
    getRodadaStatus(),
  ]);
  const scoutMap = getSimScout();
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

async function simularMercadoStatus(): Promise<Response> {
  const rodada = await getRodadaStatus();
  return new Response(
    JSON.stringify({
      status_mercado: 2,
      rodada_atual: rodada?.rodada ?? 1,
      bola_rolando: true,
      fechamento: rodada?.fechamento,
    }),
    { headers: { ...H, "X-Cache": "SIM" } },
  );
}

function simularPartidas(): Response | null {
  const sim = getSimPartidas();
  if (!sim) return null;
  return new Response(JSON.stringify(sim), {
    headers: { ...H, "X-Cache": "SIM" },
  });
}

export const handler: Handlers = {
  async GET(req, ctx) {
    const path = (ctx.params.path as unknown as string) ?? "";

    if (isSimulando()) {
      if (path === "atletas/pontuados") return await simularPontuados();
      if (path === "mercado/status") return await simularMercadoStatus();
      if (path === "partidas") {
        const r = simularPartidas();
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
