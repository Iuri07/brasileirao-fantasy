import { useState } from "preact/hooks";

interface Jogador {
  atleta_id?: number;
  nome: string;
  posicao: string;
  pontuacao: number;
  escalacao: "Sim" | "Banco" | "Não";
  status_id?: number | null;
  clube?: string;
  substituido?: boolean;
  entrou_em_campo?: boolean | null;
}

interface Props {
  jogadores: Jogador[];
  modoAoVivo?: boolean;
  corTime?: string;
  campoBg?: string;
  escudo?: string;
}

function CampoSVG() {
  const s = "rgba(255,255,255,0.18)";
  const d = "rgba(255,255,255,0.10)";
  const g = "rgba(255,255,255,0.04)";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" preserveAspectRatio="none" class="campo-svg-bg" aria-hidden="true">
      <rect x="12" y="16" width="276" height="418" fill="none" stroke={s} strokeWidth="2"/>
      <line x1="12" y1="225" x2="288" y2="225" stroke={s} strokeWidth="1.5"/>
      <circle cx="150" cy="225" r="44" fill="none" stroke={s} strokeWidth="1.5"/>
      <circle cx="150" cy="225" r="2.5" fill={d}/>
      <rect x="76" y="16" width="148" height="66" fill="none" stroke={s} strokeWidth="1.5"/>
      <rect x="111" y="16" width="78" height="28" fill="none" stroke={s} strokeWidth="1.5"/>
      <circle cx="150" cy="64" r="2" fill={d}/>
      <rect x="76" y="368" width="148" height="66" fill="none" stroke={s} strokeWidth="1.5"/>
      <rect x="111" y="406" width="78" height="28" fill="none" stroke={s} strokeWidth="1.5"/>
      <circle cx="150" cy="386" r="2" fill={d}/>
      <path d="M 23 16 A 11 11 0 0 1 12 27" fill="none" stroke={s} strokeWidth="1.5"/>
      <path d="M 277 16 A 11 11 0 0 0 288 27" fill="none" stroke={s} strokeWidth="1.5"/>
      <path d="M 12 423 A 11 11 0 0 0 23 434" fill="none" stroke={s} strokeWidth="1.5"/>
      <path d="M 288 423 A 11 11 0 0 1 277 434" fill="none" stroke={s} strokeWidth="1.5"/>
      <rect x="113" y="8" width="74" height="10" fill={g} stroke={s} strokeWidth="1"/>
      <rect x="113" y="432" width="74" height="10" fill={g} stroke={s} strokeWidth="1"/>
    </svg>
  );
}

const POSICAO_ABREV: Record<string, string> = {
  "Goleiro":  "GOL",
  "Zagueiro": "ZAG",
  "Lateral":  "LAT",
  "Meia":     "MEI",
  "Atacante": "ATK",
  "Técnico":  "TEC",
};

function statusInfo(id?: number | null): { sym: string; cor: string } | null {
  switch (id) {
    case 7: return { sym: "✓", cor: "#00e676" };
    case 2: return { sym: "?", cor: "#ef4444" };
    case 3: return { sym: "✕", cor: "#ef4444" };
    case 5: return { sym: "+", cor: "#ef4444" };
    case 6: return { sym: "–", cor: "#9ca3af" };
    default: return null;
  }
}

const CDN = "https://cdn.jsdelivr.net/gh/Ian-costermani/brasileirao-fantasy@master/static";

function toSlug(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function abreviarNome(nome: string): string {
  const partes = nome.trim().split(" ");
  const temParentese = partes.some((p) => p.startsWith("(") || p.endsWith(")"));
  if (temParentese) {
    const primeiro = partes.find((p) => !p.startsWith("(") && !p.endsWith(")") && p.length > 1);
    return (primeiro ?? partes[0]).substring(0, 10).toUpperCase();
  }
  if (partes.length === 1) return partes[0].substring(0, 10).toUpperCase();
  const inicial = partes[0][0].toUpperCase();
  const significativas = partes.filter((p) => p.length > 2);
  const sobrenome = significativas.length > 0 ? significativas[significativas.length - 1] : partes[partes.length - 1];
  return `${inicial}. ${sobrenome.substring(0, 8).toUpperCase()}`;
}

function PlayerCard(
  { jogador, modoAoVivo, fraco, corTime }: { jogador: Jogador; modoAoVivo: boolean; fraco: boolean; corTime: string },
) {
  const [fotoOk, setFotoOk] = useState(false);
  const slugNome = toSlug(jogador.nome);
  const slugClube = jogador.clube ? toSlug(jogador.clube) : null;
  const [fotoSrc, setFotoSrc] = useState(`${CDN}/players/${slugNome}.webp`);
  const sInfo = statusInfo(jogador.status_id);
  const temPts = jogador.pontuacao > 0;
  const escudoSrc = jogador.clube ? `${CDN}/escudos/${toSlug(jogador.clube)}.jpg` : null;
  const neonStyle = `border-color:${corTime}`;

  return (
    <div class={`campo-jogador${fraco ? " campo-jogador-fraco" : ""}`}>
      <div class="campo-player-card">
        <div class="campo-player-foto-wrap">
          {modoAoVivo && jogador.substituido && (
            <span class="campo-sub-badge">SUB</span>
          )}
          <img
            src={fotoSrc}
            alt=""
            class="campo-player-foto"
            style={fotoOk ? "" : "display:none"}
            onLoad={() => setFotoOk(true)}
            onError={() => {
              if (fotoSrc === `${CDN}/players/${slugNome}.webp`) setFotoSrc(`${CDN}/players/${slugNome}.jpg`);
              else if (fotoSrc === `${CDN}/players/${slugNome}.jpg`) setFotoSrc(`${CDN}/players/${slugNome}.png`);
              else if (fotoSrc === `${CDN}/players/${slugNome}.png` && slugClube) setFotoSrc(`${CDN}/players/${slugNome}-${slugClube}.webp`);
              else if (slugClube && fotoSrc === `${CDN}/players/${slugNome}-${slugClube}.webp`) setFotoSrc(`${CDN}/players/${slugNome}-${slugClube}.jpg`);
              else if (slugClube && fotoSrc === `${CDN}/players/${slugNome}-${slugClube}.jpg`) setFotoSrc(`${CDN}/players/${slugNome}-${slugClube}.png`);
            }}
          />
          {escudoSrc && (
            <img
              src={escudoSrc}
              alt=""
              class="campo-avatar-escudo"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          {sInfo && (
            <span class="campo-status-sym" style={`color:${sInfo.cor}`}>{sInfo.sym}</span>
          )}
        </div>
        <div class="campo-player-box" style={neonStyle}>
          <span class="campo-player-nome">{abreviarNome(jogador.nome)}</span>
          {modoAoVivo
            ? <span class={`campo-player-pos${temPts ? " campo-pts-verde" : " campo-pts-zero"}`}>{temPts ? `+${jogador.pontuacao.toFixed(1)}` : "—"}</span>
            : <span class="campo-player-pos">{POSICAO_ABREV[jogador.posicao] ?? jogador.posicao}</span>
          }
        </div>
      </div>
    </div>
  );
}

export function CampoFutebol({ jogadores, modoAoVivo = false, corTime = "#ffffff", campoBg, escudo }: Props) {
  const titulares = jogadores.filter((j) => j.escalacao === "Sim");
  const banco = jogadores.filter((j) => j.escalacao === "Banco");

  const goleiros  = titulares.filter((j) => j.posicao === "Goleiro");
  const zagueiros = titulares.filter((j) => j.posicao === "Zagueiro");
  const laterais  = titulares.filter((j) => j.posicao === "Lateral");
  const meias     = titulares.filter((j) => j.posicao === "Meia");
  const atacantes = titulares.filter((j) => j.posicao === "Atacante");
  const tecnicos  = titulares.filter((j) => j.posicao === "Técnico");

  const linhaDefesa: Jogador[] = laterais.length > 0
    ? [laterais[0], ...zagueiros, ...(laterais.length > 1 ? [laterais[1]] : [])]
    : zagueiros;

  const rows: { jogadores: Jogador[]; key: string }[] = [
    { jogadores: atacantes,                  key: "atk" },
    { jogadores: meias,                      key: "mid" },
    { jogadores: linhaDefesa,                key: "def" },
    { jogadores: [...goleiros, ...tecnicos], key: "gol" },
  ];

  return (
    <div class="campo-wrapper">
      <div class="campo-fundo">
        {campoBg
          ? <img src={campoBg} alt="" class="campo-svg-bg" aria-hidden="true" />
          : <CampoSVG />}
        {escudo && (
          <img src={escudo} alt="" class="campo-escudo-time" aria-hidden="true" />
        )}
        {rows.map((row) => (
          <div key={row.key} class={`campo-row campo-row-${row.key}`}>
            {row.jogadores.map((j) => (
              <PlayerCard
                key={j.atleta_id ?? j.nome}
                jogador={j}
                modoAoVivo={modoAoVivo}
                fraco={modoAoVivo && j.pontuacao === 0}
                corTime={corTime}
              />
            ))}
          </div>
        ))}
      </div>

      {banco.length > 0 && (
        <div class="campo-banco">
          <span class="campo-banco-label">Banco de Reservas</span>
          <div class="campo-banco-jogadores">
            {banco.map((j) => (
              <PlayerCard key={j.atleta_id ?? j.nome} jogador={j} modoAoVivo={modoAoVivo} fraco corTime={corTime} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
