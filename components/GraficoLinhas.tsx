export interface TimeDados {
  TIME: string;
  DONO: string;
  "PONTOS TOTAL": number;
  row_number: number;
  [rodada: string]: string | number;
}

interface Props {
  dados: TimeDados[];
  coresTimes: Record<string, string>;
}

// Nomes alternativos → cor (cobre nomes que vêm do Excel com display names)
const CORES_EXTRAS: Record<string, string> = {
  "ILHA DE PAQUETÁ": "#F8FAA9",
  "ILHA DE PAQUETÁ FC": "#F8FAA9",
  "CREFILHO DA GAMA": "#D1FA9E",
  "CREFILHO DA GAMA FC": "#D1FA9E",
  "MOLEICESTER CITY": "#BEF3F6",
  "MOLEICESTER CITY FC": "#BEF3F6",
  "PAPAI CHEGOU FC": "#9FC5E8",
  "PAPAI CHEGOU": "#9FC5E8",
  "PEDRO ÁLVARES PARDAL": "#E3C0F3",
};

// Rodadas possíveis no campeonato (1 a 38 para cobrir qualquer formato)
const TODAS_RODADAS = Array.from({ length: 38 }, (_, i) => String(i + 1));

export function GraficoLinhas({ dados, coresTimes }: Props) {
  const cores = { ...coresTimes, ...CORES_EXTRAS };
  // Apenas rodadas que têm pelo menos um time com pontuação
  const rodadas = TODAS_RODADAS.filter((r) =>
    dados.some((t) =>
      t[r] !== "" && t[r] !== null && t[r] !== undefined && Number(t[r]) > 0
    )
  );

  if (rodadas.length === 0) {
    return (
      <div class="grafico-vazio">
        <p>Nenhuma rodada disputada ainda.</p>
      </div>
    );
  }

  // Dimensões do SVG
  const W = 560, H = 260;
  const ML = 38, MR = 12, MT = 14, MB = 38;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;

  // Calcula acumulados por time: { [TIME]: number[] } com um valor por rodada
  const acumulados: Record<string, number[]> = {};
  for (const time of dados) {
    let soma = 0;
    acumulados[time.TIME] = rodadas.map((r) => {
      soma += Number(time[r]) || 0;
      return soma;
    });
  }

  // Diferença em relação ao líder a cada rodada (líder = 0, demais negativo)
  const diferencas: Record<string, number[]> = {};
  for (let i = 0; i < rodadas.length; i++) {
    const lider = Math.max(...dados.map((t) => acumulados[t.TIME][i]));
    for (const time of dados) {
      if (!diferencas[time.TIME]) diferencas[time.TIME] = [];
      diferencas[time.TIME].push(acumulados[time.TIME][i] - lider);
    }
  }

  // Escala Y: de 0 (líder) até o maior déficit
  const minDiff = Math.min(...dados.flatMap((t) => diferencas[t.TIME]));
  const yMin = Math.floor(minDiff / 10) * 10 || -10;
  // yMax = 0 (líder sempre em cima)

  const xPos = (i: number) =>
    ML + (rodadas.length > 1 ? (i / (rodadas.length - 1)) * plotW : plotW / 2);
  // v vai de yMin (baixo) a 0 (cima)
  const yPos = (v: number) => MT + plotH - ((v - yMin) / (0 - yMin)) * plotH;

  // Linhas horizontais de referência (0%, 25%, 50%, 75%, 100%)
  const gridYs = [0, 0.25, 0.5, 0.75, 1];

  // Times ordenados por total (maior primeiro) para a legenda
  const timesOrdenados = [...dados].sort(
    (a, b) => (b["PONTOS TOTAL"] as number) - (a["PONTOS TOTAL"] as number),
  );

  return (
    <div class="grafico-wrapper">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style="width:100%;height:auto;display:block;"
        aria-label="Gráfico de pontos acumulados por rodada"
      >
        {/* Grid horizontal */}
        {gridYs.map((t) => (
          <line
            key={t}
            x1={ML}
            y1={MT + t * plotH}
            x2={ML + plotW}
            y2={MT + t * plotH}
            stroke="rgba(255,255,255,0.06)"
            stroke-width="1"
          />
        ))}

        {/* Eixo X — linhas verticais por rodada */}
        {rodadas.map((_, i) => (
          <line
            key={i}
            x1={xPos(i)}
            y1={MT}
            x2={xPos(i)}
            y2={MT + plotH}
            stroke="rgba(255,255,255,0.04)"
            stroke-width="1"
          />
        ))}

        {/* Linhas dos times (diferença em relação ao líder) */}
        {dados.map((time) => {
          const cor = cores[time.TIME] ?? "#888";
          const diff = diferencas[time.TIME];
          const pontos = rodadas.map((r, i) => ({
            x: xPos(i),
            y: yPos(diff[i]),
            v: diff[i],
            acum: acumulados[time.TIME][i],
            r,
          }));

          const polyPts = pontos.map((p) =>
            `${p.x.toFixed(1)},${p.y.toFixed(1)}`
          ).join(" ");

          return (
            <g key={time.TIME}>
              <polyline
                points={polyPts}
                fill="none"
                stroke={cor}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                opacity="0.9"
              />
              {pontos.map((p) => (
                <circle key={p.r} cx={p.x} cy={p.y} r="3.5" fill={cor}>
                  <title>
                    {time.TIME} — R{p.r}: {p.acum.toFixed(1)}{" "}
                    pts ({p.v === 0 ? "líder" : `${p.v.toFixed(1)} do líder`})
                  </title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* Rótulos do eixo X */}
        {rodadas.map((r, i) => (
          <text
            key={r}
            x={xPos(i)}
            y={H - 10}
            text-anchor="middle"
            font-size="9"
            fill="rgba(255,255,255,0.35)"
            font-family="sans-serif"
          >
            R{r}
          </text>
        ))}

        {/* Rótulos do eixo Y */}
        {gridYs.map((t) => (
          <text
            key={t}
            x={ML - 5}
            y={MT + (1 - t) * plotH + 3.5}
            text-anchor="end"
            font-size="9"
            fill="rgba(255,255,255,0.35)"
            font-family="sans-serif"
          >
            {Math.round(yMin * (1 - t))}
          </text>
        ))}
      </svg>

      {/* Legenda + classificação */}
      <div class="grafico-legenda">
        {timesOrdenados.map((time, i) => (
          <div key={time.TIME} class="legenda-item">
            <span class="legenda-pos">#{i + 1}</span>
            <span
              class="legenda-cor"
              style={`background:${cores[time.TIME] ?? "#888"}`}
            />
            <span class="legenda-nome">{time.TIME}</span>
            <span class="legenda-total">
              {(time["PONTOS TOTAL"] as number).toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
