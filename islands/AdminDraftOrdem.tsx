// Painel admin pra reordenar a ordem do draft (interesses).
// Botões up/down por linha, salvar em batch.

import { useState } from "preact/hooks";

interface Time {
  chave: string;
  displayName: string;
}

interface Props {
  /** Ordem inicial (chaves) — de mais alta a mais baixa. */
  ordemInicial: string[];
  /** Map chave → displayName pra render. */
  times: Record<string, string>;
}

export default function AdminDraftOrdem(
  { ordemInicial, times }: Props,
) {
  const [ordem, setOrdem] = useState<string[]>(ordemInicial);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const mudou = ordem.length !== ordemInicial.length ||
    ordem.some((c, i) => c !== ordemInicial[i]);

  function move(index: number, dir: -1 | 1) {
    const alvo = index + dir;
    if (alvo < 0 || alvo >= ordem.length) return;
    const novo = [...ordem];
    [novo[index], novo[alvo]] = [novo[alvo], novo[index]];
    setOrdem(novo);
    setMsg(null);
  }

  function reset() {
    setOrdem(ordemInicial);
    setMsg(null);
  }

  async function salvar() {
    if (!mudou) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/draft-ordem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordem }),
      });
      const d = await r.json();
      if (!d.ok) {
        setMsg(d.erro ?? "Erro ao salvar");
      } else {
        setMsg("Ordem salva");
        // Recarrega pra atualizar ordemInicial
        setTimeout(() => location.reload(), 600);
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div class="bf-admin-draft-ordem">
      <p class="bf-status-card__sub" style="margin:0 0 10px">
        Ordem do draft: quem está mais alto leva na disputa por atleta livre.
        Após a resolução, quem pegou vai automaticamente pro fim da fila.
      </p>
      <ol class="bf-admin-draft-ordem__list">
        {ordem.map((chave, i) => (
          <li class="bf-admin-draft-ordem__row" key={chave}>
            <span class="bf-admin-draft-ordem__pos">{i + 1}º</span>
            <span class="bf-admin-draft-ordem__nome">
              {times[chave] ?? chave}
            </span>
            <div class="bf-admin-draft-ordem__acoes">
              <button
                type="button"
                class="bf-btn bf-btn--ghost"
                style="height:26px;font-size:12px;padding:0 8px"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Subir"
              >
                ↑
              </button>
              <button
                type="button"
                class="bf-btn bf-btn--ghost"
                style="height:26px;font-size:12px;padding:0 8px"
                onClick={() => move(i, 1)}
                disabled={i === ordem.length - 1}
                aria-label="Descer"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div class="bf-admin-draft-ordem__footer">
        <button
          type="button"
          class="bf-btn bf-btn--primary"
          onClick={salvar}
          disabled={!mudou || salvando}
        >
          {salvando ? "Salvando…" : "Salvar ordem"}
        </button>
        {mudou && !salvando && (
          <button
            type="button"
            class="bf-btn bf-btn--ghost"
            onClick={reset}
          >
            Desfazer
          </button>
        )}
        {msg && <span class="bf-admin-draft-ordem__msg">{msg}</span>}
      </div>
    </div>
  );
}
