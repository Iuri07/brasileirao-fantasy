// Painel admin: gerencia o limite + contagem de trocas com mercado
// por time na rodada selecionada. PUT atomico no save.

import { useEffect, useState } from "preact/hooks";

interface Row {
  chave: string;
  displayName: string;
  count: number;
}

interface ApiResp {
  ok: boolean;
  rodada: number;
  times: Array<{ chave: string; count: number }>;
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
      setRows(json.times.map((t) => ({
        chave: t.chave,
        displayName: nomesPorChave[t.chave] ?? t.chave,
        count: t.count,
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
      rs.map((r) => r.chave === chave ? { ...r, count: novo } : r)
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
        body: JSON.stringify({ rodada, counts }),
      });
      const json = await resp.json();
      if (!json.ok) {
        setMsg(json.erro ?? "Erro");
      } else {
        setMsg("Salvo");
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
              <li key={r.chave} class="bf-admin-trocas__row">
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
                <span class="bf-admin-trocas__restante">trocas c/ mercado</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
