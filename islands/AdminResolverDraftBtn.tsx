// Botão admin pra forçar resolução de draft. Mostra resultado inline
// depois que o backend processa.

import { useState } from "preact/hooks";

interface Resultado {
  vencedores: Array<{
    nomeTime: string;
    atletaAlvoApelido: string;
    atletaOferecidoApelido: string;
    turno: number;
  }>;
  perdedores: Array<{
    chave: string;
    atletaAlvoApelido: string;
    vencedorNomeTime: string;
    turno: number;
  }>;
  errosCount: number;
  turnos: number;
  duracaoMs: number;
}

export default function AdminResolverDraftBtn() {
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar() {
    if (carregando) return;
    setCarregando(true);
    setErro(null);
    setResultado(null);
    try {
      const resp = await fetch("/api/admin/resolver-draft", {
        method: "POST",
      });
      const json = await resp.json();
      if (!json.ok) {
        setErro(json.erro ?? "Erro desconhecido");
      } else {
        setResultado(json.resultado);
      }
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div class="bf-admin-resolver">
      <button
        type="button"
        class="bf-btn bf-btn--primary"
        onClick={rodar}
        disabled={carregando}
      >
        {carregando ? "Processando…" : "Resolver agora"}
      </button>
      {erro && <span class="bf-admin-resolver__erro">{erro}</span>}
      {resultado && (
        <div class="bf-admin-resolver__out">
          <div class="bf-admin-resolver__resumo">
            {resultado.vencedores.length} aplicada(s) em {resultado.turnos}
            {" "}turno(s) · {resultado.perdedores.length} perdedor(es) ·{" "}
            {resultado.errosCount > 0
              ? `${resultado.errosCount} erro(s) ·`
              : ""}{" "}
            {resultado.duracaoMs}ms
          </div>
          {resultado.vencedores.length > 0 && (
            <ul class="bf-admin-resolver__lista">
              {resultado.vencedores.map((v, i) => (
                <li key={i}>
                  <span class="bf-admin-resolver__turno">T{v.turno}</span>
                  <strong>{v.nomeTime}</strong> ← {v.atletaAlvoApelido}{" "}
                  (saiu {v.atletaOferecidoApelido})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
