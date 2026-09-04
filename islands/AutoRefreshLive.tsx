// Recarrega a página automaticamente enquanto a rodada está ao vivo.
// Home e /liga são SSR — sem essa island o usuário ficaria vendo os
// pontos travados até dar refresh manual. Usa /api/live/mercado/status
// (proxy cacheado 30s) pra saber se bola tá rolando.
//
// Pausa quando a aba está escondida (visibilitychange) — economiza
// requests em background.

import { useEffect } from "preact/hooks";

const POLL_STATUS_MS = 30_000;
const REFRESH_MS = 60_000;

export default function AutoRefreshLive() {
  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | null = null;
    let statusTimer: number | null = null;

    async function checkAndSchedule() {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/live/mercado/status");
        if (!r.ok) return;
        const data = await r.json() as { bola_rolando?: boolean };
        if (cancelled) return;
        if (data.bola_rolando && refreshTimer == null) {
          // Bola rolando: agenda reload
          refreshTimer = window.setTimeout(() => {
            if (!document.hidden) location.reload();
          }, REFRESH_MS);
        } else if (!data.bola_rolando && refreshTimer != null) {
          window.clearTimeout(refreshTimer);
          refreshTimer = null;
        }
      } catch {
        // Silent — próximo tick tenta de novo
      }
    }

    // Kick off
    checkAndSchedule();
    statusTimer = window.setInterval(checkAndSchedule, POLL_STATUS_MS);

    // Ao voltar da aba, checa imediatamente
    const onVisibility = () => {
      if (!document.hidden) checkAndSchedule();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      if (statusTimer != null) window.clearInterval(statusTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
