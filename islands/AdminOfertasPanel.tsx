import { useState } from "preact/hooks";
import SectionHeader from "../components/SectionHeader.tsx";

export interface AVendaItem {
  atleta_id: number;
  apelido: string;
  clube: string;
  chave: string;
  nomeTime: string;
}

export interface OfertaItem {
  id: string;
  criadoEm: number;
  deChave: string;
  deNomeTime: string;
  paraChave: string;
  paraNomeTime: string;
  /** Lista de apelidos dos oferecidos (1-3). */
  atletasOferecidosApelidos: string[];
  atletaPedidoId: number;
  atletaPedidoApelido: string;
  mensagem?: string;
}

interface Props {
  aVenda: AVendaItem[];
  ofertas: OfertaItem[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminOfertasPanel({ aVenda, ofertas }: Props) {
  // IDs locais já removidos otimisticamente (some da lista sem reload).
  const [aVendaRemovidos, setAVendaRemovidos] = useState<Set<string>>(
    new Set(),
  );
  const [ofertasCanceladas, setOfertasCanceladas] = useState<Set<string>>(
    new Set(),
  );
  const [erro, setErro] = useState<string | null>(null);

  function avKey(i: AVendaItem) {
    return `${i.chave}-${i.atleta_id}`;
  }

  async function tirarDaVenda(item: AVendaItem) {
    setErro(null);
    const key = avKey(item);
    setAVendaRemovidos((s) => new Set(s).add(key));
    try {
      const r = await fetch(`/api/elenco/${item.chave}/a-venda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atleta_id: item.atleta_id }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro ?? "Erro");
      // toggleAVenda flipa o estado — se voltou aVenda=true, o atleta
      // não estava lá e agora está (raríssimo). Rollback visual.
      if (d.aVenda === true) {
        setAVendaRemovidos((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
        setErro("Estado inesperado — o atleta voltou pra venda. Recarregue.");
      }
    } catch (e) {
      setAVendaRemovidos((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      setErro(String(e));
    }
  }

  async function cancelarOferta(id: string) {
    setErro(null);
    setOfertasCanceladas((s) => new Set(s).add(id));
    try {
      const r = await fetch("/api/admin/ofertas-cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro ?? "Erro");
    } catch (e) {
      setOfertasCanceladas((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setErro(String(e));
    }
  }

  const aVendaVisivel = aVenda.filter((i) => !aVendaRemovidos.has(avKey(i)));
  const ofertasVisiveis = ofertas.filter((o) => !ofertasCanceladas.has(o.id));

  return (
    <>
      {erro && (
        <div
          class="bf-empty-state"
          style="color:var(--bf-red);margin:0 var(--bf-gutter);"
          role="alert"
        >
          {erro}
        </div>
      )}

      <SectionHeader>
        À venda ({aVendaVisivel.length})
      </SectionHeader>
      {aVendaVisivel.length === 0
        ? <div class="bf-empty-state">Ninguém à venda no momento</div>
        : (
          <div class="bf-admin-ofertas">
            {aVendaVisivel.map((i) => (
              <div class="bf-admin-ofertas__row" key={avKey(i)}>
                <div class="bf-admin-ofertas__main">
                  <div class="bf-admin-ofertas__name">{i.apelido}</div>
                  <div class="bf-admin-ofertas__sub">
                    {i.clube} · time: <strong>{i.nomeTime}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  class="bf-btn bf-btn--ghost"
                  style="height:30px;font-size:10px;padding:0 10px"
                  onClick={() =>
                    tirarDaVenda(i)}
                >
                  tirar
                </button>
              </div>
            ))}
          </div>
        )}

      <SectionHeader>
        Ofertas pendentes ({ofertasVisiveis.length})
      </SectionHeader>
      {ofertasVisiveis.length === 0
        ? <div class="bf-empty-state">Nenhuma oferta pendente</div>
        : (
          <div class="bf-admin-ofertas">
            {ofertasVisiveis.map((o) => (
              <div class="bf-admin-ofertas__row" key={o.id}>
                <div class="bf-admin-ofertas__main">
                  <div class="bf-admin-ofertas__name">
                    {o.deNomeTime}{" "}
                    <span style="color:var(--bf-fg-3);font-weight:400">→</span>
                    {" "}
                    {o.paraNomeTime}
                  </div>
                  <div class="bf-admin-ofertas__sub">
                    Oferece{" "}
                    <strong>{o.atletasOferecidosApelidos.join(", ")}</strong>{" "}
                    por <strong>{o.atletaPedidoApelido}</strong>
                    {o.atletasOferecidosApelidos.length > 1 && (
                      <span style="color:var(--bf-fg-3);font-size:10px">
                        {" "}(+ {o.atletasOferecidosApelidos.length - 1} extra(s) escolhido(s) pelo destinatário)
                      </span>
                    )}
                  </div>
                  <div
                    class="bf-admin-ofertas__sub"
                    style="font-size:10px;opacity:.7"
                  >
                    {fmtDate(o.criadoEm)}
                  </div>
                </div>
                <button
                  type="button"
                  class="bf-btn bf-btn--ghost"
                  style="height:30px;font-size:10px;padding:0 10px"
                  onClick={() =>
                    cancelarOferta(o.id)}
                >
                  cancelar
                </button>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
