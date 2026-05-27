// Bump chart — posição (rank) por rodada. Y invertido (1 = topo).
// Cada time tem uma linha na cor accent dele.
//
// Mobile: detail panel + legenda fixos abaixo, tap num ponto preenche.
// Desktop: tooltip flutuante no hover, sem painel nem legenda (limpo).
// O state é o mesmo nos dois — CSS decide qual UI mostrar via media
// query (.bf-league-chart__detail e __legend escondem em ≥1024px;
// .bf-league-chart__tooltip esconde abaixo).

import { useState } from "preact/hooks";

export interface LinhaTime {
  chave: string;
  nome: string;
  accent: string;
  pontosPorRodada: Record<string, number>;
  /** Path do logo do time (PNG transparente) */
  logo?: string | null;
}

interface Props {
  times: LinhaTime[];
  /** Destacar uma chave específica — outras ficam dimmed */
  destaque?: string;
}

const W = 360;
const H = 220;
const PAD_L = 14;
const PAD_R = 28; // espaço pros crests no fim das linhas
const PAD_T = 14;
const PAD_B = 22;

export default function LeagueChart({ times, destaque }: Props) {
  // Coleta rodadas presentes em qualquer time
  const rodadasSet = new Set<number>();
  for (const t of times) {
    for (const [r, p] of Object.entries(t.pontosPorRodada)) {
      if (p > 0) rodadasSet.add(Number(r));
    }
  }
  const rodadas = [...rodadasSet].sort((a, b) => a - b);
  if (rodadas.length < 2) {
    return <div class="bf-empty-state">Aguardando dados de rodadas</div>;
  }

  // Pra cada rodada, ranquear times pelo total acumulado até essa rodada
  // → posicao[chave][rodada] = 1..N
  const N = times.length;
  const totais: Record<string, number> = {};
  for (const t of times) totais[t.chave] = 0;
  const rankByTeamRound: Record<string, Record<number, number>> = {};
  for (const t of times) rankByTeamRound[t.chave] = {};

  for (const r of rodadas) {
    for (const t of times) {
      totais[t.chave] += t.pontosPorRodada[String(r)] ?? 0;
    }
    const sorted = [...times].sort((a, b) => totais[b.chave] - totais[a.chave]);
    sorted.forEach((t, i) => {
      rankByTeamRound[t.chave][r] = i + 1;
    });
  }

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xFor = (i: number) =>
    PAD_L +
    (rodadas.length === 1 ? innerW / 2 : (i * innerW) / (rodadas.length - 1));
  // Y invertido: rank 1 = topo (PAD_T), rank N = base
  const yFor = (rank: number) => PAD_T + ((rank - 1) / (N - 1)) * innerH;

  const [hover, setHover] = useState<
    null | { chave: string; rodada: number; x: number; y: number }
  >(null);

  // Ordem de renderização: destaque por último pra ficar por cima
  const ordered = [...times].sort((a, b) => {
    if (a.chave === destaque) return 1;
    if (b.chave === destaque) return -1;
    return 0;
  });

  const hoverTime = hover ? times.find((t) => t.chave === hover.chave) : null;
  const hoverRank = hover && hoverTime
    ? rankByTeamRound[hoverTime.chave][hover.rodada]
    : null;
  const hoverPts = hover && hoverTime
    ? hoverTime.pontosPorRodada[String(hover.rodada)] ?? 0
    : null;

  return (
    <div class="bf-league-chart">
      <div class="bf-league-chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          class="bf-league-chart__svg"
          role="img"
          aria-label="Evolução da posição no ranking por rodada"
        >
          {/* Linhas horizontais de cada posição (1 até N) */}
          {Array.from({ length: N }, (_, i) => i + 1).map((rank) => (
            <line
              key={rank}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(rank)}
              y2={yFor(rank)}
              stroke="rgba(255,255,255,0.04)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          ))}

          {/* Labels Y — número da posição à esquerda */}
          {Array.from({ length: N }, (_, i) => i + 1).map((rank) => (
            <text
              key={rank}
              x={PAD_L - 4}
              y={yFor(rank) + 3}
              text-anchor="end"
              class="bf-league-chart__y-label"
            >
              {rank}
            </text>
          ))}

          {/* Labels X — número da rodada */}
          {rodadas.map((r, i) => (
            <text
              key={r}
              x={xFor(i)}
              y={H - PAD_B + 14}
              text-anchor="middle"
              class="bf-league-chart__x-label"
            >
              R{r}
            </text>
          ))}

          {/* Linhas de cada time */}
          {ordered.map((t) => {
            const isDestaque = t.chave === destaque;
            const pts = rodadas.map((r, i) => ({
              x: xFor(i),
              y: yFor(rankByTeamRound[t.chave][r] ?? N),
              rank: rankByTeamRound[t.chave][r] ?? N,
              rodada: r,
            }));
            const lastPt = pts[pts.length - 1];
            return (
              <g
                key={t.chave}
                opacity={destaque && !isDestaque ? "0.5" : "1"}
              >
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={t.accent}
                  stroke-width={isDestaque ? 3 : 1.5}
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
                {pts.map((p) => {
                  const isHover = hover &&
                    hover.chave === t.chave &&
                    hover.rodada === p.rodada;
                  return (
                    <g key={p.rodada}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={isHover ? 3 : isDestaque ? 2.5 : 2}
                        fill={t.accent}
                        stroke="var(--bf-chassis)"
                        stroke-width={isDestaque ? 1.5 : 1}
                        pointer-events="none"
                        vector-effect="non-scaling-stroke"
                      />
                      {/* Hit target invisível — 10px radius pra hover/tap
                          confortável sem disputar área com pontos vizinhos */}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="10"
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() =>
                          setHover({
                            chave: t.chave,
                            rodada: p.rodada,
                            x: p.x,
                            y: p.y,
                          })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() =>
                          setHover((h) =>
                            h && h.chave === t.chave && h.rodada === p.rodada
                              ? null
                              : {
                                chave: t.chave,
                                rodada: p.rodada,
                                x: p.x,
                                y: p.y,
                              }
                          )}
                      />
                    </g>
                  );
                })}
                {/* Crest no fim da linha */}
                {t.logo && (
                  <image
                    href={t.logo}
                    x={lastPt.x + 4}
                    y={lastPt.y - 9}
                    width="18"
                    height="18"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() =>
                      setHover({
                        chave: t.chave,
                        rodada: rodadas[rodadas.length - 1],
                        x: lastPt.x,
                        y: lastPt.y,
                      })}
                    onMouseLeave={() => setHover(null)}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* DESKTOP-ONLY: tooltip flutuante posicionada por % do viewBox
            (CSS esconde em <1024px). */}
        {hover && hoverTime && hoverRank != null && (
          <div
            class="bf-league-chart__tooltip"
            style={{
              left: `${(hover.x / W) * 100}%`,
              top: `${(hover.y / H) * 100}%`,
              "--c": hoverTime.accent,
            } as Record<string, string>}
          >
            {hoverTime.logo && (
              <img
                class="bf-league-chart__tooltip-crest"
                src={hoverTime.logo}
                alt=""
              />
            )}
            <div class="bf-league-chart__tooltip-body">
              <div class="bf-league-chart__tooltip-name">{hoverTime.nome}</div>
              <div class="bf-league-chart__tooltip-sub">
                R{hover.rodada} · {hoverRank}º ·{" "}
                {(hoverPts as number).toFixed(1).replace(".", ",")} pts
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE-ONLY: painel de detalhe abaixo do gráfico, atualiza no tap.
          CSS esconde em ≥1024px. */}
      <div class="bf-league-chart__detail">
        {(() => {
          if (!hover || !hoverTime || hoverRank == null) {
            return (
              <span class="bf-league-chart__detail-hint">
                Toque num ponto pra ver detalhes
              </span>
            );
          }
          return (
            <div
              class="bf-league-chart__detail-card"
              style={{ "--c": hoverTime.accent } as Record<string, string>}
            >
              {hoverTime.logo && (
                <img
                  class="bf-league-chart__detail-crest"
                  src={hoverTime.logo}
                  alt=""
                />
              )}
              <div class="bf-league-chart__detail-meta">
                <div class="bf-league-chart__detail-name">{hoverTime.nome}</div>
                <div class="bf-league-chart__detail-sub">
                  Rodada {hover.rodada}
                </div>
              </div>
              <div class="bf-league-chart__detail-rank">
                {hoverRank}º
              </div>
              <div class="bf-league-chart__detail-pts">
                <span class="bf-league-chart__detail-pts-value">
                  {(hoverPts as number).toFixed(1).replace(".", ",")}
                </span>
                <span class="bf-league-chart__detail-pts-foot">PTS</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* MOBILE-ONLY: legenda com crests + nomes. CSS esconde em ≥1024px. */}
      <div class="bf-league-chart__legend">
        {times.map((t) => (
          <span
            key={t.chave}
            class={`bf-league-chart__legend-item ${
              destaque === t.chave ? "bf-league-chart__legend-item--active" : ""
            }`}
            style={{ "--c": t.accent } as Record<string, string>}
          >
            {t.logo
              ? (
                <img
                  class="bf-league-chart__legend-crest"
                  src={t.logo}
                  alt=""
                />
              )
              : <span class="bf-league-chart__legend-dot" />}
            <span class="bf-league-chart__legend-name">{t.nome}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
