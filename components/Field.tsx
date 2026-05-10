export type Posicao = "gol" | "lat" | "zag" | "mei" | "ata";

export interface Pino {
  nome?: string;
  num?: string;
  capt?: boolean;
  pts?: number | null;
  escudo?: string | null;
  foto?: string | null;
  pos?: string;
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
  const isEmpty = empty && !p.num && !p.foto;
  const cls = ["bf-pin"];
  if (isEmpty) cls.push("bf-pin--empty");
  const shirtCls = ["bf-pin__shirt"];
  if (p.capt) shirtCls.push("bf-pin__shirt--captain");
  const pts = showPoints && p.pts != null ? p.pts : null;
  const shirtStyle: Record<string, string> = {
    "--shirt-color": COLOR_VAR[accent],
  };

  return (
    <div class={cls.join(" ")}>
      <div class={shirtCls.join(" ")} style={shirtStyle}>
        {p.foto
          ? <img class="bf-pin__shirt-img" src={p.foto} alt="" />
          : (isEmpty ? "+" : (p.num ?? ""))}
      </div>
      {p.nome && (
        <div class="bf-pin__name">
          {p.escudo && (
            <img class="bf-pin__name-escudo" src={p.escudo} alt="" />
          )}
          <span>{p.nome}</span>
        </div>
      )}
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
