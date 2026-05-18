import { FreshContext } from "$fresh/server.ts";
import {
  getSession,
  getSessionIdFromRequest,
  type SessionKV,
} from "../lib/auth.ts";

/** Tipos compartilhados — qualquer rota lê via ctx.state. */
export interface State {
  session: SessionKV | null;
  sessionId: string | null;
}

/** Rotas publicamente acessíveis sem login. */
const PUBLIC_PATHS = new Set([
  "/login",
]);

function isPublic(p: string): boolean {
  if (PUBLIC_PATHS.has(p)) return true;
  if (p.startsWith("/api/auth/")) return true;
  if (p.startsWith("/_frsh/")) return true;
  // Static assets
  if (p.startsWith("/atletas/")) return true;
  if (p.startsWith("/escudos/")) return true;
  if (p.startsWith("/times_escudos/")) return true;
  if (p.startsWith("/players/")) return true;
  if (p.startsWith("/fonts/")) return true;
  if (p.startsWith("/assets/")) return true;
  if (p.startsWith("/design-system/")) return true;
  if (p === "/bf-styles.css") return true;
  if (p === "/styles.css") return true;
  if (p === "/favicon.ico") return true;
  if (p.startsWith("/favicon-")) return true;
  if (p === "/logo_site.png") return true;
  // Admin sync endpoints (CLI use)
  if (p.startsWith("/api/admin/sync-")) return true;
  if (p === "/api/admin/atualizar") return true;
  if (p === "/api/admin/seed") return true;
  return false;
}

export async function handler(req: Request, ctx: FreshContext<State>) {
  const url = new URL(req.url);
  const p = url.pathname;

  // 1. Carrega sessão (se houver cookie válido)
  const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
  const sessionId = getSessionIdFromRequest(req);
  const session = sessionId ? await getSession(kv, sessionId) : null;
  ctx.state.sessionId = sessionId;
  ctx.state.session = session;

  // 2. Enforcement de auth: rotas privadas exigem sessão
  const publica = isPublic(p);
  if (!publica && !session) {
    // API responde 401; navegação responde 302 → /login
    if (p.startsWith("/api/")) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Não autenticado" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?next=${encodeURIComponent(p + url.search)}`,
      },
    });
  }

  // 3. Roteamento admin-only
  if (
    (p.startsWith("/admin") || p === "/admin") &&
    session?.role !== "admin"
  ) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }
  // 4. Admin sem chave usa um time default nas páginas — o redirect
  //    ficava chato (não conseguia ver a app). /admin continua disponível
  //    pelo menu do perfil.

  // 4. Chama o handler real
  const resp = await ctx.next();

  // 5. Cache headers
  if (resp.status === 200) {
    // 5a. Assets imutáveis (versionados via ?v=N) — cache de 1 ano
    const isAsset = p === "/bf-styles.css" ||
      p === "/styles.css" ||
      p.startsWith("/_frsh/") ||
      p.endsWith(".css") ||
      p.endsWith(".js") ||
      p.endsWith(".svg") ||
      p === "/logo_site.png" ||
      p === "/campo.svg" ||
      p === "/bola.png" ||
      p === "/favicon.ico" ||
      p.startsWith("/favicon-") ||
      p.startsWith("/atletas/") ||
      p.startsWith("/escudos/") ||
      p.startsWith("/players/") ||
      p.startsWith("/times_escudos/") ||
      p.startsWith("/fonts/");
    if (isAsset) {
      const headers = new Headers(resp.headers);
      headers.set(
        "Cache-Control",
        "public, max-age=31536000, stale-while-revalidate=604800, immutable",
      );
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    }

    // 5b. Páginas SSR autenticadas — browser pode cachear por 30s,
    // entrega instantânea em repeat navs. `private` = só cache do
    // usuário (não compartilhar entre users via proxy/CDN).
    // `stale-while-revalidate` = serve stale enquanto refetcha em
    // background — UX perfeita pra back/forward.
    const isPagina = !p.startsWith("/api/") &&
      !p.startsWith("/_frsh/") &&
      session !== null && // só pra usuários logados
      req.method === "GET" &&
      resp.headers.get("Content-Type")?.includes("text/html");
    if (isPagina) {
      const headers = new Headers(resp.headers);
      headers.set(
        "Cache-Control",
        "private, max-age=30, stale-while-revalidate=60",
      );
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    }
  }

  return resp;
}
