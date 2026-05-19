import type {
  CartolaAtleta,
  CartolaMercadoStatus,
  CartolaPontuadoAtleta,
} from "./types.ts";

const BASE = "https://api.cartola.globo.com";

export const POSICAO_ID_NOME: Record<number, string> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
  6: "Técnico",
};

export const POSICAO_NOME_CHAVE: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATA",
  "Técnico": "TEC",
};

// Cache in-process das chamadas Cartola — TTL curto pra balancear
// frescor (status pode mudar) vs latência (cartola atletas/mercado é
// 350KB JSON, parsing demora). Compartilhado entre requests no mesmo
// isolate do Deno Deploy.
interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}
const cartolaCache = new Map<string, CacheEntry<unknown>>();
const CARTOLA_TTL_MS: Record<string, number> = {
  "/atletas/mercado": 60_000, // 1min — catálogo muda pouco
  "/mercado/status": 30_000, // 30s — bola_rolando precisa ser fresco
  "/partidas": 60_000,
  "/atletas/pontuados": 15_000, // 15s — durante rodada muda rápido
};
const CARTOLA_TTL_DEFAULT = 60_000;

async function fetchCartola<T>(path: string): Promise<T> {
  const now = Date.now();
  const cached = cartolaCache.get(path);
  if (cached && cached.expiresAt > now) return cached.value as T;
  const r = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 CartolaMiniApp/1.0" },
  });
  if (!r.ok) throw new Error(`Cartola ${path} → ${r.status}`);
  const value = await r.json() as T;
  const ttl = CARTOLA_TTL_MS[path] ?? CARTOLA_TTL_DEFAULT;
  cartolaCache.set(path, { value, expiresAt: now + ttl });
  return value;
}

export function fetchMercadoStatus(): Promise<CartolaMercadoStatus> {
  return fetchCartola("/mercado/status");
}

export function fetchAtletasMercado(): Promise<{
  atletas: CartolaAtleta[];
  clubes: Record<
    string,
    { nome: string; abreviacao: string; nome_fantasia?: string }
  >;
  posicoes: Record<string, { nome: string; abreviacao: string }>;
  rodada_atual: number;
}> {
  return fetchCartola("/atletas/mercado");
}

/** Versão slim do clube — só nome+abreviacao (resto não usamos). */
type ClubeMin = { nome: string; abreviacao: string; nome_fantasia?: string };

/** Cache da resposta do Cartola /atletas/mercado. Em SQLite num único
 *  row (sem chunking — limite 64KB do KV não existe mais). TTL 5min. */
const MERCADO_CACHE_TTL_MS = 5 * 60 * 1000;

/** Cache em SQLite das partidas. TTL 2min. */
const PARTIDAS_CACHE_TTL_MS = 2 * 60 * 1000;

interface PartidasCache {
  data: Awaited<ReturnType<typeof fetchPartidas>>;
  cachedAt: number;
}

export async function fetchPartidasCacheado(): Promise<
  Awaited<ReturnType<typeof fetchPartidas>>
> {
  const { getDb } = await import("./db.ts");
  const db = getDb();
  const r = db.prepare(
    "SELECT data_json, atualizado_em FROM mercado_status_cache WHERE id=2",
  ).get<{ data_json: string; atualizado_em: string }>();
  // Reusa a tabela mercado_status_cache com id=2 pra partidas
  // (singleton expandido — id=1 status, id=2 partidas). Evita criar
  // outra tabela só pra isso.
  const now = Date.now();
  if (r) {
    try {
      const parsed = JSON.parse(r.data_json) as PartidasCache;
      if (parsed.cachedAt && now - parsed.cachedAt < PARTIDAS_CACHE_TTL_MS) {
        return parsed.data;
      }
    } catch { /* corrompido */ }
  }
  const fresh = await fetchPartidas();
  db.prepare(
    "INSERT INTO mercado_status_cache (id, atualizado_em, data_json) VALUES (2, ?, ?) " +
      "ON CONFLICT (id) DO UPDATE SET atualizado_em=excluded.atualizado_em, data_json=excluded.data_json",
  ).run(
    new Date(now).toISOString(),
    JSON.stringify({ data: fresh, cachedAt: now }),
  );
  return fresh;
}

/** Cache em SQLite do mercado/status. TTL 60s. */
const STATUS_CACHE_TTL_MS = 60 * 1000;

interface StatusCache {
  data: CartolaMercadoStatus;
  cachedAt: number;
}

export async function fetchMercadoStatusCacheado(): Promise<
  CartolaMercadoStatus
> {
  const { getDb } = await import("./db.ts");
  const db = getDb();
  const r = db.prepare(
    "SELECT data_json FROM mercado_status_cache WHERE id=1",
  ).get<{ data_json: string }>();
  const now = Date.now();
  if (r) {
    try {
      const parsed = JSON.parse(r.data_json) as StatusCache;
      if (parsed.cachedAt && now - parsed.cachedAt < STATUS_CACHE_TTL_MS) {
        return parsed.data;
      }
    } catch { /* corrompido */ }
  }
  const fresh = await fetchMercadoStatus();
  db.prepare(
    "INSERT INTO mercado_status_cache (id, atualizado_em, data_json) VALUES (1, ?, ?) " +
      "ON CONFLICT (id) DO UPDATE SET atualizado_em=excluded.atualizado_em, data_json=excluded.data_json",
  ).run(
    new Date(now).toISOString(),
    JSON.stringify({ data: fresh, cachedAt: now }),
  );
  return fresh;
}

interface MercadoCachePayload {
  atletas: CartolaAtleta[];
  clubes: Record<string, ClubeMin>;
  rodada_atual: number;
  cachedAt: number;
}

export async function fetchAtletasMercadoCacheado(): Promise<{
  atletas: CartolaAtleta[];
  clubes: Record<string, ClubeMin>;
  rodada_atual: number;
}> {
  const { getDb } = await import("./db.ts");
  const db = getDb();
  const r = db.prepare(
    "SELECT atletas_json FROM mercado_cache WHERE id=1",
  ).get<{ atletas_json: string }>();
  const now = Date.now();
  if (r) {
    try {
      const parsed = JSON.parse(r.atletas_json) as MercadoCachePayload;
      if (parsed.cachedAt && now - parsed.cachedAt < MERCADO_CACHE_TTL_MS) {
        return {
          atletas: parsed.atletas,
          clubes: parsed.clubes,
          rodada_atual: parsed.rodada_atual,
        };
      }
    } catch { /* corrompido */ }
  }
  const fresh = await fetchAtletasMercado();
  // Sem limite de 64KB agora — JSON inteiro num row.
  try {
    db.prepare(
      "INSERT INTO mercado_cache (id, atualizado_em, atletas_json) VALUES (1, ?, ?) " +
        "ON CONFLICT (id) DO UPDATE SET atualizado_em=excluded.atualizado_em, atletas_json=excluded.atletas_json",
    ).run(
      new Date(now).toISOString(),
      JSON.stringify(
        {
          atletas: fresh.atletas,
          clubes: fresh.clubes,
          rodada_atual: fresh.rodada_atual,
          cachedAt: now,
        } satisfies MercadoCachePayload,
      ),
    );
  } catch (e) {
    console.warn("[mercado_cache] persist failed:", e);
  }
  return {
    atletas: fresh.atletas,
    clubes: fresh.clubes,
    rodada_atual: fresh.rodada_atual,
  };
}

export function fetchAtletasPontuados(): Promise<{
  atletas: Record<string, CartolaPontuadoAtleta>;
  rodada_id: number;
}> {
  return fetchCartola("/atletas/pontuados");
}

export interface CartolaPartida {
  partida_id: number;
  clube_casa_id: number;
  clube_visitante_id: number;
  partida_data: string; // "YYYY-MM-DD HH:MM:SS"
  timestamp: number; // Unix seconds
  placar_oficial_mandante: number | null;
  placar_oficial_visitante: number | null;
  local: string;
  status_transmissao_tr: string; // "AGENDADA" | "EM ANDAMENTO" | "ENCERRADA" | ...
  valida: boolean;
}

export interface CartolaClube {
  abreviacao: string;
  nome?: string;
  nome_fantasia?: string;
  escudos?: Record<string, string>;
}

export function fetchPartidas(): Promise<{
  partidas: CartolaPartida[];
  clubes: Record<string, CartolaClube>;
  rodada?: number;
}> {
  return fetchCartola("/partidas");
}

export function fetchPartidasRodada(rodada: number) {
  return fetchCartola<{
    partidas: CartolaPartida[];
    clubes: Record<string, CartolaClube>;
    rodada?: number;
  }>(`/partidas/${rodada}`);
}
