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
  /** Cor accent (hex) do time — tinge o gramado pra refletir o dono */
  accent?: string;
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
  const isEmpty = empty && !p.num && !p.cores && !p.foto;
  // Só usa foto se for cutout PNG transparente do TheSportsDB.
  // Local JPGs e API-Football trazem fundo inconsistente → usa camisa.
  const hasFotoReal = !!(p.foto && p.foto.includes("thesportsdb"));
  const cls = ["bf-pin"];
  if (isEmpty) cls.push("bf-pin--empty");
  const pts = showPoints && p.pts != null ? p.pts : null;
  const status = statusInfo(p.statusId);
  const cardStyle: Record<string, string> = {
    "--pos-color": COLOR_VAR[accent],
  };
  if (p.cores) {
    cardStyle["--team-primary"] = p.cores.primary;
    cardStyle["--team-secondary"] = p.cores.secondary;
  }

  return (
    <div class={cls.join(" ")} style={cardStyle}>
      {/* Cabeça flutuante acima do card */}
      <div class="bf-pin__head-wrap">
        {hasFotoReal
          ? <img class="bf-pin__head-img" src={p.foto!} alt="" loading="lazy" />
          : p.cores
          ? (
            <svg
              viewBox="0 0 100 100"
              class="bf-pin__head-jersey"
              aria-hidden="true"
            >
              <path d={JERSEY_BODY_PATH} fill="var(--team-primary)" />
              <g clip-path="url(#bf-jersey-body)">
                <PatternOverlay pattern={p.cores.pattern} />
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
          )
          : (
            <span class="bf-pin__head-placeholder">
              {isEmpty ? "+" : (p.num ?? "")}
            </span>
          )}
        {p.capt && <span class="bf-pin__capt-badge">C</span>}
      </div>

      {/* Corpo da carta */}
      <div class="bf-pin__card">
        <div class="bf-pin__row">
          {p.escudo && (
            <img
              class="bf-pin__card-escudo"
              src={p.escudo}
              alt=""
            />
          )}
          {p.nome && <span class="bf-pin__card-name">{p.nome}</span>}
          {status && (
            <span
              class="bf-pin__status-inline"
              style={{ "--st-color": status.cor } as Record<string, string>}
              title={status.title}
              aria-label={status.title}
            >
              {status.sym}
            </span>
          )}
        </div>
        {pts != null
          ? (
            <div
              class={`bf-pin__card-pts ${
                pts < 0 ? "bf-pin__card-pts--neg" : ""
              }`}
            >
              {pts > 0 ? "+" : ""}
              {pts.toFixed(1).replace(".", ",")}
            </div>
          )
          : p.pos && <div class="bf-pin__card-pos">{p.pos}</div>}
      </div>
    </div>
  );
}

export default function Field(
  { jogadores, showPoints = false, empty = false, accent }: Props,
) {
  const gk = jogadores?.gk ?? {};
  const def = jogadores?.def ?? [];
  const mid = jogadores?.mid ?? [];
  const ata = jogadores?.ata ?? [];
  const style = accent
    ? { "--field-tint": accent } as Record<string, string>
    : undefined;

  return (
    <div class="bf-field" style={style}>
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
