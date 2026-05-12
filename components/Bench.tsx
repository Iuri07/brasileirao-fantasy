import type { CoresClube } from "../lib/cores.ts";

interface BancoItem {
  atleta_id: number;
  apelido: string;
  posicao: string;
  foto: string | null;
  escudo?: string | null;
  cores?: CoresClube | null;
  /** Pontos da rodada — null/undefined se ainda não atuou */
  pontos?: number | null;
  /** Quando explicitamente sabemos que entrou em campo (live data) */
  entrouEmCampo?: boolean;
}

interface Props {
  jogadores: BancoItem[];
  /** Vazio mostra mensagem custom */
  empty?: string;
}

const POS_ABREV: Record<string, string> = {
  Goleiro: "GOL",
  Lateral: "LAT",
  Zagueiro: "ZAG",
  Meia: "MEI",
  Atacante: "ATK",
  Técnico: "TEC",
};

// Mesma lógica do Field: foto só vale quando é cutout transparente
// (TheSportsDB ou ogol salvo em /atletas/).
function isCutout(url: string | null | undefined): boolean {
  return !!url && (url.includes("thesportsdb") || url.startsWith("/atletas/"));
}

export default function Bench({ jogadores, empty = "Sem reservas" }: Props) {
  if (jogadores.length === 0) {
    return <div class="bf-empty-state">{empty}</div>;
  }
  return (
    <div class="bf-bench">
      {jogadores.map((j) => {
        const entrou = j.entrouEmCampo ??
          (j.pontos !== null && j.pontos !== undefined && j.pontos !== 0);
        const pts = j.pontos ?? 0;
        const posAbrev = POS_ABREV[j.posicao] ?? j.posicao;
        const hasCutout = isCutout(j.foto);
        const faceStyle = !hasCutout && j.cores
          ? {
            background:
              `linear-gradient(135deg, ${j.cores.primary}, ${j.cores.secondary})`,
          }
          : undefined;
        return (
          <div
            class={`bf-bench__item bf-bench__item--${posAbrev.toLowerCase()}`}
            key={j.atleta_id}
          >
            {hasCutout
              ? <img class="bf-bench__face" src={j.foto!} alt="" />
              : (
                <div
                  class="bf-bench__face bf-bench__face--jersey"
                  style={faceStyle}
                >
                  {j.escudo && (
                    <img class="bf-bench__face-escudo" src={j.escudo} alt="" />
                  )}
                </div>
              )}
            <span class="bf-bench__name">{j.apelido}</span>
            <span class="bf-bench__pos">{posAbrev}</span>
            {entrou
              ? (
                <span
                  class={`bf-bench__pts ${
                    pts < 0 ? "bf-bench__pts--neg" : ""
                  }`}
                >
                  {pts > 0 ? "+" : ""}
                  {pts.toFixed(1).replace(".", ",")}
                </span>
              )
              : <span class="bf-bench__bench">no banco</span>}
          </div>
        );
      })}
    </div>
  );
}
