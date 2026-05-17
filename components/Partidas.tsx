import type { CartolaClube, CartolaPartida } from "../lib/cartola.ts";

interface Props {
  partidas: CartolaPartida[];
  clubes: Record<string, CartolaClube>;
  /** Limita a quantos jogos exibir; default = todos */
  limit?: number;
}

/** Horário do jogo SEMPRE em America/Sao_Paulo (UTC-3 / UTC-2 horário
    de verão). Sem o `timeZone` explícito, `getHours()` usaria TZ do
    runtime — Deno Deploy roda em UTC e mostraria 3h adiantado. */
const FMT_HORARIO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatHorario(ts: number, partidaData: string): string {
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) {
    return partidaData?.slice(11, 16) ?? "—";
  }
  const parts = FMT_HORARIO.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // pt-BR weekday vem como "dom.", "seg.", etc — tira pontuação +
  // upper + 3 chars pra bater com o estilo anterior (DOM, SEG, ...).
  const dia = get("weekday").toUpperCase().replace(/[.,]/g, "").slice(0, 3);
  const hora = get("hour");
  const min = get("minute");
  return `${dia} ${hora}h${min === "00" ? "" : min}`;
}

function statusLabel(s: string): { txt: string; cls: string } {
  const up = (s ?? "").toUpperCase();
  if (up.includes("ANDAMENTO") || up.includes("AO VIVO")) {
    return { txt: "AO VIVO", cls: "bf-game-row__when--live" };
  }
  if (up.includes("ENCERRADA")) {
    return { txt: "FIM", cls: "bf-game-row__when--final" };
  }
  return { txt: "", cls: "" };
}

export default function Partidas({ partidas, clubes, limit }: Props) {
  if (!partidas?.length) {
    return <div class="bf-empty-state">Sem partidas pra esta rodada</div>;
  }

  const ordenadas = [...partidas]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, limit ?? partidas.length);

  return (
    <div class="bf-games">
      {ordenadas.map((p) => {
        const casa = clubes[String(p.clube_casa_id)];
        const fora = clubes[String(p.clube_visitante_id)];
        const encerrada = (p.status_transmissao_tr ?? "").toUpperCase()
          .includes("ENCERRADA");
        const aoVivo = (p.status_transmissao_tr ?? "").toUpperCase().includes(
          "ANDAMENTO",
        );
        const sl = statusLabel(p.status_transmissao_tr);
        const showScore = encerrada || aoVivo;
        return (
          <article class="bf-game-row" key={p.partida_id}>
            <div class={`bf-game-row__when ${sl.cls}`}>
              {sl.txt || formatHorario(p.timestamp, p.partida_data)}
            </div>
            <div class="bf-game-row__teams">
              <span class="bf-game-row__team">
                {casa?.escudos?.["30x30"] && (
                  <img
                    class="bf-game-row__shield"
                    src={casa.escudos["30x30"]}
                    alt=""
                  />
                )}
                <span>{casa?.abreviacao ?? "—"}</span>
              </span>
              {showScore
                ? (
                  <span class="bf-game-row__score">
                    {p.placar_oficial_mandante ?? 0}
                    <span class="bf-game-row__score-sep">×</span>
                    {p.placar_oficial_visitante ?? 0}
                  </span>
                )
                : <span class="bf-game-row__vs">vs</span>}
              <span class="bf-game-row__team bf-game-row__team--away">
                <span>{fora?.abreviacao ?? "—"}</span>
                {fora?.escudos?.["30x30"] && (
                  <img
                    class="bf-game-row__shield"
                    src={fora.escudos["30x30"]}
                    alt=""
                  />
                )}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
