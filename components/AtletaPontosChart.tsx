// Chart de pontuação por rodada — usado no modal de detalhes do atleta.
// Mais detalhado que o Sparkline da liga: barras coloridas (+verde/-vermelho),
// labels de valor em cima das barras, linha de média, ticks de rodada.

interface Props {
  /** Mapa rodada → pontos (apenas rodadas onde o atleta entrou em campo). */
  historico: Record<number | string, number>;
  /** Última rodada a mostrar (renderiza slots vazios pras rodadas que o atleta
   *  não jogou — DNP). Se omitido, usa a maior rodada do histórico. */
  maxRodada?: number;
  /** Altura interna do SVG em px. Padrão 130. */
  height?: number;
}

export default function AtletaPontosChart(
  { historico, maxRodada, height = 130 }: Props,
) {
  // Normaliza chaves pra number
  const pontosPorRodada = new Map<number, number>();
  for (const [k, v] of Object.entries(historico)) {
    pontosPorRodada.set(Number(k), v);
  }
  const rodadasJogadas = Array.from(pontosPorRodada.keys()).sort((a, b) =>
    a - b
  );
  if (rodadasJogadas.length === 0) {
    return (
      <div class="bf-pontos-chart bf-pontos-chart--vazio">
        Atleta ainda não entrou em campo nesta temporada.
      </div>
    );
  }

  const rMax = maxRodada ?? rodadasJogadas[rodadasJogadas.length - 1];
  const rodadas: number[] = [];
  for (let r = 1; r <= rMax; r++) rodadas.push(r);

  const valoresJogados = rodadasJogadas.map((r) => pontosPorRodada.get(r)!);
  const soma = valoresJogados.reduce((a, b) => a + b, 0);
  const media = soma / valoresJogados.length;
  const maxPos = Math.max(0, ...valoresJogados);
  const minNeg = Math.min(0, ...valoresJogados);
  const rangeTotal = (maxPos - minNeg) || 1;
  // Escala Y: usa [minNeg, maxPos] mas sempre inclui 0
  const yScale = (v: number) => {
    // Retorna posição Y de v dentro do plot área (em coords do viewBox)
    const t = (v - minNeg) / rangeTotal; // 0..1
    return plotH - t * plotH; // invertido (SVG y cresce pra baixo)
  };

  // Dimensões do viewBox
  const barW = 14;
  const gap = 4;
  const leftPad = 4;
  const rightPad = 6;
  const topPad = 16; // espaço pra labels de valor
  const bottomPad = 18; // espaço pra ticks de rodada
  const plotH = height - topPad - bottomPad;
  const W = leftPad + rodadas.length * (barW + gap) - gap + rightPad;
  const H = height;

  const y0 = topPad + yScale(0);
  const yMedia = topPad + yScale(media);

  // Decide intervalo dos ticks no eixo X — sempre R1 + última, e
  // intermediários a cada 5 (se >10 rodadas) ou a cada 2 (se ≤10).
  const stepTick = rodadas.length > 10 ? 5 : 2;
  const ticks = new Set<number>([1, rMax]);
  for (let r = stepTick; r < rMax; r += stepTick) ticks.add(r);

  return (
    <div class="bf-pontos-chart">
      <div class="bf-pontos-chart__head">
        <span class="bf-pontos-chart__titulo">Pontos por rodada</span>
        <span class="bf-pontos-chart__media">
          média{" "}
          <strong>
            {media.toFixed(1).replace(".", ",")}
          </strong>{" "}
          em <strong>{valoresJogados.length}</strong> jog.
        </span>
      </div>
      <svg
        class="bf-pontos-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Histórico de pontos por rodada. Média ${
          media.toFixed(1)
        } em ${valoresJogados.length} jogos.`}
      >
        {/* Linha de média (dashed amarela) */}
        {Math.abs(media) > 0.05 && (
          <line
            x1={leftPad}
            x2={W - rightPad}
            y1={yMedia}
            y2={yMedia}
            class="bf-pontos-chart__media-line"
          />
        )}
        {/* Baseline (zero) */}
        <line
          x1={leftPad}
          x2={W - rightPad}
          y1={y0}
          y2={y0}
          class="bf-pontos-chart__baseline"
        />

        {/* Barras + labels */}
        {rodadas.map((r, idx) => {
          const x = leftPad + idx * (barW + gap);
          const p = pontosPorRodada.get(r);
          const cx = x + barW / 2;
          if (p == null) {
            // DNP — bolinha cinza pequena na baseline
            return (
              <circle
                key={r}
                cx={cx}
                cy={y0}
                r={1.4}
                class="bf-pontos-chart__dnp"
              />
            );
          }
          const yV = topPad + yScale(p);
          const barY = Math.min(yV, y0);
          const barH = Math.abs(yV - y0) || 1;
          const positivo = p >= 0;
          const label = p.toFixed(1).replace(".", ",");
          return (
            <g key={r}>
              <rect
                x={x}
                y={barY}
                width={barW}
                height={barH}
                rx={1.5}
                class={`bf-pontos-chart__bar ${
                  positivo
                    ? "bf-pontos-chart__bar--pos"
                    : "bf-pontos-chart__bar--neg"
                }`}
              >
                <title>{`R${r}: ${label}`}</title>
              </rect>
              {/* Valor acima (ou abaixo, se negativo) */}
              <text
                x={cx}
                y={positivo ? barY - 3 : barY + barH + 9}
                class="bf-pontos-chart__bar-val"
                text-anchor="middle"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Eixo X — ticks de rodada */}
        {rodadas.map((r, idx) => {
          if (!ticks.has(r)) return null;
          const cx = leftPad + idx * (barW + gap) + barW / 2;
          return (
            <text
              key={`tick-${r}`}
              x={cx}
              y={H - 4}
              class="bf-pontos-chart__tick"
              text-anchor="middle"
            >
              R{r}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
