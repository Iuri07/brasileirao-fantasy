import { useState } from "preact/hooks";

interface Props {
  /** True se a flag de simulação está ativa no KV agora */
  ativoInicial: boolean;
  /** Rodada atual (do KV ou Cartola) — só pra exibir contexto */
  rodadaAtual: number;
}

export default function AdminSimularRodada(
  { ativoInicial, rodadaAtual }: Props,
) {
  const [ativo, setAtivo] = useState(ativoInicial);
  const [trabalhando, setTrabalhando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function ligarSimulacao() {
    if (
      !confirm(
        `Vai gerar pontos aleatórios pra TODOS os jogadores da rodada ${rodadaAtual} e travar o cron. Continuar?`,
      )
    ) return;
    setTrabalhando(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/admin/simular-rodada", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setAtivo(true);
        setFeedback(
          `Simulação ativa · ${d.totalEntraram}/${d.totalJogadores} entraram em campo`,
        );
      } else setFeedback(d.erro ?? "Erro");
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setTrabalhando(false);
    }
  }

  async function regerar() {
    setTrabalhando(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/admin/simular-rodada", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setFeedback(
          `Pontos regerados · ${d.totalEntraram}/${d.totalJogadores} entraram`,
        );
      } else setFeedback(d.erro ?? "Erro");
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setTrabalhando(false);
    }
  }

  async function encerrar(zerar: boolean) {
    if (
      !confirm(
        zerar
          ? "Encerra a simulação e ZERA todos os pontos. Continuar?"
          : "Encerra a simulação (mantém os pontos atuais). Continuar?",
      )
    ) return;
    setTrabalhando(true);
    setFeedback(null);
    try {
      const r = await fetch(
        `/api/admin/simular-rodada?encerrar=1${zerar ? "&zerar=1" : ""}`,
        { method: "POST" },
      );
      const d = await r.json();
      if (d.ok) {
        setAtivo(false);
        setFeedback(
          zerar
            ? "Simulação encerrada e pontos zerados"
            : "Simulação encerrada",
        );
      } else setFeedback(d.erro ?? "Erro");
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <div class="bf-sim">
      <div class="bf-sim__status">
        <span class="bf-label-micro">Status</span>
        <span
          class={`bf-sim__status-val ${ativo ? "bf-sim__status-val--on" : ""}`}
        >
          {ativo ? "Simulando" : "Inativo"}
        </span>
      </div>

      {!ativo
        ? (
          <button
            type="button"
            class="bf-sim__btn bf-sim__btn--primary"
            disabled={trabalhando}
            onClick={ligarSimulacao}
          >
            {trabalhando
              ? "Iniciando…"
              : `Iniciar simulação (rodada ${rodadaAtual})`}
          </button>
        )
        : (
          <div class="bf-sim__acoes">
            <button
              type="button"
              class="bf-sim__btn"
              disabled={trabalhando}
              onClick={regerar}
            >
              {trabalhando ? "…" : "Regerar pontos"}
            </button>
            <button
              type="button"
              class="bf-sim__btn"
              disabled={trabalhando}
              onClick={() => encerrar(false)}
            >
              Encerrar (manter pts)
            </button>
            <button
              type="button"
              class="bf-sim__btn bf-sim__btn--danger"
              disabled={trabalhando}
              onClick={() => encerrar(true)}
            >
              Encerrar e zerar
            </button>
          </div>
        )}

      {feedback && <div class="bf-sim__feedback">{feedback}</div>}
    </div>
  );
}
