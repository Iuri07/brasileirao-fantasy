// Auth foundation: sessões em SQLite, cookies signed, mapeamento email→time.
//
// Não usa JWT — o cookie só carrega um session_id; o conteúdo (role, chave)
// fica no banco. Mais simples e seguro pra revogação.

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { getDb } from "./db.ts";

export type Role = "admin" | "user";

export interface SessionKV {
  role: Role;
  /** Chave do dono no time — só pra role="user" */
  chave?: string;
  /** Email autenticado (Google OAuth) — só pra role="user" */
  email?: string;
  /** Nome do usuário (do id_token Google) */
  name?: string;
  /** URL da foto de perfil (Google) */
  picture?: string;
  /** Unix ms */
  expiresAt: number;
}

const COOKIE_NAME = "bf_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

/** Gera um ID de sessão aleatório (32 bytes hex). */
function genSessionId(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

/** SHA-256 → hex. Usado pra hashear senhas. */
export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(buf));
}

export function getSession(sessionId: string): Promise<SessionKV | null> {
  const db = getDb();
  const r = db.prepare(
    "SELECT role, chave, email, name, picture, expires_at FROM sessions WHERE id=?",
  ).get<{
    role: Role;
    chave: string | null;
    email: string | null;
    name: string | null;
    picture: string | null;
    expires_at: number;
  }>(sessionId);
  if (!r) return Promise.resolve(null);
  if (r.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
    return Promise.resolve(null);
  }
  return Promise.resolve({
    role: r.role,
    chave: r.chave ?? undefined,
    email: r.email ?? undefined,
    name: r.name ?? undefined,
    picture: r.picture ?? undefined,
    expiresAt: r.expires_at,
  });
}

export function createSession(
  session: Omit<SessionKV, "expiresAt">,
): Promise<string> {
  const sessionId = genSessionId();
  const now = Date.now();
  const exp = now + SESSION_TTL_MS;
  getDb().prepare(
    "INSERT INTO sessions (id, role, chave, email, name, picture, created_at, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    sessionId,
    session.role,
    session.chave ?? null,
    session.email ?? null,
    session.name ?? null,
    session.picture ?? null,
    now,
    exp,
  );
  return Promise.resolve(sessionId);
}

export function deleteSession(sessionId: string): Promise<void> {
  getDb().prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
  return Promise.resolve();
}

/** Lê o sessionId do cookie da request. */
export function getSessionIdFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}

/** Constrói o Set-Cookie pra criar/refresh a sessão. */
export function buildSessionCookie(sessionId: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Set-Cookie que limpa a sessão. */
export function buildClearCookie(secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/* --- Email → chave de time --------------------------------------------- */

/** Lê o map email→chave mantido pelo admin. */
export function getEmailMap(): Promise<Record<string, string>> {
  const rows = getDb().prepare("SELECT email, chave FROM email_map")
    .all<{ email: string; chave: string }>();
  const out: Record<string, string> = {};
  for (const r of rows) out[r.email] = r.chave;
  return Promise.resolve(out);
}

export function setEmailMap(map: Record<string, string>): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM email_map").run();
    const ins = db.prepare(
      "INSERT INTO email_map (email, chave) VALUES (?, ?)",
    );
    for (const [email, chave] of Object.entries(map)) ins.run(email, chave);
  })();
  return Promise.resolve();
}

/** Atribui um email a um time (1:1). Joga erro se conflito. */
export function atribuirEmailATime(
  email: string,
  chave: string,
): Promise<void> {
  const normalizado = email.trim().toLowerCase();
  if (!normalizado) throw new Error("Email vazio");
  const db = getDb();
  const existente = db.prepare("SELECT chave FROM email_map WHERE email=?")
    .get<{ chave: string }>(normalizado);
  if (existente && existente.chave !== chave) {
    throw new Error(
      `Email ${normalizado} já está atribuído ao time ${existente.chave}`,
    );
  }
  db.transaction(() => {
    // 1:1 — remove qualquer email anterior atribuído a essa chave
    db.prepare("DELETE FROM email_map WHERE chave=? AND email != ?")
      .run(chave, normalizado);
    db.prepare(
      "INSERT INTO email_map (email, chave) VALUES (?, ?) " +
        "ON CONFLICT (email) DO UPDATE SET chave=excluded.chave",
    ).run(normalizado, chave);
  })();
  return Promise.resolve();
}

export function removerEmail(email: string): Promise<void> {
  getDb().prepare("DELETE FROM email_map WHERE email=?")
    .run(email.trim().toLowerCase());
  return Promise.resolve();
}

/** Resolve um email → chave. */
export function emailParaChave(email: string): Promise<string | null> {
  const r = getDb().prepare("SELECT chave FROM email_map WHERE email=?")
    .get<{ chave: string }>(email.trim().toLowerCase());
  return Promise.resolve(r?.chave ?? null);
}

/* --- Admin user via env ------------------------------------------------ */

export function getAdminCreds(): { user: string; pass: string } | null {
  const user = Deno.env.get("ADMIN_USER");
  const pass = Deno.env.get("ADMIN_PASS");
  if (!user || !pass) return null;
  return { user, pass };
}

export async function checkAdminCreds(
  user: string,
  pass: string,
): Promise<boolean> {
  const creds = getAdminCreds();
  if (!creds) return false;
  return user === creds.user && pass === creds.pass;
}

/* --- Google OAuth ------------------------------------------------------ */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

const OAUTH_STATE_TTL_MS = 1000 * 60 * 10; // 10 min

/** Random opaque token usado no CSRF protection do OAuth (state param). */
export function genOAuthState(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

/** Guarda o state em DB (com TTL curto). Independe de cookies. */
export function saveOAuthState(state: string, next: string): Promise<void> {
  getDb().prepare(
    "INSERT INTO oauth_state (state, next, exp) VALUES (?, ?, ?)",
  ).run(state, next, Date.now() + OAUTH_STATE_TTL_MS);
  return Promise.resolve();
}

export function consumeOAuthState(
  state: string,
): Promise<{ next: string } | null> {
  const db = getDb();
  const r = db.prepare("SELECT next, exp FROM oauth_state WHERE state=?")
    .get<{ next: string; exp: number }>(state);
  if (!r) return Promise.resolve(null);
  // Consume (single-use) + purge stale
  db.prepare("DELETE FROM oauth_state WHERE state=?").run(state);
  if (r.exp < Date.now()) return Promise.resolve(null);
  return Promise.resolve({ next: r.next });
}

/** Constrói a URL pra redirecionar ao consentimento do Google. */
export function buildGoogleAuthUrl(
  cfg: GoogleOAuthConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Troca o `code` recebido pelo Google por tokens. Retorna perfil do user. */
export async function exchangeGoogleCode(
  cfg: GoogleOAuthConfig,
  code: string,
): Promise<{ email: string; name?: string; picture?: string } | null> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("[google token] HTTP", r.status, txt);
    return null;
  }
  const data = await r.json() as { id_token?: string; access_token?: string };
  // Tenta decodificar o id_token (JWT) — payload base64url no meio
  if (data.id_token) {
    const payload = decodeJwtPayload(data.id_token);
    if (payload?.email) {
      return {
        email: String(payload.email).toLowerCase(),
        name: payload.name as string | undefined,
        picture: payload.picture as string | undefined,
      };
    }
  }
  // Fallback: chama userinfo endpoint
  if (data.access_token) {
    const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (u.ok) {
      const ui = await u.json() as {
        email?: string;
        name?: string;
        picture?: string;
      };
      if (ui.email) {
        return {
          email: ui.email.toLowerCase(),
          name: ui.name,
          picture: ui.picture,
        };
      }
    }
  }
  return null;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
    const json = atob(padded + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
