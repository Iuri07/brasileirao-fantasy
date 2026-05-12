// Auth foundation: sessões em KV, cookies signed, mapeamento email→time.
//
// Não usa JWT — o cookie só carrega um session_id; o conteúdo (role, chave)
// fica no KV. Mais simples e seguro pra revogação.

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

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

export async function getSession(
  kv: Deno.Kv,
  sessionId: string,
): Promise<SessionKV | null> {
  const r = await kv.get<SessionKV>(["session", sessionId]);
  if (!r.value) return null;
  if (r.value.expiresAt < Date.now()) {
    await kv.delete(["session", sessionId]);
    return null;
  }
  return r.value;
}

export async function createSession(
  kv: Deno.Kv,
  session: Omit<SessionKV, "expiresAt">,
): Promise<string> {
  const sessionId = genSessionId();
  const full: SessionKV = { ...session, expiresAt: Date.now() + SESSION_TTL_MS };
  await kv.set(["session", sessionId], full, { expireIn: SESSION_TTL_MS });
  return sessionId;
}

export async function deleteSession(kv: Deno.Kv, sessionId: string) {
  await kv.delete(["session", sessionId]);
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
export async function getEmailMap(
  kv: Deno.Kv,
): Promise<Record<string, string>> {
  const r = await kv.get<Record<string, string>>(["auth", "email_map"]);
  return r.value ?? {};
}

export async function setEmailMap(
  kv: Deno.Kv,
  map: Record<string, string>,
): Promise<void> {
  await kv.set(["auth", "email_map"], map);
}

/** Atribui um email a um time (1:1). Joga erro se conflito. */
export async function atribuirEmailATime(
  kv: Deno.Kv,
  email: string,
  chave: string,
): Promise<void> {
  const normalizado = email.trim().toLowerCase();
  if (!normalizado) throw new Error("Email vazio");
  const map = await getEmailMap(kv);
  // Remove qualquer email anterior atribuído a essa chave
  for (const [e, c] of Object.entries(map)) {
    if (c === chave && e !== normalizado) delete map[e];
  }
  // Email já está em outra chave?
  const chaveAtual = map[normalizado];
  if (chaveAtual && chaveAtual !== chave) {
    throw new Error(
      `Email ${normalizado} já está atribuído ao time ${chaveAtual}`,
    );
  }
  map[normalizado] = chave;
  await setEmailMap(kv, map);
}

export async function removerEmail(kv: Deno.Kv, email: string): Promise<void> {
  const map = await getEmailMap(kv);
  delete map[email.trim().toLowerCase()];
  await setEmailMap(kv, map);
}

/** Resolve um email → chave (consulta o map). */
export async function emailParaChave(
  kv: Deno.Kv,
  email: string,
): Promise<string | null> {
  const map = await getEmailMap(kv);
  return map[email.trim().toLowerCase()] ?? null;
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

/** Guarda o state em KV (com TTL curto). Independe de cookies — funciona
    mesmo quando o usuário muda de host entre start e callback (ex: LAN
    IP → localhost via redirect URI). */
export async function saveOAuthState(
  kv: Deno.Kv,
  state: string,
  next: string,
): Promise<void> {
  await kv.set(["oauth_state", state], { next, exp: Date.now() + OAUTH_STATE_TTL_MS }, {
    expireIn: OAUTH_STATE_TTL_MS,
  });
}

export async function consumeOAuthState(
  kv: Deno.Kv,
  state: string,
): Promise<{ next: string } | null> {
  const r = await kv.get<{ next: string; exp: number }>(["oauth_state", state]);
  if (!r.value) return null;
  // Consume (single-use)
  await kv.delete(["oauth_state", state]);
  if (r.value.exp < Date.now()) return null;
  return { next: r.value.next };
}

/** Constrói a URL pra redirecionar ao consentimento do Google. */
export function buildGoogleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
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
