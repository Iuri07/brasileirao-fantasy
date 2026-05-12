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
  const kv = await Deno.openKv();
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

  // 5. Cache pra assets estáticos curados
  if (
    resp.status === 200 &&
    (p.startsWith("/atletas/") || p.startsWith("/escudos/") ||
      p.startsWith("/times_escudos/"))
  ) {
    const headers = new Headers(resp.headers);
    headers.set(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    });
  }

  return resp;
}
