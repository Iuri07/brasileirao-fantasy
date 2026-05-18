import { useRef, useState } from "preact/hooks";

interface TimeVisualItem {
  chave: string;
  nomeTime: string;
  displayName: string;
  logo: string | null;
  sigla: string;
  accent: string;
  customizado: boolean;
}

interface Props {
  times: TimeVisualItem[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface RowState {
  nome: string;
  displayName: string;
  logoUrl: string;
  logoFile: File | null;
  logoPreview: string | null;
  status: SaveStatus;
  msg?: string;
}

function initialState(t: TimeVisualItem): RowState {
  return {
    nome: t.nomeTime,
    displayName: t.displayName,
    logoUrl: t.logo && !t.logo.startsWith("/uploads/") ? t.logo : "",
    logoFile: null,
    logoPreview: null,
    status: "idle",
  };
}

export default function AdminTimesVisual({ times }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const out: Record<string, RowState> = {};
    for (const t of times) out[t.chave] = initialState(t);
    return out;
  });
  // Refs pra inputs file (precisa pra reset depois de upload)
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

  async function salvar(t: TimeVisualItem) {
    const r = rows[t.chave];
    if (!r) return;
    update(t.chave, { status: "saving", msg: undefined });

    try {
      const form = new FormData();
      if (r.nome.trim() && r.nome !== t.nomeTime) form.append("nome_time", r.nome.trim());
      if (r.displayName.trim() && r.displayName !== t.displayName) {
        form.append("displayName", r.displayName.trim());
      }
      if (r.logoFile) {
        form.append("logo", r.logoFile);
      } else if (r.logoUrl.trim() && r.logoUrl !== t.logo) {
        form.append("logoUrl", r.logoUrl.trim());
      }
      // Verifica se tem alguma coisa pra enviar
      if (!form.has("nome_time") && !form.has("displayName") && !form.has("logo") && !form.has("logoUrl")) {
        update(t.chave, { status: "idle", msg: "Nada mudou" });
        setTimeout(() => update(t.chave, { msg: undefined }), 2000);
        return;
      }

      const resp = await fetch(`/api/admin/time-visual?chave=${t.chave}`, {
        method: "POST",
        body: form,
      });
      const j = await resp.json();
      if (!j.ok) throw new Error(j.erro || "erro");
      update(t.chave, {
        status: "saved",
        logoFile: null,
        logoPreview: j.visual.logo,
        // Atualiza valores em memória pra próximo save comparar correto
        nome: j.visual.nomeTime,
        displayName: j.visual.displayName,
        logoUrl: j.visual.logo && !j.visual.logo.startsWith("/uploads/") ? j.visual.logo : "",
      });
      // Reset input file
      const inp = fileInputs.current[t.chave];
      if (inp) inp.value = "";
      setTimeout(() => update(t.chave, { status: "idle" }), 2000);
    } catch (e) {
      update(t.chave, { status: "error", msg: String(e) });
    }
  }

  async function resetar(t: TimeVisualItem) {
    if (!confirm(`Voltar ${t.displayName} pro visual padrão?`)) return;
    update(t.chave, { status: "saving" });
    try {
      const resp = await fetch(`/api/admin/time-visual?chave=${t.chave}`, {
        method: "DELETE",
      });
      const j = await resp.json();
      if (!j.ok) throw new Error(j.erro || "erro");
      update(t.chave, {
        nome: j.visual.nomeTime,
        displayName: j.visual.displayName,
        logoUrl: j.visual.logo && !j.visual.logo.startsWith("/uploads/") ? j.visual.logo : "",
        logoFile: null,
        logoPreview: j.visual.logo,
        status: "saved",
      });
      setTimeout(() => update(t.chave, { status: "idle" }), 1500);
      // recarrega pra refletir nas outras seções
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      update(t.chave, { status: "error", msg: String(e) });
    }
  }

  return (
    <div class="bf-times-visual">
      {times.map((t) => {
        const r = rows[t.chave];
        const previewSrc = r.logoPreview ?? t.logo;
        return (
          <div
            key={t.chave}
            class="bf-times-visual__row"
            style={{ "--accent": t.accent } as Record<string, string>}
          >
            <div class="bf-times-visual__preview">
              {previewSrc ? (
                <img src={previewSrc} alt={t.displayName} />
              ) : (
                <div class="bf-times-visual__sigla">{t.sigla}</div>
              )}
            </div>
            <div class="bf-times-visual__fields">
              <label class="bf-times-visual__label">
                <span>Nome (cards/topbar)</span>
                <input
                  type="text"
                  value={r.nome}
                  onInput={(e) => update(t.chave, { nome: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label class="bf-times-visual__label">
                <span>Display name (curto)</span>
                <input
                  type="text"
                  value={r.displayName}
                  onInput={(e) => update(t.chave, { displayName: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label class="bf-times-visual__label">
                <span>Logo (URL externa)</span>
                <input
                  type="url"
                  placeholder="https://..."
                  value={r.logoUrl}
                  onInput={(e) => update(t.chave, {
                    logoUrl: (e.target as HTMLInputElement).value,
                    logoFile: null,
                    logoPreview: null,
                  })}
                />
              </label>
              <label class="bf-times-visual__label">
                <span>Ou upload (PNG/JPG/WEBP/SVG ≤ 2 MB)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  ref={(el) => { fileInputs.current[t.chave] = el; }}
                  onChange={(e) => onFileChange(t.chave, (e.target as HTMLInputElement).files?.[0] ?? null)}
                />
              </label>
            </div>
            <div class="bf-times-visual__actions">
              <button
                type="button"
                class="bf-btn bf-btn--primary"
                disabled={r.status === "saving"}
                onClick={() => salvar(t)}
              >
                {r.status === "saving" ? "Salvando..." : "Salvar"}
              </button>
              {t.customizado && (
                <button
                  type="button"
                  class="bf-btn bf-btn--ghost"
                  onClick={() => resetar(t)}
                >
                  Resetar
                </button>
              )}
              {r.status === "saved" && <span class="bf-times-visual__ok">✓ Salvo</span>}
              {r.status === "error" && (
                <span class="bf-times-visual__err">{r.msg ?? "Erro"}</span>
              )}
              {r.msg && r.status === "idle" && (
                <span class="bf-times-visual__hint">{r.msg}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
