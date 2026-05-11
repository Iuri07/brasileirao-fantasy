import { Handlers } from "$fresh/server.ts";

// Proxy minimalista pra Cartola API com cache de 30s — evita
// problemas de CORS/mixed-content no browser e reduz hits diretos
// quando vários clientes pollings simultâneo (cache do servidor).

const BASE = "https://api.cartola.globo.com";
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  body: string;
  contentType: string;
}
const cache = new Map<string, CacheEntry>();

export const handler: Handlers = {
  async GET(req, ctx) {
    const path = (ctx.params.path as unknown as string) ?? "";
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
