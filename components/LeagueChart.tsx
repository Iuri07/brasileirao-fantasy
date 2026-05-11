// SVG line chart pra evolução da pontuação por rodada da liga.
// Uma linha por time, na cor accent dele.

export interface LinhaTime {
  chave: string;
  nome: string;
  accent: string;
  pontosPorRodada: Record<string, number>;
}

interface Props {
  times: LinhaTime[];
  /** Destacar uma chave específica (ex: time do usuário) — outras ficam dimmed */
  destaque?: string;
}

const W = 320;
const H = 180;
const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 22;

export default function LeagueChart({ times, destaque }: Props) {
  // Coletas todas as rodadas presentes (>0) em pelo menos um time
  const rodadasSet = new Set<number>();
  for (const t of times) {
    for (const [r, p] of Object.entries(t.pontosPorRodada)) {
      if (p > 0) rodadasSet.add(Number(r));
    }
  }
  const rodadas = [...rodadasSet].sort((a, b) => a - b);

  if (rodadas.length < 2) {
    return (
      <div class="bf-empty-state">
        Aguardando dados de rodadas
      </div>
    );
  }

  // Max value pra escalar
  let maxPts = 0;
  for (const t of times) {
    for (const r of rodadas) {
      const p = t.pontosPorRodada[String(r)] ?? 0;
      if (p > maxPts) maxPts = p;
    }
  }
  // Arredonda pro próximo múltiplo de 25
  const yMax = Math.ceil(maxPts / 25) * 25;
  const yStep = yMax / 4; // 4 gridlines

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xFor = (i: number) =>
    PAD_L +
    (rodadas.length === 1 ? innerW / 2 : (i * innerW) / (rodadas.length - 1));
  const yFor = (pts: number) => PAD_T + innerH - (pts / yMax) * innerH;

  return (
    <div class="bf-league-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="bf-league-chart__svg"
        role="img"
        aria-label="Evolução da pontuação por rodada"
      >
        {/* Gridlines horizontais + labels Y */}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = i * yStep;
          const y = yFor(v);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                stroke-width="1"
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                text-anchor="end"
                class="bf-league-chart__y-label"
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* Labels X */}
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

        {/* Linhas dos times */}
        {times.map((t) => {
          const points = rodadas
            .map((r, i) => {
              const p = t.pontosPorRodada[String(r)] ?? 0;
              return `${xFor(i)},${yFor(p)}`;
            })
            .join(" ");
          const dimmed = destaque && destaque !== t.chave;
          return (
            <g key={t.chave} opacity={dimmed ? "0.32" : "1"}>
              <polyline
                points={points}
                fill="none"
                stroke={t.accent}
                stroke-width={destaque === t.chave ? 2.5 : 1.5}
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              {/* Pontos */}
              {rodadas.map((r, i) => {
                const p = t.pontosPorRodada[String(r)] ?? 0;
                if (p === 0) return null;
                return (
                  <circle
                    key={r}
                    cx={xFor(i)}
                    cy={yFor(p)}
                    r={destaque === t.chave ? 2.5 : 1.5}
                    fill={t.accent}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legenda */}
      <div class="bf-league-chart__legend">
        {times.map((t) => (
          <span
            key={t.chave}
            class="bf-league-chart__legend-item"
            style={{ "--c": t.accent } as Record<string, string>}
          >
            <span class="bf-league-chart__legend-dot" />
            {t.nome}
          </span>
        ))}
      </div>
    </div>
  );
}
