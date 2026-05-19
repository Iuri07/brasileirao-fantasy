import { useEffect, useRef, useState } from "preact/hooks";
import { ComponentChildren } from "preact";
import TeamCrest from "../components/TeamCrest.tsx";
import Sparkline from "../components/Sparkline.tsx";

const OPEN_EVENT = "bf:team-row-open";

interface Props {
  /** Identificador interno (chave do dono) — usado pro TeamCrest */
  chave: string;
  /** Posição no ranking (1, 2, 3...) */
  pos: number;
  /** Nome do time exibido */
  displayName: string;
  /** Nome do dono */
  dono: string;
  /** Total acumulado de pontos formatado (ex: "0,0") */
  totalFmt: string;
  /** Cor neon do time (hex) */
  accent: string;
  /** É o time do usuário? Aplica modifier --mine */
  isMine?: boolean;
  /** Histórico de pontos por rodada — vira sparkline no cabeçalho */
  historico?: Record<string, number>;
  /** Quantas auto-substituições foram aplicadas (só pra ao vivo). */
  subsBadge?: { aplicadas: number; max: number } | null;
  /** Label embaixo do número grande de pontos. Default "PTS".
      /ao-vivo usa "PARCIAL" pra diferenciar do total acumulado de /liga. */
  ptsLabel?: string;
  /** Delta de posição vs ranking geral (acumulado da temporada).
      Positivo = subiu na rodada, negativo = caiu, 0 = igual. Só /ao-vivo. */
  posDelta?: number | null;
  /** Conteúdo que aparece colapsado/expandido (Field SSR) */
  children: ComponentChildren;
}

/**
 * Linha colapsável animada via grid-template-rows trick (compat universal).
 * Renderiza summary (cabeçalho) com props simples + children (escalação).
 */
export default function CollapsibleTeamRow(
  {
    chave,
    pos,
    displayName,
    dono,
    totalFmt,
    accent,
    isMine,
    historico,
    subsBadge = null,
    ptsLabel = "PTS",
    posDelta = null,
    children,
  }: Props,
) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isLider = pos === 1;
  const cls = ["bf-team-row"];
  if (open) cls.push("bf-team-row--open");
  if (isLider) cls.push("bf-team-row--lider");
  if (isMine) cls.push("bf-team-row--mine");

  // Accordion: fecha outras rows quando qualquer uma abre
  useEffect(() => {
    function onOpenElsewhere(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== chave) setOpen(false);
    }
    addEventListener(OPEN_EVENT, onOpenElsewhere);
    return () => removeEventListener(OPEN_EVENT, onOpenElsewhere);
  }, [chave]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: chave }));
      // Espera as outras rows fecharem (~280ms) antes de scrollar pro topo.
      // Sem essa espera, o reflow das rows acima joga o card pra cima
      // depois do scroll, tirando o cabeçalho de vista.
      setTimeout(() => {
        rootRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 320);
    }
  }

  return (
    <div
      ref={rootRef}
      class={cls.join(" ")}
      style={{ "--accent": accent } as Record<string, string>}
    >
      <button
        type="button"
        class="bf-team-row__summary"
        onClick={toggle}
        aria-expanded={open}
      >
        <span
          class={`bf-team-row__pos ${isLider ? "bf-team-row__pos--lider" : ""}`}
        >
          {posDelta !== null && posDelta !== 0 && (
            <span
              class={`bf-team-row__delta bf-team-row__delta--${
                posDelta > 0 ? "up" : "down"
              }`}
              title={posDelta > 0
                ? `Subiu ${posDelta} no ranking geral`
                : `Caiu ${Math.abs(posDelta)} no ranking geral`}
            >
              {posDelta > 0 ? "↑" : "↓"}
              {Math.abs(posDelta)}
            </span>
          )}
          {isLider
            ? (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-label="Líder"
                role="img"
              >
                {/* Copa: retângulo top, curvas internas embaixo (formato U invertido) */}
                <path d="M6 2h12v7a6 6 0 0 1-12 0V2Z" />
                {/* Alça esquerda */}
                <path d="M6 3.5H4a2.5 2.5 0 0 0 0 5h2V7H4.5a1 1 0 0 1 0-2H6V3.5Z" />
                {/* Alça direita (espelho) */}
                <path d="M18 3.5h2a2.5 2.5 0 0 1 0 5h-2V7h1.5a1 1 0 0 0 0-2H18V3.5Z" />
                {/* Haste */}
                <path d="M11 15h2v3h-2z" />
                {/* Base estreita */}
                <path d="M9 18h6v1.5H9z" />
                {/* Base larga */}
                <path d="M6 19.5h12v2H6z" />
              </svg>
            )
            : `#${pos}`}
        </span>
        <div class="bf-team-row__crest">
          <TeamCrest chave={chave} size={36} />
        </div>
        <div class="bf-team-row__meta">
          <div class="bf-team-row__name">{displayName}</div>
          <div class="bf-team-row__owner">{dono}</div>
        </div>
        {subsBadge && (
          <span
            class={`bf-team-row__subs ${
              subsBadge.aplicadas >= subsBadge.max
                ? "bf-team-row__subs--full"
                : ""
            }`}
            title={`${subsBadge.aplicadas} de ${subsBadge.max} substituições aplicadas`}
          >
            <span class="bf-team-row__subs-val">
              {subsBadge.aplicadas}/{subsBadge.max}
            </span>
            <span class="bf-team-row__subs-lbl">subs</span>
          </span>
        )}
        <div class="bf-team-row__pts">
          <div class="bf-team-row__pts-line">
            <span class="bf-team-row__pts-value">{totalFmt}</span>
            <span class="bf-team-row__pts-foot">{ptsLabel}</span>
          </div>
          {historico && Object.keys(historico).length >= 2 && (
            <div class="bf-team-row__sparkline">
              <Sparkline
                historico={historico}
                accent={accent}
                width={76}
                height={18}
              />
            </div>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bf-team-row__chev"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="bf-team-row__expanded-wrap" aria-hidden={!open}>
        <div class="bf-team-row__expanded-inner">
          {children}
        </div>
      </div>
    </div>
  );
}
