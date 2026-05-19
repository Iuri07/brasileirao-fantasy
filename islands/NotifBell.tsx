import { useEffect, useMemo, useRef, useState } from "preact/hooks";

interface Oferta {
  id: string;
  deChave: string;
  paraChave: string;
  /** Lista de atletas oferecidos (1-3). */
  atletasOferecidos?: number[];
  /** @deprecated Compat 1:1 */
  atletaOferecido?: number;
  atletaPedido: number;
  atletasExtra?: number[];
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
  nomesOferecidos: string[];
  posicoesOferecidas: string[];
  nomePedido: string | null;
  posicaoPedido: string | null;
}

/** Jogador resumido do elenco do usuário — pra escolher extras. */
interface JogadorResumo {
  atleta_id: number;
  apelido: string;
  posicao: string;
  clube: string;
}

type Props = Record<never, never>;

const TIPO_LABEL: Record<NotifPayload["tipo"], string> = {
  oferta_recebida: "Nova oferta",
  oferta_aceita: "Oferta aceita",
  oferta_negada: "Oferta negada",
};

const POS_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

export default function NotifBell(_props: Props) {
  const [notifs, setNotifs] = useState<NotifPayload[]>([]);
  const [open, setOpen] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [aceitando, setAceitando] = useState<{
    notif: NotifPayload;
    posExtras: string[];
  } | null>(null);
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

  async function responder(
    ofertaId: string,
    decisao: "aceita" | "negada",
    atletasExtra?: number[],
  ) {
    const r = await fetch(`/api/ofertas/${ofertaId}/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisao, atletas_extra: atletasExtra }),
    });
    if (r.ok) await carregar();
    return r.ok;
  }

  /** Resolve fluxo de aceitar: se N>1, abre modal com seleção de extras. */
  function iniciarAceite(n: NotifPayload) {
    const o = n.oferta;
    if (!o) return;
    const oferecidos = o.atletasOferecidos ??
      (o.atletaOferecido ? [o.atletaOferecido] : []);
    const N = oferecidos.length;
    if (N <= 1) {
      // 1:1, dispara direto
      void responder(o.id, "aceita");
      return;
    }
    // Calcula posições que destinatário precisa devolver: multiset oferecido
    // menos uma ocorrência da pos do pedido (já cobre o atletaPedido).
    const oferecidasOrd = [...n.posicoesOferecidas].sort();
    const idx = oferecidasOrd.indexOf(n.posicaoPedido ?? "");
    if (idx === -1) {
      alert("Erro: posição do pedido não está nos oferecidos.");
      return;
    }
    const posExtras = [...oferecidasOrd];
    posExtras.splice(idx, 1);
    setAceitando({ notif: n, posExtras });
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
                    onAceitar={iniciarAceite}
                    onNegar={async (id) => {
                      await responder(id, "negada");
                    }}
                    onLer={marcarLida}
                  />
                ))}
              </div>
            )}
        </div>
      )}
      {aceitando && (
        <ModalAceitarMulti
          notif={aceitando.notif}
          posExtras={aceitando.posExtras}
          minhaChave={aceitando.notif.chave}
          onClose={() => setAceitando(null)}
          onConfirmar={async (atletasExtra) => {
            const ok = await responder(
              aceitando.notif.oferta!.id,
              "aceita",
              atletasExtra,
            );
            if (ok) setAceitando(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

function NotifItem(
  { n, onAceitar, onNegar, onLer }: {
    n: NotifPayload;
    onAceitar: (n: NotifPayload) => void;
    onNegar: (ofertaId: string) => Promise<void>;
    onLer: (id: string) => Promise<void>;
  },
) {
  const [agindo, setAgindo] = useState(false);
  const o = n.oferta;
  const nomesOferecidos = n.nomesOferecidos.length
    ? n.nomesOferecidos
    : ["?"];
  const nomePedido = n.nomePedido ?? (o ? `#${o.atletaPedido}` : "?");
  const N = nomesOferecidos.length;

  return (
    <div class={`bf-notif__item ${n.lida ? "" : "bf-notif__item--nova"}`}>
      <div class="bf-notif__tipo">{TIPO_LABEL[n.tipo]}</div>
      {o && (
        <div class="bf-notif__desc">
          {n.tipo === "oferta_recebida"
            ? (
              <>
                Recebeu{" "}
                <strong>
                  {nomesOferecidos.join(N === 2 ? " e " : ", ")}
                </strong>
                {N > 1 && " (oferta múltipla)"} em troca de{" "}
                <strong>{nomePedido}</strong>
                {N > 1 && (
                  <>
                    {" "}
                    + {N - 1} do seu elenco
                  </>
                )}
              </>
            )
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
              await onNegar(o.id);
              setAgindo(false);
            }}
            disabled={agindo}
          >
            Negar
          </button>
          <button
            type="button"
            class="bf-notif__btn bf-notif__btn--aceitar"
            onClick={() => onAceitar(n)}
            disabled={agindo}
          >
            {N > 1 ? `Aceitar (${N})…` : "Aceitar"}
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

/** Modal pra escolher atletas extras quando oferta tem N>1 oferecidos.
 *  Mostra meu elenco filtrado pelas posições que faltam pra fechar o
 *  multiset, com seleção 1-a-1 por posição. */
function ModalAceitarMulti(
  { notif, posExtras, minhaChave, onClose, onConfirmar }: {
    notif: NotifPayload;
    posExtras: string[]; // posições necessárias (ex: ["Atacante", "Meia"])
    minhaChave: string;
    onClose: () => void;
    onConfirmar: (atletasExtra: number[]) => Promise<boolean>;
  },
) {
  const [elenco, setElenco] = useState<JogadorResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selPorPos, setSelPorPos] = useState<Record<number, number>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/elenco/${minhaChave}`);
        const d = await r.json();
        if (cancel) return;
        // Endpoint retorna o ElencoKV direto (sem envelope { ok, elenco })
        if (!d || !d.jogadores) {
          setErro("Falha ao carregar elenco");
        } else {
          const jogs: JogadorResumo[] = Object.values(
            d.jogadores as Record<string, {
              atleta_id: number;
              apelido_api: string;
              posicao: string;
              clube: string;
            }>,
          ).map((j) => ({
            atleta_id: j.atleta_id,
            apelido: j.apelido_api,
            posicao: j.posicao,
            clube: j.clube,
          }));
          setElenco(jogs);
        }
      } catch (e) {
        if (!cancel) setErro(String(e));
      } finally {
        if (!cancel) setCarregando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [minhaChave]);

  // Agrupa posições requeridas: ex: ["Atacante","Atacante","Meia"] →
  // { "Atacante": 2, "Meia": 1 }. Cada slot vira um seletor.
  const slots = useMemo(() => {
    const arr: { idx: number; posicao: string }[] = [];
    posExtras.forEach((p, i) => arr.push({ idx: i, posicao: p }));
    return arr;
  }, [posExtras]);

  // Atleta_id do pedido — não pode ser selecionado como extra
  const atletaPedidoId = notif.oferta?.atletaPedido;

  function pickFor(slotIdx: number, atletaId: number) {
    setSelPorPos((cur) => {
      // Se o atleta já está em outro slot, remove dele primeiro
      const next: Record<number, number> = {};
      for (const [k, v] of Object.entries(cur)) {
        if (v !== atletaId) next[Number(k)] = v;
      }
      next[slotIdx] = atletaId;
      return next;
    });
  }

  function clearFor(slotIdx: number) {
    setSelPorPos((cur) => {
      const next = { ...cur };
      delete next[slotIdx];
      return next;
    });
  }

  const todosPreenchidos = slots.every((s) => selPorPos[s.idx]);
  const atletasExtra = slots.map((s) => selPorPos[s.idx]).filter(Boolean);

  async function confirmar() {
    if (!todosPreenchidos) return;
    setEnviando(true);
    setErro(null);
    const ok = await onConfirmar(atletasExtra);
    setEnviando(false);
    if (!ok) setErro("Falha ao enviar resposta");
  }

  return (
    <div class="bf-modal" onClick={onClose}>
      <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="bf-modal__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
        <h3 class="bf-modal__titulo">Completar a troca</h3>
        <p class="bf-modal__txt">
          Você está aceitando <strong>{notif.nomePedido}</strong>{" "}
          como contrapartida principal. Escolha mais{" "}
          <strong>{posExtras.length}</strong>{" "}
          jogador(es) do seu elenco pra completar (1 por posição requerida):
        </p>
        {carregando && (
          <div class="bf-notif__vazio">Carregando elenco…</div>
        )}
        {!carregando && elenco.length > 0 && (
          <div class="bf-notif__slots">
            {slots.map((s) => {
              const escolhidos = Object.values(selPorPos);
              const disponiveis = elenco.filter((j) =>
                j.posicao === s.posicao &&
                j.atleta_id !== atletaPedidoId &&
                (!escolhidos.includes(j.atleta_id) ||
                  selPorPos[s.idx] === j.atleta_id)
              );
              const escolhido = selPorPos[s.idx];
              return (
                <div key={s.idx} class="bf-notif__slot">
                  <div class="bf-notif__slot-head">
                    Slot {s.idx + 1} · {POS_ABREV[s.posicao] ?? s.posicao}
                  </div>
                  {disponiveis.length === 0
                    ? (
                      <div class="bf-notif__slot-vazio">
                        Sem {POS_ABREV[s.posicao] ?? s.posicao} disponíveis
                      </div>
                    )
                    : (
                      <select
                        class="bf-notif__slot-select"
                        value={escolhido ?? ""}
                        onChange={(e) => {
                          const v = Number(
                            (e.target as HTMLSelectElement).value,
                          );
                          if (v) pickFor(s.idx, v);
                          else clearFor(s.idx);
                        }}
                      >
                        <option value="">— escolher —</option>
                        {disponiveis.map((j) => (
                          <option key={j.atleta_id} value={j.atleta_id}>
                            {j.apelido} ({j.clube})
                          </option>
                        ))}
                      </select>
                    )}
                </div>
              );
            })}
          </div>
        )}
        {erro && <div class="bf-modal__erro">{erro}</div>}
        <div class="bf-modal__acoes">
          <button
            type="button"
            class="bf-modal__btn"
            onClick={onClose}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="button"
            class="bf-modal__btn bf-modal__btn--ok"
            onClick={confirmar}
            disabled={!todosPreenchidos || enviando}
          >
            {enviando ? "Confirmando…" : "Confirmar troca"}
          </button>
        </div>
      </div>
    </div>
  );
}
