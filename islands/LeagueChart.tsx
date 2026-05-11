// Bump chart — posição (rank) por rodada. Y invertido (1 = topo).
// Cada time tem uma linha na cor accent dele. Mostra trocas de posição
// dramaticamente ao longo das rodadas. Tap num ponto/crest mostra
// tooltip com time/rodada/posição (compatível mobile).

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

  const [active, setActive] = useState<
    null | { chave: string; rodada: number }
  >(null);

  // Ordem de renderização: destaque por último pra ficar por cima
  const ordered = [...times].sort((a, b) => {
    if (a.chave === destaque) return 1;
    if (b.chave === destaque) return -1;
    return 0;
  });

  return (
    <div class="bf-league-chart">
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
              />
              {pts.map((p) => (
                <g key={p.rodada}>
                  {/* Anel destacando ponto ativo */}
                  {active && active.chave === t.chave &&
                    active.rodada === p.rodada && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="7"
                      fill="none"
                      stroke={t.accent}
                      stroke-width="2"
                      opacity="0.5"
                    />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isDestaque ? 4 : 3}
                    fill={t.accent}
                    stroke="var(--bf-chassis)"
                    stroke-width={isDestaque ? 1.5 : 1}
                    pointer-events="none"
                  />
                  {/* Hit target invisível — 12px radius pra tap confortável */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="12"
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActive({ chave: t.chave, rodada: p.rodada });
                    }}
                  />
                </g>
              ))}
              {/* Crest no fim da linha — tap mostra última rodada */}
              {t.logo && (
                <image
                  href={t.logo}
                  x={lastPt.x + 4}
                  y={lastPt.y - 9}
                  width="18"
                  height="18"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive({
                      chave: t.chave,
                      rodada: rodadas[rodadas.length - 1],
                    });
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Painel de detalhe — sempre presente, atualiza no tap */}
      <div class="bf-league-chart__detail">
        {(() => {
          if (!active) {
            return (
              <span class="bf-league-chart__detail-hint">
                Toque num ponto pra ver detalhes
              </span>
            );
          }
          const t = times.find((x) => x.chave === active.chave);
          if (!t) return null;
          const rank = rankByTeamRound[t.chave][active.rodada];
          const pts = t.pontosPorRodada[String(active.rodada)] ?? 0;
          return (
            <div
              class="bf-league-chart__detail-card"
              style={{ "--c": t.accent } as Record<string, string>}
            >
              {t.logo && (
                <img
                  class="bf-league-chart__detail-crest"
                  src={t.logo}
                  alt=""
                />
              )}
              <div class="bf-league-chart__detail-meta">
                <div class="bf-league-chart__detail-name">{t.nome}</div>
                <div class="bf-league-chart__detail-sub">
                  Rodada {active.rodada}
                </div>
              </div>
              <div class="bf-league-chart__detail-rank">
                {rank}º
              </div>
              <div class="bf-league-chart__detail-pts">
                <span class="bf-league-chart__detail-pts-value">
                  {pts.toFixed(1).replace(".", ",")}
                </span>
                <span class="bf-league-chart__detail-pts-foot">PTS</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Legenda com crests + nomes */}
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
