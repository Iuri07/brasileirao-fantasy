import { useState } from "preact/hooks";
import TeamCrest from "../components/TeamCrest.tsx";

interface Atribuicao {
  chave: string;
  nomeTime: string;
  dono: string;
  displayName: string;
  email: string | null;
}

interface Props {
  atribuicoes: Atribuicao[];
}

export default function AdminEmailMap({ atribuicoes: initial }: Props) {
  const [atribs, setAtribs] = useState<Atribuicao[]>(initial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendendo, setPendendo] = useState<string | null>(null);

  async function salvar(chave: string, email: string) {
    setPendendo(chave);
    setErro(null);
    const prev = atribs;
    const trimmed = email.trim().toLowerCase();
    setAtribs((arr) =>
      arr.map((a) => (a.chave === chave ? { ...a, email: trimmed || null } : a))
    );
    try {
      const r = await fetch("/api/admin/email-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave, email: trimmed }),
      });
      const d = await r.json();
      if (!d.ok) {
        setAtribs(prev);
        setErro(d.erro ?? "Erro ao salvar");
      }
    } catch (e) {
      setAtribs(prev);
      setErro(String(e));
    } finally {
      setPendendo(null);
    }
  }

  async function remover(chave: string) {
    setPendendo(chave);
    setErro(null);
    const prev = atribs;
    setAtribs((arr) =>
      arr.map((a) => (a.chave === chave ? { ...a, email: null } : a))
    );
    try {
      const r = await fetch("/api/admin/email-map", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave }),
      });
      const d = await r.json();
      if (!d.ok) {
        setAtribs(prev);
        setErro(d.erro ?? "Erro ao remover");
      }
    } catch (e) {
      setAtribs(prev);
      setErro(String(e));
    } finally {
      setPendendo(null);
    }
  }

  return (
    <div class="bf-admin-list">
      {erro && <div class="bf-meu-time__erro">{erro}</div>}
      {atribs.map((a) => (
        <Linha
          key={a.chave}
          a={a}
          onSalvar={salvar}
          onRemover={remover}
          pendendo={pendendo === a.chave}
        />
      ))}
    </div>
  );
}

function Linha(
  { a, onSalvar, onRemover, pendendo }: {
    a: Atribuicao;
    onSalvar: (chave: string, email: string) => Promise<void>;
    onRemover: (chave: string) => Promise<void>;
    pendendo: boolean;
  },
) {
  const [valor, setValor] = useState(a.email ?? "");
  function submit(e: Event) {
    e.preventDefault();
    void onSalvar(a.chave, valor);
  }
  return (
    <form class="bf-admin-row" onSubmit={submit}>
      <div class="bf-admin-row__top">
        <TeamCrest chave={a.chave} size={56} />
        <div class="bf-admin-row__name">
          <div class="bf-admin-row__time">{a.displayName}</div>
          <div class="bf-admin-row__dono">{a.dono}</div>
        </div>
      </div>
      <div class="bf-admin-row__bottom">
        <input
          type="email"
          class="bf-admin-row__input"
          placeholder="email@gmail.com"
          value={valor}
          onInput={(e) => setValor((e.target as HTMLInputElement).value)}
          disabled={pendendo}
        />
        <button
          type="submit"
          class="bf-admin-row__btn"
          disabled={pendendo || valor === (a.email ?? "")}
          aria-label="Salvar"
          title="Salvar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        {a.email && (
          <button
            type="button"
            class="bf-admin-row__btn bf-admin-row__btn--del"
            onClick={() => onRemover(a.chave)}
            disabled={pendendo}
            aria-label="Remover"
            title="Remover atribuição"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
