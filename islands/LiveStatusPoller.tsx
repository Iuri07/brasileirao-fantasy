import { useEffect } from "preact/hooks";

// Pequena island que polla /api/live/mercado/status (proxy cacheado 30s)
// e adiciona/remove classe global `bf-live-active` no <body>.
// CSS reage destacando o item "Ao Vivo" do BottomNav.

const POLL_MS = 30_000;

export default function LiveStatusPoller() {
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch("/api/live/mercado/status");
        if (!r.ok) return;
        const data = await r.json() as { bola_rolando?: boolean };
        if (cancelled) return;
        document.body.classList.toggle(
          "bf-live-active",
          !!data.bola_rolando,
        );
      } catch {
        // Silent fail — não muda estado anterior
      }
    }
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return null;
}
