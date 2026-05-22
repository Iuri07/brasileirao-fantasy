import { useRef, useState } from "preact/hooks";

export interface AdminTimeItem {
  chave: string;
  nomeTime: string;
  displayName: string;
  logo: string | null;
  sigla: string;
  accent: string;
  customizado: boolean;
  dono: string;
  email: string | null;
}

interface Props {
  times: AdminTimeItem[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface RowState {
  email: string;
  nome: string;
  displayName: string;
  logoUrl: string;
  logoFile: File | null;
  logoPreview: string | null;
  status: SaveStatus;
  msg?: string;
}

function initialState(t: AdminTimeItem): RowState {
  return {
    email: t.email ?? "",
    nome: t.nomeTime,
    displayName: t.displayName,
    logoUrl: t.logo && !t.logo.startsWith("/uploads/") ? t.logo : "",
    logoFile: null,
    logoPreview: null,
    status: "idle",
  };
}

/**
 * Card por time agrupando: identidade visual (logo + nome + displayName)
 * + email Google atrelado. Substitui AdminEmailMap + AdminTimesVisual no
 * dashboard desktop. Cada card salva visual e email em endpoints separados,
 * mas o "Salvar" único decide o que mandar baseado no que mudou.
 */
export default function AdminTimesGrid({ times }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const out: Record<string, RowState> = {};
    for (const t of times) out[t.chave] = initialState(t);
    return out;
  });
  // Mantém o snapshot do estado salvo do server, pra comparar mudanças
  const [saved, setSaved] = useState<Record<string, AdminTimeItem>>(() => {
    const out: Record<string, AdminTimeItem> = {};
    for (const t of times) out[t.chave] = t;
    return out;
  });
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function update(chave: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [chave]: { ...prev[chave], ...patch } }));
  }

  function onFileChange(chave: string, file: File | null) {
    if (!file) {
      update(chave, { logoFile: null, logoPreview: null });
      return;
    }
    const url = URL.createObjectURL(file);
    update(chave, { logoFile: file, logoPreview: url, logoUrl: "" });
  }

  async function salvar(t: AdminTimeItem) {
    const r = rows[t.chave];
    const cur = saved[t.chave];
    if (!r) return;
    update(t.chave, { status: "saving", msg: undefined });

    const mudouEmail =
      r.email.trim().toLowerCase() !== (cur.email ?? "").toLowerCase();
    const mudouNome = r.nome.trim() !== cur.nomeTime;
    const mudouDisplay = r.displayName.trim() !== cur.displayName;
    const mudouLogoUrl = r.logoUrl.trim() &&
      r.logoUrl.trim() !==
        (cur.logo && !cur.logo.startsWith("/uploads/") ? cur.logo : "");
    const mudouVisual = mudouNome || mudouDisplay || mudouLogoUrl || r.logoFile;

    if (!mudouEmail && !mudouVisual) {
      update(t.chave, { status: "idle", msg: "Nada mudou" });
      setTimeout(() => update(t.chave, { msg: undefined }), 1500);
      return;
    }

    try {
      let novoVisual: AdminTimeItem | null = null;
      let novoEmail: string | null = cur.email;

      // 1. Salva visual (multipart se houver file)
      if (mudouVisual) {
        const form = new FormData();
        if (mudouNome) form.append("nome_time", r.nome.trim());
        if (mudouDisplay) form.append("displayName", r.displayName.trim());
        if (r.logoFile) form.append("logo", r.logoFile);
        else if (mudouLogoUrl) form.append("logoUrl", r.logoUrl.trim());

        const resp = await fetch(`/api/admin/time-visual?chave=${t.chave}`, {
          method: "POST",
          body: form,
        });
        const j = await resp.json();
        if (!j.ok) throw new Error(j.erro || "Erro visual");
        novoVisual = {
          ...cur,
          nomeTime: j.visual.nomeTime,
          displayName: j.visual.displayName,
          logo: j.visual.logo,
          customizado: j.visual.customizado,
        };
      }

      // 2. Salva email
      if (mudouEmail) {
        const novo = r.email.trim().toLowerCase();
        if (!novo) {
          // remoção
          const resp = await fetch("/api/admin/email-map", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chave: t.chave }),
          });
          const j = await resp.json();
          if (!j.ok) throw new Error(j.erro || "Erro remover email");
          novoEmail = null;
        } else {
          const resp = await fetch("/api/admin/email-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chave: t.chave, email: novo }),
          });
          const j = await resp.json();
          if (!j.ok) throw new Error(j.erro || "Erro email");
          novoEmail = novo;
        }
      }

      // 3. Atualiza snapshot salvo
      const novoSnap: AdminTimeItem = {
        ...(novoVisual ?? cur),
        email: novoEmail,
      };
      setSaved((prev) => ({ ...prev, [t.chave]: novoSnap }));
      // Reset preview + file input
      update(t.chave, {
        status: "saved",
        logoFile: null,
        logoPreview: novoSnap.logo,
        nome: novoSnap.nomeTime,
        displayName: novoSnap.displayName,
        logoUrl: novoSnap.logo && !novoSnap.logo.startsWith("/uploads/")
          ? novoSnap.logo
          : "",
        email: novoSnap.email ?? "",
      });
      const inp = fileInputs.current[t.chave];
      if (inp) inp.value = "";
      setTimeout(() => update(t.chave, { status: "idle" }), 1800);
    } catch (e) {
      update(t.chave, { status: "error", msg: String(e) });
    }
  }

  async function resetarVisual(t: AdminTimeItem) {
    if (!confirm(`Voltar ${t.displayName} pro visual padrão?`)) return;
    update(t.chave, { status: "saving" });
    try {
      const resp = await fetch(`/api/admin/time-visual?chave=${t.chave}`, {
        method: "DELETE",
      });
      const j = await resp.json();
      if (!j.ok) throw new Error(j.erro || "erro");
      // Atualiza snapshot
      const cur = saved[t.chave];
      const novoSnap: AdminTimeItem = {
        ...cur,
        nomeTime: j.visual.nomeTime,
        displayName: j.visual.displayName,
        logo: j.visual.logo,
        customizado: false,
      };
      setSaved((prev) => ({ ...prev, [t.chave]: novoSnap }));
      update(t.chave, {
        nome: novoSnap.nomeTime,
        displayName: novoSnap.displayName,
        logoUrl: novoSnap.logo && !novoSnap.logo.startsWith("/uploads/")
          ? novoSnap.logo
          : "",
        logoFile: null,
        logoPreview: novoSnap.logo,
        status: "saved",
      });
      setTimeout(() => update(t.chave, { status: "idle" }), 1500);
      // recarrega pra refletir nas outras seções (cache de visual)
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      update(t.chave, { status: "error", msg: String(e) });
    }
  }

  return (
    <div class="bf-times-grid">
      {times.map((t) => {
        const r = rows[t.chave];
        const cur = saved[t.chave];
        const previewSrc = r.logoPreview ?? cur.logo;
        return (
          <article
            key={t.chave}
            class="bf-times-grid__card"
            data-customizado={cur.customizado ? "1" : "0"}
            style={{ "--accent": cur.accent } as Record<string, string>}
          >
            <header class="bf-times-grid__header">
              <div class="bf-times-grid__preview">
                {previewSrc
                  ? <img src={previewSrc} alt={cur.displayName} />
                  : <div class="bf-times-grid__sigla">{cur.sigla}</div>}
              </div>
              <div class="bf-times-grid__heading">
                <div class="bf-times-grid__name">
                  {r.displayName || cur.displayName}
                </div>
                <div class="bf-times-grid__dono">{cur.dono}</div>
                {cur.customizado && (
                  <span class="bf-times-grid__badge">customizado</span>
                )}
              </div>
            </header>

            <div class="bf-times-grid__fields">
              <label class="bf-times-grid__label">
                <span>Email Google</span>
                <input
                  type="email"
                  placeholder="email@gmail.com"
                  value={r.email}
                  onInput={(e) =>
                    update(t.chave, {
                      email: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="bf-times-grid__label">
                <span>Nome</span>
                <input
                  type="text"
                  value={r.nome}
                  onInput={(e) =>
                    update(t.chave, {
                      nome: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="bf-times-grid__label">
                <span>Display</span>
                <input
                  type="text"
                  value={r.displayName}
                  onInput={(e) =>
                    update(t.chave, {
                      displayName: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="bf-times-grid__label">
                <span>Logo URL</span>
                <input
                  type="url"
                  placeholder="https://..."
                  value={r.logoUrl}
                  onInput={(e) =>
                    update(t.chave, {
                      logoUrl: (e.target as HTMLInputElement).value,
                      logoFile: null,
                      logoPreview: null,
                    })}
                />
              </label>
              <label class="bf-times-grid__label bf-times-grid__label--file">
                <span>Upload (≤2MB)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  ref={(el) => {
                    fileInputs.current[t.chave] = el;
                  }}
                  onChange={(e) =>
                    onFileChange(
                      t.chave,
                      (e.target as HTMLInputElement).files?.[0] ?? null,
                    )}
                />
              </label>
            </div>

            <footer class="bf-times-grid__footer">
              <button
                type="button"
                class="bf-btn bf-btn--primary"
                disabled={r.status === "saving"}
                onClick={() => salvar(cur)}
              >
                {r.status === "saving" ? "Salvando..." : "Salvar"}
              </button>
              {cur.customizado && (
                <button
                  type="button"
                  class="bf-btn bf-btn--ghost"
                  onClick={() => resetarVisual(cur)}
                  disabled={r.status === "saving"}
                  title="Volta logo + nome pros defaults"
                >
                  Resetar visual
                </button>
              )}
              <div class="bf-times-grid__status">
                {r.status === "saved" && (
                  <span class="bf-times-grid__ok">✓ Salvo</span>
                )}
                {r.status === "error" && (
                  <span class="bf-times-grid__err">{r.msg ?? "Erro"}</span>
                )}
                {r.msg && r.status === "idle" && (
                  <span class="bf-times-grid__hint">{r.msg}</span>
                )}
              </div>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
