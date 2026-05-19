import { Handlers } from "$fresh/server.ts";
import {
  buildGoogleAuthUrl,
  genOAuthState,
  getGoogleOAuthConfig,
  saveOAuthState,
} from "../../../../lib/auth.ts";

export const handler: Handlers = {
  async GET(req) {
    const cfg = getGoogleOAuthConfig();
    if (!cfg) {
      const params = new URLSearchParams({
        erro:
          "Google OAuth não configurado (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI)",
        next: "/",
      });
      return new Response(null, {
        status: 302,
        headers: { Location: `/login?${params}` },
      });
    }
    const url = new URL(req.url);
    const next = url.searchParams.get("next") ?? "/";
    const state = genOAuthState();
    await saveOAuthState(state, next);
    return new Response(null, {
      status: 302,
      headers: { Location: buildGoogleAuthUrl(cfg, state) },
    });
  },
};
