import { Handlers } from "$fresh/server.ts";
import {
  buildSessionCookie,
  consumeOAuthState,
  createSession,
  emailParaChave,
  exchangeGoogleCode,
  getGoogleOAuthConfig,
} from "../../../../lib/auth.ts";

export const handler: Handlers = {
  async GET(req) {
    const url = new URL(req.url);
    const secure = url.protocol === "https:";
    const code = url.searchParams.get("code");
    const stateFromUrl = url.searchParams.get("state");
    const err = url.searchParams.get("error");

    const kv = await Deno.openKv();
    const stateRecord = stateFromUrl
      ? await consumeOAuthState(kv, stateFromUrl)
      : null;
    const next = stateRecord?.next ?? "/";

    function fail(msg: string): Response {
      console.error("[oauth callback] FAIL:", msg);
      const params = new URLSearchParams({ next, erro: msg });
      return new Response(null, {
        status: 302,
        headers: { Location: `/login?${params}` },
      });
    }

    console.log("[oauth callback]", {
      hasCode: !!code,
      hasState: !!stateFromUrl,
      stateOk: !!stateRecord,
      error: err,
      next,
    });

    if (err) return fail(`Google retornou erro: ${err}`);
    if (!code) return fail("Sem code do Google");
    if (!stateRecord) {
      return fail("State inválido ou expirado");
    }

    const cfg = getGoogleOAuthConfig();
    if (!cfg) return fail("Google OAuth não configurado");

    let user;
    try {
      user = await exchangeGoogleCode(cfg, code);
    } catch (e) {
      return fail(`Erro no token exchange: ${(e as Error).message ?? e}`);
    }
    if (!user) return fail("Falha ao trocar code por token (resposta vazia)");

    const chave = await emailParaChave(kv, user.email);
    if (!chave) {
      return fail(
        `${user.email} não está atribuído a nenhum time. Peça ao admin.`,
      );
    }

    const sessionId = await createSession(kv, {
      role: "user",
      chave,
      email: user.email,
      name: user.name,
      picture: user.picture,
    });
    console.log("[oauth callback] OK", { email: user.email, chave });
    return new Response(null, {
      status: 302,
      headers: {
        Location: next || "/",
        "Set-Cookie": buildSessionCookie(sessionId, secure),
      },
    });
  },
};
