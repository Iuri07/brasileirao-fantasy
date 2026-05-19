import { useEffect, useMemo, useRef, useState } from "preact/hooks";

interface TimeRow {
  chave: string;
  displayName: string;
  escudo: string | null;
}

interface Props {
  times: TimeRow[];
  rodadaAtual: number;
  historicosIniciais: Record<string, Record<string, number>>;
}

interface CellEdit {
  chave: string;
  rodada: number;
  valor: string;
}

type CellStatus = "idle" | "saving" | "saved" | "error";

/**
 * Matriz times x rodadas pra edição inline de pontos.
 * - Tab pra navegar entre células
 * - Salva onBlur (debounce 400ms) — não precisa botão "salvar"
 * - Indicador de status por célula (saving spinner / saved check / error)
 */
export default function AdminHistoricoMatriz({
  times,
  rodadaAtual,
  historicosIniciais,
}: Props) {
  // Mostra rodada atual + 2 a mais pra permitir edição antecipada (admin pode lançar antes do cron)
  const maxRodada = Math.max(
    rodadaAtual,
    ...Object.values(historicosIniciais).flatMap((h) =>
      Object.keys(h).map(Number)
    ),
    1,
  );
  const [rodadas] = useState<number[]>(
    Array.from({ length: maxRodada }, (_, i) => i + 1),
  );
  const [historicos, setHistoricos] = useState<
    Record<string, Record<string, number>>
  >(historicosIniciais);
  const [status, setStatus] = useState<Record<string, CellStatus>>({});
  const debounceRef = useRef<Record<string, number>>({});

  function cellKey(chave: string, rodada: number) {
    return `${chave}:${rodada}`;
  }

  function setCellStatus(k: string, s: CellStatus) {
    setStatus((prev) => ({ ...prev, [k]: s }));
    if (s === "saved") {
      // limpa o check depois de 1.5s pra UI não ficar verde-perpétua
      setTimeout(() => {
        setStatus((prev) => {
          const next = { ...prev };
          if (next[k] === "saved") delete next[k];
          return next;
        });
      }, 1500);
    }
  }

  async function salvar(edit: CellEdit) {
    const k = cellKey(edit.chave, edit.rodada);
    setCellStatus(k, "saving");
    const pontos = edit.valor.trim() === ""
      ? null
      : Number(edit.valor.replace(",", "."));
    if (pontos !== null && !Number.isFinite(pontos)) {
      setCellStatus(k, "error");
      return;
    }
    try {
      const r = await fetch("/api/admin/historico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chave: edit.chave,
          rodada: edit.rodada,
          pontos,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.erro || "erro");
      setHistoricos((prev) => {
        const next = { ...prev };
        const time = { ...(next[edit.chave] ?? {}) };
        if (pontos === null) {
          delete time[String(edit.rodada)];
        } else {
          time[String(edit.rodada)] = Math.round(pontos * 10) / 10;
        }
        next[edit.chave] = time;
        return next;
      });
      setCellStatus(k, "saved");
    } catch (e) {
      console.error("[historico] salvar erro:", e);
      setCellStatus(k, "error");
    }
  }

  function onChange(chave: string, rodada: number, valor: string) {
    const k = cellKey(chave, rodada);
    // limpa qualquer status anterior pro user ver que tá editando
    setStatus((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
    // Atualiza UI local instantaneamente (controlled input)
    setHistoricos((prev) => {
      const next = { ...prev };
      const time = { ...(next[chave] ?? {}) };
      if (valor.trim() === "") {
        delete time[String(rodada)];
      } else {
        // não converte ainda — deixa o user digitar
        time[String(rodada)] = valor as unknown as number;
      }
      next[chave] = time;
      return next;
    });

    // debounce save
    if (debounceRef.current[k]) clearTimeout(debounceRef.current[k]);
    debounceRef.current[k] = setTimeout(() => {
      salvar({ chave, rodada, valor });
    }, 600) as unknown as number;
  }

  function onBlur(chave: string, rodada: number, valor: string) {
    const k = cellKey(chave, rodada);
    if (debounceRef.current[k]) {
      clearTimeout(debounceRef.current[k]);
      delete debounceRef.current[k];
    }
    salvar({ chave, rodada, valor });
  }

  // Totais por time (memo pra re-render barato)
  const totais = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of times) {
      const h = historicos[t.chave] ?? {};
      let soma = 0;
      for (const v of Object.values(h)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) soma += n;
      }
      out[t.chave] = Math.round(soma * 10) / 10;
    }
    return out;
  }, [historicos, times]);

  return (
    <div class="bf-historico-matriz">
      <div class="bf-historico-matriz__scroll">
        <table class="bf-historico-matriz__table">
          <thead>
            <tr>
              <th class="bf-historico-matriz__th-time">Time</th>
              {rodadas.map((r) => (
                <th key={r} class="bf-historico-matriz__th-rodada">
                  R{r}
                </th>
              ))}
              <th class="bf-historico-matriz__th-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {times.map((t) => (
              <tr key={t.chave}>
                <th class="bf-historico-matriz__th-time-row">
                  {t.escudo && (
                    <img
                      class="bf-historico-matriz__escudo"
                      src={t.escudo}
                      alt={t.displayName}
                    />
                  )}
                  <span>{t.displayName}</span>
                </th>
                {rodadas.map((r) => {
                  const k = cellKey(t.chave, r);
                  const v = historicos[t.chave]?.[String(r)];
                  const display = v === undefined || v === null
                    ? ""
                    : String(v);
                  const st = status[k] ?? "idle";
                  return (
                    <td
                      key={r}
                      class="bf-historico-matriz__td"
                      data-status={st}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        class="bf-historico-matriz__input"
                        value={display}
                        onInput={(e) =>
                          onChange(
                            t.chave,
                            r,
                            (e.target as HTMLInputElement).value,
                          )}
                        onBlur={(e) =>
                          onBlur(
                            t.chave,
                            r,
                            (e.target as HTMLInputElement).value,
                          )}
                        placeholder="—"
                      />
                      {st === "saving" && (
                        <span class="bf-historico-matriz__status bf-historico-matriz__status--saving" />
                      )}
                      {st === "saved" && (
                        <span class="bf-historico-matriz__status bf-historico-matriz__status--saved">
                          ✓
                        </span>
                      )}
                      {st === "error" && (
                        <span class="bf-historico-matriz__status bf-historico-matriz__status--error">
                          !
                        </span>
                      )}
                    </td>
                  );
                })}
                <td class="bf-historico-matriz__td-total">
                  {totais[t.chave].toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="bf-historico-matriz__hint">
        Edição salva automaticamente. Deixe vazio pra remover a célula.
      </p>
    </div>
  );
}
