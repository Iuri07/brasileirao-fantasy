// Camisa estilizada como SVG — reaproveita as cores/pattern do clube.
// Usada como fallback visual quando não há cutout transparente do jogador.
//
// Depende do clipPath #bf-jersey-body global definido em routes/_app.tsx.

import type { CoresClube, CoresPattern } from "../lib/cores.ts";

const JERSEY_BODY_PATH =
  "M30 10 L8 22 L13 40 L27 40 L27 92 Q27 98 33 98 L67 98 Q73 98 73 92 L73 40 L87 40 L92 22 L70 10 L60 17 L50 22 L40 17 Z";
const COLLAR_PATH = "M30 10 L70 10 L60 17 L50 22 L40 17 Z";

function PatternOverlay({ pattern }: { pattern: CoresPattern }) {
  if (pattern === "vstripes") {
    return (
      <>
        <rect
          x="34"
          y="20"
          width="11"
          height="78"
          fill="var(--team-secondary)"
        />
        <rect
          x="55"
          y="20"
          width="11"
          height="78"
          fill="var(--team-secondary)"
        />
      </>
    );
  }
  if (pattern === "hstripes") {
    return (
      <>
        <rect
          x="20"
          y="28"
          width="60"
          height="10"
          fill="var(--team-secondary)"
        />
        <rect
          x="20"
          y="50"
          width="60"
          height="10"
          fill="var(--team-secondary)"
        />
        <rect
          x="20"
          y="72"
          width="60"
          height="10"
          fill="var(--team-secondary)"
        />
      </>
    );
  }
  if (pattern === "sash") {
    return (
      <polygon
        points="20,20 20,38 80,98 80,80"
        fill="var(--team-secondary)"
      />
    );
  }
  return null;
}

export default function JerseySvg(
  { cores, class: cls }: { cores: CoresClube; class?: string },
) {
  const style: Record<string, string> = {
    "--team-primary": cores.primary,
    "--team-secondary": cores.secondary,
  };
  return (
    <svg
      viewBox="0 0 100 100"
      class={cls}
      aria-hidden="true"
      style={style}
    >
      <path d={JERSEY_BODY_PATH} fill="var(--team-primary)" />
      <g clip-path="url(#bf-jersey-body)">
        <PatternOverlay pattern={cores.pattern} />
      </g>
      <path
        d={JERSEY_BODY_PATH}
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <path
        d={COLLAR_PATH}
        fill="var(--team-secondary)"
        stroke="rgba(0,0,0,0.55)"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}
