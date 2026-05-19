import { Handlers } from "$fresh/server.ts";
import {
  buildSessionCookie,
  checkAdminCreds,
  createSession,
} from "../../../lib/auth.ts";

export const handler: Handlers = {
  async POST(req) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return redirectLogin("/", "JSON/form inválido");
    }
    const user = String(form.get("user") ?? "").trim();
    const pass = String(form.get("pass") ?? "");
    const next = String(form.get("next") ?? "/") || "/";

    // Por enquanto, login user+pass aceita só admin via env.
    // Usuários comuns entram via Google OAuth (Fase 2).
    if (!(await checkAdminCreds(user, pass))) {
      return redirectLogin(next, "Usuário ou senha inválidos");
    }

    const sessionId = await createSession({ role: "admin" });
    const secure = new URL(req.url).protocol === "https:";
    return new Response(null, {
      status: 302,
      headers: {
        Location: next,
        "Set-Cookie": buildSessionCookie(sessionId, secure),
      },
    });
  },
};

function redirectLogin(next: string, erro: string): Response {
  const params = new URLSearchParams({ next, erro });
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?${params}` },
  });
}
