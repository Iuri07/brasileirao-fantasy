import { useState } from "preact/hooks";

export interface TrocaItem {
  id: string;
  concluidaEm: number;
  desfeitaEm?: number;
  chaveA: string;
  nomeA: string;
  atletaA: string;
  chaveB: string;
  nomeB: string;
  atletaB: string;
}

interface Props {
  trocas: TrocaItem[];
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminTrocasPanel({ trocas }: Props) {
  // Tracking otimista das que acabaram de ser desfeitas (atualiza
  // visual sem reload pra responsividade).
  const [desfeitasAgora, setDesfeitasAgora] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [pendendo, setPendendo] = useState<Set<string>>(new Set());

  async function desfazer(id: string) {
    setErro(null);
    setPendendo((s) => new Set(s).add(id));
    try {
      const r = await fetch("/api/admin/trocas-desfazer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErro(d.erro ?? "Erro");
      } else {
        setDesfeitasAgora((s) => new Set(s).add(id));
      }
    } catch (e) {
      setErro(String(e));
    } finally {
      setPendendo((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  if (trocas.length === 0) {
    return <div class="bf-empty-state">Nenhuma troca registrada ainda</div>;
  }

  return (
    <>
      {erro && (
        <div
          class="bf-empty-state"
          style="color:var(--bf-red);margin:0 var(--bf-gutter)"
          role="alert"
        >
          {erro}
        </div>
      )}
      <div class="bf-admin-ofertas">
        {trocas.map((t) => {
          const desfeita = !!t.desfeitaEm || desfeitasAgora.has(t.id);
          return (
            <div
              class="bf-admin-ofertas__row"
              key={t.id}
              style={desfeita ? "opacity:.5" : ""}
            >
              <div class="bf-admin-ofertas__main">
                <div class="bf-admin-ofertas__name">
                  <strong>{t.atletaA}</strong>{" "}
                  <span style="color:var(--bf-fg-3);font-weight:400">
                    ({t.nomeA})
                  </span>{" "}
                  <span style="color:var(--bf-fg-3);font-weight:400">↔</span>
                  {" "}
                  <strong>{t.atletaB}</strong>{" "}
                  <span style="color:var(--bf-fg-3);font-weight:400">
                    ({t.nomeB})
                  </span>
                </div>
                <div
                  class="bf-admin-ofertas__sub"
                  style="font-size:10px;opacity:.7"
                >
                  Concluída em {fmt(t.concluidaEm)}
                  {desfeita && t.desfeitaEm && (
                    <>· desfeita em {fmt(t.desfeitaEm)}</>
                  )}
                  {desfeita && !t.desfeitaEm && <>· desfeita agora</>}
                </div>
              </div>
              {desfeita
                ? (
                  <span
                    class="bf-admin-transferir__esc bf-admin-transferir__esc--nao"
                    style="padding:4px 8px"
                  >
                    desfeita
                  </span>
                )
                : (
                  <button
                    type="button"
                    class="bf-btn bf-btn--ghost"
                    style="height:30px;font-size:10px;padding:0 10px"
                    onClick={() => desfazer(t.id)}
                    disabled={pendendo.has(t.id)}
                  >
                    {pendendo.has(t.id) ? "..." : "desfazer"}
                  </button>
                )}
            </div>
          );
        })}
      </div>
    </>
  );
}
