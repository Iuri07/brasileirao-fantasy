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
  /** ID do atleta — usado pra callbacks de seleção (opcional pra pins
      decorativos sem identidade) */
  atletaId?: number;
  /** Entrou em campo como sub automática (bench → escala) */
  subEntrou?: boolean;
  /** Era titular, foi rebaixado pelo auto-sub (escala → bench) */
  subSaiu?: boolean;
  /** Live: jogador está atualmente em campo (Cartola entrou_em_campo). */
  emCampo?: boolean;
}

export interface StatusBadge {
  sym: string;
  cor: string;
  title: string;
}

export function statusInfo(
  id: number | null | undefined,
): StatusBadge | null {
  switch (id) {
    case 7:
      return { sym: "✓", cor: "var(--bf-lime)", title: "Provável" };
    case 2:
      return { sym: "?", cor: "var(--bf-yellow)", title: "Dúvida" };
    case 3:
      return { sym: "✕", cor: "var(--bf-red)", title: "Suspenso" };
    case 5:
      return { sym: "✚", cor: "var(--bf-red)", title: "Contundido" };
    case 6:
      return { sym: "−", cor: "var(--bf-fg-3)", title: "Nulo" };
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
  /** Reservas — renderizados em row compacta abaixo do gramado */
  banco?: BancoPino[];
  /** Callback ao clicar num pino (precisa de Pino.atletaId) */
  onSelect?: (atletaId: number) => void;
  /** Atleta atualmente selecionado — destaca o pino */
  selecionado?: number;
  /** Predicado pra marcar pinos como alvos válidos da troca */
  compativelCom?: (p: Pino) => boolean;
  /** Modo "ao vivo": esconde badges de status (provável/dúvida/etc) e
      mostra apenas indicadores relevantes durante a partida (subs +
      bolinha verde de "em campo"). */
  liveMode?: boolean;
  /** Controle explícito do badge de status (provável/dúvida/etc).
      Default true. Em liveMode é forçado false. /liga histórica usa
      false pra ficar "limpa" — só escalação + posições, sem dados. */
  showStatus?: boolean;
  /** Mostra label de posição (LAT/ZAG/etc) embaixo do nome no pino.
      Default true. /liga usa false (a posição já é óbvia pela linha
      do pino no campo), mas o campo `pos` ainda chega no Field pra
      separar laterais de zagueiros no layout. */
  showPosLabel?: boolean;
}

export interface BancoPino extends Pino {
  /** Posição original do jogador (Goleiro/Lateral/etc) — define a cor do pin */
  posicao?: string;
  /** Live: explicitamente entrou em campo (sub feita) */
  entrouEmCampo?: boolean;
}

const COLOR_VAR: Record<"yellow" | "blue" | "magenta" | "orange", string> = {
  yellow: "var(--bf-yellow)",
  blue: "var(--bf-blue)",
  magenta: "var(--bf-magenta)",
  orange: "var(--bf-orange)",
};

function PlayerPin(
  {
    p,
    accent,
    showPoints,
    empty,
    onSelect,
    selecionado,
    compativel,
    liveMode = false,
    showStatus = true,
    showPosLabel = true,
  }: {
    p: Pino;
    accent: keyof typeof COLOR_VAR;
    showPoints: boolean;
    empty: boolean;
    onSelect?: (atletaId: number) => void;
    selecionado?: boolean;
    compativel?: boolean;
    liveMode?: boolean;
    showStatus?: boolean;
    showPosLabel?: boolean;
  },
) {
  const isEmpty = empty && !p.num && !p.cores && !p.foto;
  // Só usa foto se for cutout PNG transparente: TheSportsDB ou ogol
  // (salvo localmente em /static/atletas/{id}.png). Fotos com fundo
  // inconsistente (Cartola silhuetas, API-Football, JPG local) → camisa.
  const hasFotoReal = !!(p.foto &&
    (p.foto.includes("thesportsdb") || p.foto.includes("/atletas/")));
  const cls = ["bf-pin"];
  if (isEmpty) cls.push("bf-pin--empty");
  if (selecionado) cls.push("bf-pin--selecionado");
  if (compativel) cls.push("bf-pin--compativel");
  const interativo = !!onSelect && p.atletaId != null;
  if (interativo) cls.push("bf-pin--interativo");
  const pts = showPoints && p.pts != null ? p.pts : null;
  const status = statusInfo(p.statusId);
  const cardStyle: Record<string, string> = {
    "--pos-color": COLOR_VAR[accent],
  };
  if (p.cores) {
    cardStyle["--team-primary"] = p.cores.primary;
    cardStyle["--team-secondary"] = p.cores.secondary;
  }

  const handleClick = interativo ? () => onSelect!(p.atletaId!) : undefined;
  return (
    <div
      class={cls.join(" ")}
      style={cardStyle}
      onClick={handleClick}
      role={interativo ? "button" : undefined}
      tabIndex={interativo ? 0 : undefined}
      data-atleta-id={p.atletaId ?? undefined}
    >
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

      {
        /* Badges sobrepostos à cabeça — fora do card pra escapar do seu
          stacking context */
      }
      {p.escudo && (
        <img
          class="bf-pin__badge bf-pin__badge--escudo"
          src={p.escudo}
          alt=""
        />
      )}
      {
        /* Status (provável/dúvida/etc) — só fora do live e quando
          showStatus permite. Durante a rodada essa info perde sentido;
          o que importa é se entrou em campo ou foi substituído. /liga
          desabilita explicitamente (escalação "limpa"). */
      }
      {!liveMode && showStatus && status && (
        <span
          class="bf-pin__badge bf-pin__badge--status"
          style={{ "--st-color": status.cor } as Record<string, string>}
          title={status.title}
          aria-label={status.title}
        >
          {status.sym}
        </span>
      )}
      {
        /* Bolinha verde discreta — confirma que o jogador está em campo
          AGORA. Só faz sentido no live e quando não foi substituído
          (subEntrou/subSaiu já transmitem essa info). */
      }
      {liveMode && p.emCampo && !p.subEntrou && !p.subSaiu && (
        <span
          class="bf-pin__badge bf-pin__badge--em-campo"
          title="Em campo"
          aria-label="Em campo"
        />
      )}
      {p.subEntrou && (
        <span
          class="bf-pin__badge bf-pin__badge--sub-in"
          title="Entrou na auto-substituição"
          aria-label="Entrou"
        >
          ↑
        </span>
      )}
      {p.subSaiu && (
        <span
          class="bf-pin__badge bf-pin__badge--sub-out"
          title="Saiu na auto-substituição"
          aria-label="Saiu"
        >
          ↓
        </span>
      )}

      {/* Corpo da carta */}
      <div class="bf-pin__card">
        {p.nome && <span class="bf-pin__card-name">{p.nome}</span>}
        {showPosLabel && p.pos && <div class="bf-pin__card-pos">{p.pos}</div>}
        {pts != null && (
          <div
            class={`bf-pin__card-pts ${pts < 0 ? "bf-pin__card-pts--neg" : ""}`}
          >
            {pts > 0 ? "+" : ""}
            {pts.toFixed(1).replace(".", ",")}
          </div>
        )}
      </div>
    </div>
  );
}

const POS_TO_ACCENT: Record<string, keyof typeof COLOR_VAR> = {
  Goleiro: "yellow",
  Lateral: "blue",
  Zagueiro: "blue",
  Meia: "magenta",
  Atacante: "orange",
};

export default function Field(
  {
    jogadores,
    showPoints = false,
    empty = false,
    accent,
    banco,
    onSelect,
    selecionado,
    compativelCom,
    liveMode = false,
    showStatus = true,
    showPosLabel = true,
  }: Props,
) {
  const gk = jogadores?.gk ?? {};
  const defRaw = jogadores?.def ?? [];
  const mid = jogadores?.mid ?? [];
  const ata = jogadores?.ata ?? [];
  // Defesa: laterais nas pontas, zagueiros no meio (LAT, ZAG, ZAG, ZAG, LAT)
  const lats = defRaw.filter((p) => p.pos === "LAT");
  const zags = defRaw.filter((p) => p.pos !== "LAT");
  const def: Pino[] = [];
  if (lats[0]) def.push(lats[0]);
  def.push(...zags);
  if (lats[1]) def.push(lats[1]);
  for (let i = 2; i < lats.length; i++) def.push(lats[i]);
  const style = accent
    ? { "--field-tint": accent } as Record<string, string>
    : undefined;
  const pinProps = (p: Pino) => ({
    onSelect,
    selecionado:
      !!(onSelect && p.atletaId != null && p.atletaId === selecionado),
    compativel: !!(compativelCom && compativelCom(p)),
  });

  return (
    <div class="bf-field" style={style}>
      <div class="bf-field__pitch">
        {/* Linhas do campo em DUAS versões — portrait (5/8, mobile) e
            landscape (8/5, desktop). CSS decide qual aparece via
            media query. */}
        <svg
          class="bf-field__lines bf-field__lines--portrait"
          viewBox="0 0 100 160"
          preserveAspectRatio="none"
        >
          <rect x="2" y="2" width="96" height="156" rx="1" />
          <line x1="2" y1="80" x2="98" y2="80" />
          <circle cx="50" cy="80" r="10" />
          <rect x="22" y="2" width="56" height="14" />
          <rect x="34" y="2" width="32" height="6" />
          <rect x="22" y="144" width="56" height="14" />
          <rect x="34" y="152" width="32" height="6" />
          <path d="M 42 16 A 8 8 0 0 0 58 16" />
          <path d="M 42 144 A 8 8 0 0 1 58 144" />
        </svg>
        <svg
          class="bf-field__lines bf-field__lines--landscape"
          viewBox="0 0 160 100"
          preserveAspectRatio="none"
        >
          <rect x="2" y="2" width="156" height="96" rx="1" />
          <line x1="80" y1="2" x2="80" y2="98" />
          <circle cx="80" cy="50" r="10" />
          {/* Áreas: ATA fica à esquerda (penaliza o adversário),
              GK fica à direita defendendo. */}
          <rect x="2" y="22" width="14" height="56" />
          <rect x="2" y="34" width="6" height="32" />
          <rect x="144" y="22" width="14" height="56" />
          <rect x="152" y="34" width="6" height="32" />
          <path d="M 16 42 A 8 8 0 0 1 16 58" />
          <path d="M 144 42 A 8 8 0 0 0 144 58" />
        </svg>
        <div class="bf-field__row bf-field__row--gk">
          <PlayerPin
            p={gk}
            accent="yellow"
            showPoints={showPoints}
            empty={empty}
            liveMode={liveMode}
            showStatus={showStatus}
            showPosLabel={showPosLabel}
            {...pinProps(gk)}
          />
        </div>
        <div class="bf-field__row bf-field__row--def">
          {def.map((p, i) => (
            <PlayerPin
              key={p.atletaId ?? i}
              p={p}
              accent="blue"
              showPoints={showPoints}
              empty={empty}
              liveMode={liveMode}
              showStatus={showStatus}
              showPosLabel={showPosLabel}
              {...pinProps(p)}
            />
          ))}
        </div>
        <div class="bf-field__row bf-field__row--mid">
          {mid.map((p, i) => (
            <PlayerPin
              key={p.atletaId ?? i}
              p={p}
              accent="magenta"
              showPoints={showPoints}
              empty={empty}
              liveMode={liveMode}
              showStatus={showStatus}
              showPosLabel={showPosLabel}
              {...pinProps(p)}
            />
          ))}
        </div>
        <div class="bf-field__row bf-field__row--ata">
          {ata.map((p, i) => (
            <PlayerPin
              key={p.atletaId ?? i}
              p={p}
              accent="orange"
              showPoints={showPoints}
              empty={empty}
              liveMode={liveMode}
              showStatus={showStatus}
              showPosLabel={showPosLabel}
              {...pinProps(p)}
            />
          ))}
        </div>
      </div>
      {banco && banco.length > 0 && (
        <div class="bf-field__bench">
          <div class="bf-field__bench-label">Banco de reservas</div>
          <div class="bf-field__bench-row">
            {banco.map((p, i) => {
              const posAccent = POS_TO_ACCENT[p.posicao ?? ""] ?? "magenta";
              const hideP = !p.entrouEmCampo &&
                !(p.pts !== null && p.pts !== undefined && p.pts !== 0);
              // Banco: propaga entrouEmCampo → emCampo pro PlayerPin
              // renderizar a bolinha verde no live mode.
              const pAjustado: Pino = hideP
                ? { ...p, pts: null, emCampo: p.entrouEmCampo }
                : { ...p, emCampo: p.entrouEmCampo };
              return (
                <PlayerPin
                  key={p.atletaId ?? i}
                  p={pAjustado}
                  accent={posAccent}
                  showPoints={showPoints}
                  empty={empty}
                  liveMode={liveMode}
                  showStatus={showStatus}
                  {...pinProps(pAjustado)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
