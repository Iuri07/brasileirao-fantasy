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

        {/* Banda min-max da liga (área shaded sem o usuário) */}
        {(() => {
          const outros = times.filter((t) => t.chave !== destaque);
          if (!outros.length) return null;
          const bandData = rodadas.map((r, i) => {
            const valores = outros
              .map((t) => t.pontosPorRodada[String(r)] ?? 0)
              .filter((v) => v > 0);
            const min = valores.length ? Math.min(...valores) : 0;
            const max = valores.length ? Math.max(...valores) : 0;
            const median = valores.length
              ? [...valores].sort((a, b) => a - b)[
                Math.floor(valores.length / 2)
              ]
              : 0;
            return { x: xFor(i), yMin: yFor(min), yMax: yFor(max), median };
          });
          // polygon path: top edge + bottom edge reverso
          const topPoints = bandData.map((d) => `${d.x},${d.yMax}`).join(" ");
          const botPoints = [...bandData].reverse().map((d) =>
            `${d.x},${d.yMin}`
          ).join(" ");
          const medianPath = bandData.map((d, i) =>
            `${i === 0 ? "M" : "L"}${d.x},${yFor(d.median)}`
          ).join(" ");
          return (
            <g>
              <polygon
                points={`${topPoints} ${botPoints}`}
                fill="rgba(255,255,255,0.05)"
                stroke="none"
              />
              <path
                d={medianPath}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                stroke-width="1"
                stroke-dasharray="3 3"
                stroke-linejoin="round"
              />
            </g>
          );
        })()}

        {/* Linha destacada (usuário) por cima — grossa, com pontos */}
        {(() => {
          const t = times.find((x) => x.chave === destaque);
          if (!t) return null;
          const pts = rodadas.map((r, i) => ({
            x: xFor(i),
            y: yFor(t.pontosPorRodada[String(r)] ?? 0),
            v: t.pontosPorRodada[String(r)] ?? 0,
          }));
          return (
            <g>
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={t.accent}
                stroke-width="2.5"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              {pts.map((p, i) =>
                p.v > 0 && (
                  <circle key={i} cx={p.x} cy={p.y} r="2.8" fill={t.accent} />
                )
              )}
            </g>
          );
        })()}
      </svg>

      {/* Legenda mini com 2 linhas: a do user e a banda da liga */}
      {destaque && (
        <div class="bf-league-chart__caption">
          <span
            class="bf-league-chart__caption-item"
            style={{
              "--c": times.find((t) => t.chave === destaque)?.accent ?? "#fff",
            } as Record<string, string>}
          >
            <span class="bf-league-chart__caption-line bf-league-chart__caption-line--solid" />
            Você
          </span>
          <span class="bf-league-chart__caption-item bf-league-chart__caption-item--muted">
            <span class="bf-league-chart__caption-line bf-league-chart__caption-line--dashed" />
            Mediana da liga
          </span>
          <span class="bf-league-chart__caption-item bf-league-chart__caption-item--muted">
            <span class="bf-league-chart__caption-band" />
            Min–max
          </span>
        </div>
      )}
    </div>
  );
}
