// Painel admin: gerencia o limite + contagem de trocas com mercado
// por time na rodada selecionada. PUT atomico no save.

import { useEffect, useState } from "preact/hooks";

interface Row {
  chave: string;
  displayName: string;
  count: number;
  restante: number;
}

interface ApiResp {
  ok: boolean;
  rodada: number;
  max: number;
  times: Array<{ chave: string; count: number; restante: number }>;
}

interface Props {
  /** Map chave → displayName pra label de cada linha. Vem do admin
   *  (já tem todos os times resolvidos). */
  nomesPorChave: Record<string, string>;
  rodadaAtual: number;
}

export default function AdminTrocasMercado(
  { nomesPorChave, rodadaAtual }: Props,
) {
  const [rodada, setRodada] = useState(rodadaAtual);
  const [max, setMax] = useState<number>(10);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = async (r: number) => {
    setLoading(true);
    setMsg(null);
    try {
      const resp = await fetch(`/api/admin/trocas-mercado?rodada=${r}`);
      const json = await resp.json() as ApiResp;
      if (!json.ok) {
        setMsg("Erro ao carregar");
        return;
      }
      setMax(json.max);
      setRows(json.times.map((t) => ({
        chave: t.chave,
        displayName: nomesPorChave[t.chave] ?? t.chave,
        count: t.count,
        restante: t.restante,
      })));
    } catch {
      setMsg("Erro de rede");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar(rodada);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodada]);

  const updateCount = (chave: string, novo: number) => {
    setRows((rs) =>
      rs.map((r) =>
        r.chave === chave
          ? {
            ...r,
            count: novo,
            restante: Math.max(0, max - novo),
          }
          : r
      )
    );
  };

  const salvar = async () => {
    setSalvando(true);
    setMsg(null);
    try {
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.chave] = r.count;
      const resp = await fetch("/api/admin/trocas-mercado", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max, rodada, counts }),
      });
      const json = await resp.json();
      if (!json.ok) {
        setMsg(json.erro ?? "Erro");
      } else {
        setMsg("Salvo");
        // Recalcula restantes com novo max
        setRows((rs) =>
          rs.map((r) => ({ ...r, restante: Math.max(0, max - r.count) }))
        );
      }
    } catch {
      setMsg("Erro de rede");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div class="bf-admin-trocas">
      <div class="bf-admin-trocas__topo">
        <label class="bf-admin-trocas__campo">
          <span class="bf-label-micro">Rodada</span>
          <input
            type="number"
            min={1}
            value={String(rodada)}
            onChange={(e) =>
              setRodada(
                Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1),
              )}
          />
        </label>
        <label class="bf-admin-trocas__campo">
          <span class="bf-label-micro">Máximo por time</span>
          <input
            type="number"
            min={0}
            value={String(max)}
            onChange={(e) =>
              setMax(Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0))}
          />
        </label>
        <button
          type="button"
          class="bf-btn bf-btn--primary"
          onClick={salvar}
          disabled={salvando || loading}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {msg && <span class="bf-admin-trocas__msg">{msg}</span>}
      </div>

      {loading
        ? <div class="bf-empty-state">Carregando…</div>
        : (
          <ul class="bf-admin-trocas__lista">
            {rows.map((r) => (
              <li
                key={r.chave}
                class={`bf-admin-trocas__row ${
                  r.count >= max
                    ? "bf-admin-trocas__row--esgotado"
                    : ""
                }`}
              >
                <span class="bf-admin-trocas__nome">{r.displayName}</span>
                <input
                  class="bf-admin-trocas__input"
                  type="number"
                  min={0}
                  value={String(r.count)}
                  onInput={(e) =>
                    updateCount(
                      r.chave,
                      Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0),
                    )}
                />
                <span class="bf-admin-trocas__restante">
                  {r.count >= max
                    ? "esgotado"
                    : `${r.restante} restantes`}
                </span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
