import { useState } from "preact/hooks";

interface Jogador {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
  escalacao: "Sim" | "Banco" | "Não";
}

interface TimeDestino {
  chave: string;
  displayName: string;
}

interface Props {
  /** Time atual (origem). */
  fromChave: string;
  /** Jogadores do time atual — lista completa do elenco. */
  jogadores: Jogador[];
  /** Outros times da liga (sem o atual). */
  outrosTimes: TimeDestino[];
}

export default function AdminTransferirPanel(
  { fromChave, jogadores, outrosTimes }: Props,
) {
  const [selecionado, setSelecionado] = useState<Jogador | null>(null);
  const [destino, setDestino] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
  }

  async function confirmar() {
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
          to_chave: destino,
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErro(d.erro ?? "Erro desconhecido");
        setEnviando(false);
        return;
      }
      // Reload pra refletir o elenco novo
      location.reload();
    } catch (e) {
      setErro(String(e));
      setEnviando(false);
    }
  }

  // Ordena por posição → escalacao → apelido pra busca fácil
  const ordemPos: Record<string, number> = {
    Goleiro: 0,
    Lateral: 1,
    Zagueiro: 2,
    Meia: 3,
    Atacante: 4,
    Técnico: 5,
  };
  const ordemEsc: Record<string, number> = { Sim: 0, Banco: 1, "Não": 2 };
  const sorted = [...jogadores].sort((a, b) =>
    (ordemPos[a.posicao] ?? 9) - (ordemPos[b.posicao] ?? 9) ||
    (ordemEsc[a.escalacao] ?? 9) - (ordemEsc[b.escalacao] ?? 9) ||
    a.apelido.localeCompare(b.apelido, "pt-BR")
  );

  return (
    <div class="bf-admin-transferir">
      <p class="bf-status-card__sub" style="margin:0 0 10px">
        Transfere um jogador deste elenco pra outro time da liga. Bypass do
        fluxo de ofertas — use pra corrigir erros ou ajustes manuais.
      </p>
      <div class="bf-admin-transferir__list">
        {sorted.map((j) => (
          <div class="bf-admin-transferir__row" key={j.atleta_id}>
            <span class="bf-admin-transferir__pos">
              {j.posicao ?? "?"}
            </span>
            <span class="bf-admin-transferir__name">{j.apelido}</span>
            <span class="bf-admin-transferir__clube">{j.clube}</span>
            <span
              class={`bf-admin-transferir__esc bf-admin-transferir__esc--${
                j.escalacao.toLowerCase().replace("ã", "a")
              }`}
            >
              {j.escalacao}
            </span>
            <button
              type="button"
              class="bf-btn bf-btn--ghost"
              style="height:28px;font-size:10px;padding:0 10px"
              onClick={() =>
                abrirModal(j)}
            >
              transferir →
            </button>
          </div>
        ))}
      </div>

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
              Time destino
            </label>
            <select
              value={destino}
              onChange={(e) =>
                setDestino((e.target as HTMLSelectElement).value)}
              style="width:100%;padding:10px;background:var(--bf-ink-2);color:var(--bf-fg-1);border:1px solid var(--bf-line);border-radius:var(--bf-radius-md);font-family:var(--bf-font-cond);font-size:14px;margin-bottom:14px"
            >
              <option value="">— selecione —</option>
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
                onClick={confirmar}
                disabled={!destino || enviando}
              >
                {enviando ? "..." : "transferir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
