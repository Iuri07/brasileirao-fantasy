export type Posicao = "gol" | "lat" | "zag" | "mei" | "ata";

export type CoresPattern = "solid" | "vstripes" | "hstripes" | "sash";

export interface Pino {
  nome?: string;
  num?: string;
  capt?: boolean;
  pts?: number | null;
  escudo?: string | null;
  pos?: string;
  cores?: { primary: string; secondary: string; pattern: CoresPattern };
  /** status_id Cartola: 7=provável, 2=dúvida, 3=suspenso, 5=contundido, 6=nulo */
  statusId?: number | null;
  /** URL da foto do atleta (CDN Cartola) */
  foto?: string | null;
}

interface StatusBadge {
  sym: string;
  cor: string;
  title: string;
}

function statusInfo(id: number | null | undefined): StatusBadge | null {
  switch (id) {
    case 7:
      return { sym: "✓", cor: "var(--bf-lime)", title: "Provável" };
    case 2:
      return { sym: "?", cor: "var(--bf-yellow)", title: "Dúvida" };
    case 3:
      return { sym: "✕", cor: "var(--bf-red)", title: "Suspenso" };
    case 5:
      return { sym: "+", cor: "var(--bf-red)", title: "Contundido" };
    case 6:
      return { sym: "–", cor: "var(--bf-fg-3)", title: "Nulo" };
    default:
      return null;
  }
}

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

export interface Escalacao {
  gk: Pino;
  def: Pino[];
  mid: Pino[];
  ata: Pino[];
}

interface Props {
  jogadores?: Partial<Escalacao>;
  showPoints?: boolean;
  empty?: boolean;
}

const COLOR_VAR: Record<"yellow" | "blue" | "magenta" | "orange", string> = {
  yellow: "var(--bf-yellow)",
  blue: "var(--bf-blue)",
  magenta: "var(--bf-magenta)",
  orange: "var(--bf-orange)",
};

function PlayerPin(
  { p, accent, showPoints, empty }: {
    p: Pino;
    accent: keyof typeof COLOR_VAR;
    showPoints: boolean;
    empty: boolean;
  },
) {
  const isEmpty = empty && !p.num && !p.cores;
  const cls = ["bf-pin"];
  if (isEmpty) cls.push("bf-pin--empty");
  const pts = showPoints && p.pts != null ? p.pts : null;
  const shirtStyle: Record<string, string> = {};
  if (p.cores) {
    shirtStyle["--team-primary"] = p.cores.primary;
    shirtStyle["--team-secondary"] = p.cores.secondary;
  }

  return (
    <div class={cls.join(" ")}>
      <div class="bf-pin__shirt" style={shirtStyle}>
        {p.cores
          ? (
            <svg
              viewBox="0 0 100 100"
              class="bf-pin__jersey"
              aria-hidden="true"
            >
              {/* 1. Corpo da camisa, fill primary */}
              <path d={JERSEY_BODY_PATH} fill="var(--team-primary)" />
              {/* 2. Padrão (listras/sash) clipado pra ficar dentro do corpo */}
              <g clip-path="url(#bf-jersey-body)">
                <PatternOverlay pattern={p.cores.pattern} />
              </g>
              {/* 3. Outline por cima pra contorno crisp */}
              <path
                d={JERSEY_BODY_PATH}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                stroke-width="3"
                stroke-linejoin="round"
              />
              {/* 4. Gola na cor secundária */}
              <path
                d={COLLAR_PATH}
                fill="var(--team-secondary)"
                stroke="rgba(0,0,0,0.55)"
                stroke-width="2"
                stroke-linejoin="round"
              />
            </svg>
          )
          : (
            <span class="bf-pin__placeholder">
              {isEmpty ? "+" : (p.num ?? "")}
            </span>
          )}
        {p.escudo && <img class="bf-pin__shirt-escudo" src={p.escudo} alt="" />}
        {p.capt && <span class="bf-pin__capt-badge">C</span>}
        {(() => {
          const s = statusInfo(p.statusId);
          return s
            ? (
              <span
                class="bf-pin__status-badge"
                style={{ "--st-color": s.cor } as Record<string, string>}
                title={s.title}
                aria-label={s.title}
              >
                {s.sym}
              </span>
            )
            : null;
        })()}
      </div>
      {p.nome && <div class="bf-pin__name">{p.nome}</div>}
      {p.pos && (
        <div
          class="bf-pin__pos"
          style={{ "--pos-color": COLOR_VAR[accent] } as Record<string, string>}
        >
          {p.pos}
        </div>
      )}
      {pts != null && (
        <div class={`bf-pin__pts ${pts < 0 ? "bf-pin__pts--neg" : ""}`}>
          {pts > 0 ? "+" : ""}
          {pts}
        </div>
      )}
    </div>
  );
}

export default function Field(
  { jogadores, showPoints = false, empty = false }: Props,
) {
  const gk = jogadores?.gk ?? {};
  const def = jogadores?.def ?? [];
  const mid = jogadores?.mid ?? [];
  const ata = jogadores?.ata ?? [];

  return (
    <div class="bf-field">
      <svg
        class="bf-field__lines"
        viewBox="0 0 100 140"
        preserveAspectRatio="none"
      >
        <rect x="2" y="2" width="96" height="136" rx="1" />
        <line x1="2" y1="70" x2="98" y2="70" />
        <circle cx="50" cy="70" r="10" />
        <rect x="22" y="2" width="56" height="14" />
        <rect x="34" y="2" width="32" height="6" />
        <rect x="22" y="124" width="56" height="14" />
        <rect x="34" y="132" width="32" height="6" />
        <path d="M 42 16 A 8 8 0 0 0 58 16" />
        <path d="M 42 124 A 8 8 0 0 1 58 124" />
      </svg>
      <div class="bf-field__row bf-field__row--gk">
        <PlayerPin
          p={gk}
          accent="yellow"
          showPoints={showPoints}
          empty={empty}
        />
      </div>
      <div class="bf-field__row bf-field__row--def">
        {def.map((p, i) => (
          <PlayerPin
            key={i}
            p={p}
            accent="blue"
            showPoints={showPoints}
            empty={empty}
          />
        ))}
      </div>
      <div class="bf-field__row bf-field__row--mid">
        {mid.map((p, i) => (
          <PlayerPin
            key={i}
            p={p}
            accent="magenta"
            showPoints={showPoints}
            empty={empty}
          />
        ))}
      </div>
      <div class="bf-field__row bf-field__row--ata">
        {ata.map((p, i) => (
          <PlayerPin
            key={i}
            p={p}
            accent="orange"
            showPoints={showPoints}
            empty={empty}
          />
        ))}
      </div>
    </div>
  );
}
