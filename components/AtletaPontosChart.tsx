// Chart de pontuação por rodada — usado no modal de detalhes do atleta.
// Mais detalhado que o Sparkline da liga: barras coloridas (+verde/-vermelho),
// labels de valor em cima das barras, linha de média numerada, ticks de
// rodada. Click numa barra dispara onSelectRodada — modal abre painel de
// scout daquela rodada.

export interface RodadaEntry {
  pontos: number;
  scout: Record<string, number>;
}

interface Props {
  /** Mapa rodada → { pontos, scout }. Apenas rodadas onde o atleta entrou em
   *  campo. */
  historico: Record<number | string, RodadaEntry>;
  /** Última rodada a mostrar (renderiza slots vazios pras rodadas que o atleta
   *  não jogou — DNP). Se omitido, usa a maior rodada do histórico. */
  maxRodada?: number;
  /** Altura interna do SVG em px. Padrão 130. */
  height?: number;
  /** Rodada selecionada (highlighted). */
  selectedRodada?: number | null;
  /** Callback ao clicar numa rodada (toggle: clicar de novo desseleciona). */
  onSelectRodada?: (r: number | null) => void;
}

export default function AtletaPontosChart(
  {
    historico,
    maxRodada,
    height = 130,
    selectedRodada = null,
    onSelectRodada,
  }: Props,
) {
  // Normaliza chaves pra number
  const pontosPorRodada = new Map<number, RodadaEntry>();
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

  const valoresJogados = rodadasJogadas.map((r) =>
    pontosPorRodada.get(r)!.pontos
  );
  const soma = valoresJogados.reduce((a, b) => a + b, 0);
  const media = soma / valoresJogados.length;
  const maxPos = Math.max(0, ...valoresJogados);
  const minNeg = Math.min(0, ...valoresJogados);
  const rangeTotal = (maxPos - minNeg) || 1;

  // Dimensões do viewBox
  const barW = 14;
  const gap = 4;
  const leftPad = 4;
  const rightPad = 28; // espaço pro label da média
  const topPad = 16; // espaço pra labels de valor
  const bottomPad = 18; // espaço pra ticks de rodada
  const plotH = height - topPad - bottomPad;
  const W = leftPad + rodadas.length * (barW + gap) - gap + rightPad;
  const H = height;

  // Escala Y: usa [minNeg, maxPos] mas sempre inclui 0
  const yScale = (v: number) => {
    const t = (v - minNeg) / rangeTotal; // 0..1
    return plotH - t * plotH; // invertido (SVG y cresce pra baixo)
  };

  const y0 = topPad + yScale(0);
  const yMedia = topPad + yScale(media);

  // Decide intervalo dos ticks no eixo X — sempre R1 + última, e
  // intermediários a cada 5 (se >10 rodadas) ou a cada 2 (se ≤10).
  const stepTick = rodadas.length > 10 ? 5 : 2;
  const ticks = new Set<number>([1, rMax]);
  for (let r = stepTick; r < rMax; r += stepTick) ticks.add(r);

  const showMediaLine = Math.abs(media) > 0.05;

  function handleClick(r: number) {
    if (!onSelectRodada) return;
    onSelectRodada(selectedRodada === r ? null : r);
  }

  return (
    <div class="bf-pontos-chart">
      <div class="bf-pontos-chart__head">
        <span class="bf-pontos-chart__titulo">Pontos por rodada</span>
        <span class="bf-pontos-chart__hint">
          {onSelectRodada ? "toque numa rodada" : ""}
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
        {/* Linha de média (dashed amarela) + label numérico */}
        {showMediaLine && (
          <>
            <line
              x1={leftPad}
              x2={W - rightPad}
              y1={yMedia}
              y2={yMedia}
              class="bf-pontos-chart__media-line"
            />
            <text
              x={W - rightPad + 3}
              y={yMedia + 3}
              class="bf-pontos-chart__media-label"
            >
              {media.toFixed(1).replace(".", ",")}
            </text>
          </>
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
          const entry = pontosPorRodada.get(r);
          const cx = x + barW / 2;
          const isSelected = selectedRodada === r;
          if (entry == null) {
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
          const p = entry.pontos;
          const yV = topPad + yScale(p);
          const barY = Math.min(yV, y0);
          const barH = Math.abs(yV - y0) || 1;
          const positivo = p >= 0;
          const label = p.toFixed(1).replace(".", ",");
          const clickable = !!onSelectRodada;
          return (
            <g
              key={r}
              class={`bf-pontos-chart__bar-g ${
                isSelected ? "bf-pontos-chart__bar-g--sel" : ""
              } ${clickable ? "bf-pontos-chart__bar-g--clickable" : ""}`}
              onClick={clickable ? () => handleClick(r) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable
                ? (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClick(r);
                  }
                }
                : undefined}
            >
              {/* Área de clique invisível (cobre barra + label) — melhora UX
                  em mobile, especialmente pra barras curtas/negativas. */}
              <rect
                x={x - 1}
                y={topPad}
                width={barW + 2}
                height={plotH}
                fill="transparent"
              />
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
