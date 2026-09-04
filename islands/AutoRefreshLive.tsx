// Recarrega a página automaticamente enquanto a rodada está ao vivo.
// Home e /liga são SSR — sem essa island o usuário ficaria vendo os
// pontos travados até dar refresh manual.
//
// Estratégia (rewrite):
//   - Poll /api/live/mercado/status a cada 30s, guarda flag `live`
//   - setInterval separado a cada 60s: se `live` && !document.hidden,
//     dá location.reload()
//   - Não usa setTimeout aninhado (versão anterior tinha bug: timer
//     expirado ficava non-null e novos ciclos não re-agendavam)

import { useEffect } from "preact/hooks";

const POLL_STATUS_MS = 30_000;
const REFRESH_MS = 60_000;

export default function AutoRefreshLive() {
  useEffect(() => {
    let cancelled = false;
    let live = false;

    async function checkStatus() {
      if (cancelled || document.hidden) return;
      try {
        const r = await fetch("/api/live/mercado/status");
        if (!r.ok) return;
        const data = await r.json() as { bola_rolando?: boolean };
        live = !!data.bola_rolando;
      } catch { /* silent */ }
    }

    // Kick off imediato + poll
    checkStatus();
    const statusInterval = window.setInterval(checkStatus, POLL_STATUS_MS);

    // Reload periódico
    const reloadInterval = window.setInterval(() => {
      if (live && !document.hidden) location.reload();
    }, REFRESH_MS);

    // Ao voltar da aba, checa status na hora
    const onVisibility = () => {
      if (!document.hidden) checkStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(statusInterval);
      window.clearInterval(reloadInterval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
