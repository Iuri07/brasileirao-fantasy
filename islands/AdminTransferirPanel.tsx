import { useState } from "preact/hooks";

interface Jogador {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
  escalacao: "Sim" | "Banco" | "Não" | "IR";
}

interface TimeDestino {
  chave: string;
  displayName: string;
}

interface Props {
  /** Time atual (origem/destino). */
  fromChave: string;
  /** Jogadores do time atual — lista completa do elenco. */
  jogadores: Jogador[];
  /** Outros times da liga (sem o atual). */
  outrosTimes: TimeDestino[];
}

const POS_ABREV: Record<string, string> = {
  Goleiro: "GOL",
  Lateral: "LAT",
  Zagueiro: "ZAG",
  Meia: "MEI",
  Atacante: "ATK",
  Técnico: "TEC",
};

interface AtletaMercadoLite {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
}

export default function AdminTransferirPanel(
  { fromChave, jogadores, outrosTimes }: Props,
) {
  // Tab: "sair" = mandar jogador daqui pra outro time/mercado.
  //      "puxar" = trazer free agent do mercado pro time atual.
  const [tab, setTab] = useState<"sair" | "puxar">("sair");

  const [selecionado, setSelecionado] = useState<Jogador | null>(null);
  // "" = nenhum; "MERCADO" = pro mercado; senão chave do time destino.
  const [destino, setDestino] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Puxar do mercado: busca livre.
  const [buscaMercado, setBuscaMercado] = useState("");
  const [resultadosMercado, setResultadosMercado] = useState<AtletaMercadoLite[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [atletaMercadoSel, setAtletaMercadoSel] = useState<AtletaMercadoLite | null>(null);

  function abrirModal(j: Jogador) {
    setSelecionado(j);
    setDestino("");
    setErro(null);
  }

  function fechar() {
    setSelecionado(null);
    setDestino("");
    setErro(null);
    setEnviando(false);
    setAtletaMercadoSel(null);
  }

  async function confirmarSair() {
    if (!selecionado || !destino) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/admin/transferir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atleta_id: selecionado.atleta_id,
          from_chave: fromChave,
          // destino "MERCADO" = to_chave null (vai pro pool de free agents)
          to_chave: destino === "MERCADO" ? null : destino,
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErro(d.erro ?? "Erro desconhecido");
        setEnviando(false);
        return;
      }
      location.reload();
    } catch (e) {
      setErro(String(e));
      setEnviando(false);
    }
  }

  async function confirmarPuxar() {
    if (!atletaMercadoSel) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/admin/transferir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atleta_id: atletaMercadoSel.atleta_id,
          from_chave: null,
          to_chave: fromChave,
          escalacao_destino: "Banco",
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErro(d.erro ?? "Erro desconhecido");
        setEnviando(false);
        return;
      }
      location.reload();
    } catch (e) {
      setErro(String(e));
      setEnviando(false);
    }
  }

  async function buscarMercado(q: string) {
    setBuscaMercado(q);
    if (q.trim().length < 2) {
      setResultadosMercado([]);
      return;
    }
    setBuscando(true);
    try {
      const r = await fetch(`/api/mercado/buscar?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.ok && Array.isArray(d.atletas)) {
        setResultadosMercado(d.atletas.slice(0, 20));
      }
    } catch { /* silent */ } finally {
      setBuscando(false);
    }
  }

  // Ordena por posição → escalacao → apelido
  const ordemPos: Record<string, number> = {
    Goleiro: 0,
    Lateral: 1,
    Zagueiro: 2,
    Meia: 3,
    Atacante: 4,
    Técnico: 5,
  };
  const ordemEsc: Record<string, number> = {
    Sim: 0,
    Banco: 1,
    "Não": 2,
    IR: 3,
  };
  // Estado local pra refletir mudanças de escalação sem reload
  const [jogadoresLocal, setJogadoresLocal] = useState(jogadores);

  async function mudarEscalacao(
    atleta_id: number,
    novaEscalacao: "Sim" | "Banco" | "Não" | "IR",
  ) {
    const anterior = jogadoresLocal.find((j) => j.atleta_id === atleta_id);
    if (!anterior || anterior.escalacao === novaEscalacao) return;
    // Optimistic update
    setJogadoresLocal((arr) =>
      arr.map((j) =>
        j.atleta_id === atleta_id ? { ...j, escalacao: novaEscalacao } : j
      )
    );
    try {
      const r = await fetch(`/api/elenco/${fromChave}/escalacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atleta_id, escalacao: novaEscalacao }),
      });
      const d = await r.json();
      if (!d.ok) {
        // Reverte se der erro
        setJogadoresLocal((arr) =>
          arr.map((j) =>
            j.atleta_id === atleta_id
              ? { ...j, escalacao: anterior.escalacao }
              : j
          )
        );
        alert(d.erro ?? "Erro ao mudar escalação");
      }
    } catch (e) {
      setJogadoresLocal((arr) =>
        arr.map((j) =>
          j.atleta_id === atleta_id
            ? { ...j, escalacao: anterior.escalacao }
            : j
        )
      );
      alert(String(e));
    }
  }

  const CATEGORIAS: Array<{
    valor: "Sim" | "Banco" | "Não" | "IR";
    label: string;
    cls: string;
  }> = [
    { valor: "Sim", label: "SIM", cls: "sim" },
    { valor: "Banco", label: "BANCO", cls: "banco" },
    { valor: "Não", label: "NÃO", cls: "nao" },
    { valor: "IR", label: "IR", cls: "ir" },
  ];

  const sorted = [...jogadoresLocal].sort((a, b) =>
    (ordemPos[a.posicao] ?? 9) - (ordemPos[b.posicao] ?? 9) ||
    (ordemEsc[a.escalacao] ?? 9) - (ordemEsc[b.escalacao] ?? 9) ||
    a.apelido.localeCompare(b.apelido, "pt-BR")
  );

  return (
    <div class="bf-admin-transferir">
      <div class="bf-admin-transferir__tabs">
        <button
          type="button"
          class={`bf-btn ${tab === "sair" ? "" : "bf-btn--ghost"}`}
          onClick={() => setTab("sair")}
        >
          Mandar jogador
        </button>
        <button
          type="button"
          class={`bf-btn ${tab === "puxar" ? "" : "bf-btn--ghost"}`}
          onClick={() => setTab("puxar")}
        >
          Puxar do mercado
        </button>
      </div>

      {tab === "sair"
        ? (
          <>
            <p class="bf-status-card__sub" style="margin:6px 0 10px">
              Transfere um jogador deste elenco pra outro time — ou pro
              mercado (free agent). Bypass do fluxo de ofertas.
            </p>
            <div class="bf-admin-transferir__list">
              {sorted.map((j) => (
                <div class="bf-admin-transferir__row" key={j.atleta_id}>
                  <span class="bf-admin-transferir__pos">
                    {POS_ABREV[j.posicao] ?? "?"}
                  </span>
                  <span class="bf-admin-transferir__name">{j.apelido}</span>
                  <span class="bf-admin-transferir__clube">{j.clube}</span>
                  <div class="bf-admin-transferir__esc-group">
                    {CATEGORIAS.map((c) => (
                      <button
                        key={c.valor}
                        type="button"
                        class={`bf-admin-transferir__esc bf-admin-transferir__esc--${c.cls} ${
                          j.escalacao === c.valor
                            ? "bf-admin-transferir__esc--ativa"
                            : ""
                        }`}
                        onClick={() => mudarEscalacao(j.atleta_id, c.valor)}
                        aria-pressed={j.escalacao === c.valor}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    class="bf-btn bf-btn--ghost"
                    style="height:28px;font-size:10px;padding:0 10px"
                    onClick={() => abrirModal(j)}
                  >
                    transferir →
                  </button>
                </div>
              ))}
            </div>
          </>
        )
        : (
          <>
            <p class="bf-status-card__sub" style="margin:6px 0 10px">
              Puxa um free agent do mercado direto pro elenco deste time
              (fica no banco). Bypass do fluxo de interesses/draft.
            </p>
            <input
              type="text"
              placeholder="Buscar atleta no mercado…"
              value={buscaMercado}
              onInput={(e) =>
                buscarMercado((e.target as HTMLInputElement).value)}
              style="width:100%;padding:10px;background:var(--bf-ink-2);color:var(--bf-fg-0);border:1px solid var(--bf-line);border-radius:var(--bf-radius-md);font-family:var(--bf-font-cond);font-size:14px;margin-bottom:12px"
            />
            {buscando && (
              <p class="bf-status-card__sub" style="margin:0 0 10px">
                Buscando…
              </p>
            )}
            <div class="bf-admin-transferir__list">
              {resultadosMercado.map((a) => (
                <div class="bf-admin-transferir__row" key={a.atleta_id}>
                  <span class="bf-admin-transferir__pos">
                    {POS_ABREV[a.posicao] ?? "?"}
                  </span>
                  <span class="bf-admin-transferir__name">{a.apelido}</span>
                  <span class="bf-admin-transferir__clube">{a.clube}</span>
                  <span class="bf-admin-transferir__esc">MERCADO</span>
                  <button
                    type="button"
                    class="bf-btn bf-btn--ghost"
                    style="height:28px;font-size:10px;padding:0 10px"
                    onClick={() => {
                      setAtletaMercadoSel(a);
                      setErro(null);
                    }}
                  >
                    puxar →
                  </button>
                </div>
              ))}
              {!buscando && buscaMercado.length >= 2 &&
                resultadosMercado.length === 0 && (
                <p class="bf-status-card__sub" style="margin:0">
                  Nenhum atleta encontrado. Só aparecem free agents (não estão
                  em nenhum elenco).
                </p>
              )}
            </div>
          </>
        )}

      {/* Modal — mandar jogador (sair) */}
      {selecionado && (
        <div
          class="bf-admin-transferir__overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) fechar();
          }}
        >
          <div class="bf-admin-transferir__modal">
            <h3 style="margin:0 0 4px;font-family:var(--bf-font-cond);font-weight:900;font-size:16px">
              Transferir {selecionado.apelido}
            </h3>
            <p
              class="bf-status-card__sub"
              style="margin:0 0 16px;font-size:12px"
            >
              {selecionado.clube} · {selecionado.posicao} ·{" "}
              {selecionado.escalacao}
            </p>

            <label style="display:block;margin-bottom:6px;font-family:var(--bf-font-cond);font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--bf-fg-2)">
              Destino
            </label>
            <select
              value={destino}
              onChange={(e) =>
                setDestino((e.target as HTMLSelectElement).value)}
              style="width:100%;padding:10px;background:var(--bf-ink-2);color:var(--bf-fg-1);border:1px solid var(--bf-line);border-radius:var(--bf-radius-md);font-family:var(--bf-font-cond);font-size:14px;margin-bottom:14px"
            >
              <option value="">— selecione —</option>
              <option value="MERCADO">Mercado (free agent)</option>
              {outrosTimes.map((t) => (
                <option key={t.chave} value={t.chave}>{t.displayName}</option>
              ))}
            </select>

            {erro && (
              <p
                style="margin:0 0 12px;font-size:12px;color:var(--bf-red)"
                role="alert"
              >
                {erro}
              </p>
            )}

            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button
                type="button"
                class="bf-btn bf-btn--ghost"
                style="height:36px"
                onClick={fechar}
                disabled={enviando}
              >
                cancelar
              </button>
              <button
                type="button"
                class="bf-btn"
                style="height:36px"
                onClick={confirmarSair}
                disabled={!destino || enviando}
              >
                {enviando ? "..." : "transferir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — puxar do mercado */}
      {atletaMercadoSel && (
        <div
          class="bf-admin-transferir__overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) fechar();
          }}
        >
          <div class="bf-admin-transferir__modal">
            <h3 style="margin:0 0 4px;font-family:var(--bf-font-cond);font-weight:900;font-size:16px">
              Puxar {atletaMercadoSel.apelido}
            </h3>
            <p
              class="bf-status-card__sub"
              style="margin:0 0 16px;font-size:12px"
            >
              {atletaMercadoSel.clube} · {atletaMercadoSel.posicao} →{" "}
              elenco {fromChave} (banco)
            </p>

            {erro && (
              <p
                style="margin:0 0 12px;font-size:12px;color:var(--bf-red)"
                role="alert"
              >
                {erro}
              </p>
            )}

            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button
                type="button"
                class="bf-btn bf-btn--ghost"
                style="height:36px"
                onClick={fechar}
                disabled={enviando}
              >
                cancelar
              </button>
              <button
                type="button"
                class="bf-btn"
                style="height:36px"
                onClick={confirmarPuxar}
                disabled={enviando}
              >
                {enviando ? "..." : "puxar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
