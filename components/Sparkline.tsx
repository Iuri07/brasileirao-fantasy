// Mini sparkline SVG pra mostrar evolução de pontos de um time
// dentro da team-row da liga (sem chart separado).

interface Props {
  /** Pontos por rodada — ordenado por chave numérica crescente */
  historico: Record<string, number>;
  /** Cor da linha (hex) */
  accent: string;
  width?: number;
  height?: number;
}

export default function Sparkline(
  { historico, accent, width = 90, height = 22 }: Props,
) {
  const rodadas = Object.keys(historico)
    .map(Number)
    .filter((r) => historico[String(r)] > 0)
    .sort((a, b) => a - b);

  if (rodadas.length < 2) return null;

  const valores = rodadas.map((r) => historico[String(r)]);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const range = max - min || 1;
  const PAD = 2;
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  const last = valores[valores.length - 1];

  const pts = valores.map((v, i) => ({
    x: PAD + (i * innerW) / (rodadas.length - 1),
    y: PAD + innerH - ((v - min) / range) * innerH,
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      class="bf-sparkline"
      aria-hidden="true"
    >
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={accent}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        opacity="0.85"
      />
      {/* Último ponto destacado */}
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r="2"
        fill={accent}
      />
      {/* Valor do último ponto */}
      <text
        x={width - 1}
        y={pts[pts.length - 1].y - 4}
        text-anchor="end"
        class="bf-sparkline__last"
        fill={accent}
      >
        {Math.round(last)}
      </text>
    </svg>
  );
}
