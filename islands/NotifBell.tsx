import { useEffect, useRef, useState } from "preact/hooks";

interface Oferta {
  id: string;
  deChave: string;
  paraChave: string;
  atletaOferecido: number;
  atletaPedido: number;
  status: "pendente" | "aceita" | "negada" | "cancelada";
  criadoEm: number;
  respondidoEm?: number;
}

interface NotifPayload {
  id: string;
  chave: string;
  tipo: "oferta_recebida" | "oferta_aceita" | "oferta_negada";
  ofertaId: string;
  lida: boolean;
  criadoEm: number;
  oferta: Oferta | null;
  nomeOferecido: string | null;
  nomePedido: string | null;
}

// Sem props extras — o backend já enriquece com nomes
type Props = Record<never, never>;

const TIPO_LABEL: Record<NotifPayload["tipo"], string> = {
  oferta_recebida: "Nova oferta",
  oferta_aceita: "Oferta aceita",
  oferta_negada: "Oferta negada",
};

export default function NotifBell(_props: Props) {
  const [notifs, setNotifs] = useState<NotifPayload[]>([]);
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/notificacoes");
      const d = await r.json();
      if (d.ok) setNotifs(d.notifs ?? []);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    const id = setInterval(carregar, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function responder(ofertaId: string, decisao: "aceita" | "negada") {
    const r = await fetch(`/api/ofertas/${ofertaId}/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisao }),
    });
    if (r.ok) await carregar();
  }

  async function marcarLida(id: string) {
    await fetch("/api/notificacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifs((arr) => arr.map((n) => n.id === id ? { ...n, lida: true } : n));
  }

  const naoLidas = notifs.filter((n) => !n.lida).length;

  return (
    <div class="bf-notif" ref={ref}>
      <button
        type="button"
        class={`bf-iconbtn ${naoLidas > 0 ? "bf-iconbtn--alert" : ""}`}
        aria-label="Notificações"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {naoLidas > 0 && <span class="bf-notif__count">{naoLidas}</span>}
      </button>
      {open && (
        <div class="bf-notif__pop">
          <div class="bf-notif__head">
            Notificações {carregando && <span>…</span>}
          </div>
          {notifs.length === 0
            ? <div class="bf-notif__vazio">Nenhuma notificação</div>
            : (
              <div class="bf-notif__lista">
                {notifs.map((n) => (
                  <NotifItem
                    key={n.id}
                    n={n}
                    onResponder={responder}
                    onLer={marcarLida}
                  />
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function NotifItem(
  { n, onResponder, onLer }: {
    n: NotifPayload;
    onResponder: (id: string, decisao: "aceita" | "negada") => Promise<void>;
    onLer: (id: string) => Promise<void>;
  },
) {
  const [agindo, setAgindo] = useState(false);
  const o = n.oferta;
  const nomeOferecido = n.nomeOferecido ??
    (o ? `#${o.atletaOferecido}` : "?");
  const nomePedido = n.nomePedido ?? (o ? `#${o.atletaPedido}` : "?");
  return (
    <div class={`bf-notif__item ${n.lida ? "" : "bf-notif__item--nova"}`}>
      <div class="bf-notif__tipo">{TIPO_LABEL[n.tipo]}</div>
      {o && (
        <div class="bf-notif__desc">
          {n.tipo === "oferta_recebida"
            ? <>Recebeu <strong>{nomeOferecido}</strong> em troca de <strong>{nomePedido}</strong></>
            : n.tipo === "oferta_aceita"
            ? <>Sua oferta por <strong>{nomePedido}</strong> foi aceita</>
            : <>Sua oferta por <strong>{nomePedido}</strong> foi negada</>}
        </div>
      )}
      {n.tipo === "oferta_recebida" && o?.status === "pendente" && (
        <div class="bf-notif__acoes">
          <button
            type="button"
            class="bf-notif__btn bf-notif__btn--negar"
            onClick={async () => {
              setAgindo(true);
              await onResponder(o.id, "negada");
              setAgindo(false);
            }}
            disabled={agindo}
          >
            Negar
          </button>
          <button
            type="button"
            class="bf-notif__btn bf-notif__btn--aceitar"
            onClick={async () => {
              setAgindo(true);
              await onResponder(o.id, "aceita");
              setAgindo(false);
            }}
            disabled={agindo}
          >
            Aceitar
          </button>
        </div>
      )}
      {!n.lida && (
        <button
          type="button"
          class="bf-notif__lida"
          onClick={() => onLer(n.id)}
          aria-label="Marcar como lida"
        >
          marcar como lida
        </button>
      )}
    </div>
  );
}
