import { AppProps } from "$fresh/server.ts";

export default function App({ Component }: AppProps) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0a3d20" />
        <title>Fantasy Cartola - Ranking</title>
        <link rel="stylesheet" href="/styles.css?v=54" />
      </head>
      <body>
        {
          /* Filtro global pra remover fundo branco das fotos.
            α = 56 - 20*(R+G+B). Sharp threshold em R+G+B ≈ 2.8 (cada
            canal ~0.93). Branco e quase-branco viram transparentes;
            tons de pele e cabelo (sum < 2.5) permanecem 100% opacos. */
        }
        <svg
          width="0"
          height="0"
          style="position:absolute"
          aria-hidden="true"
        >
          <defs>
            <filter id="bf-remove-white" color-interpolation-filters="sRGB">
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0
                        0 1 0 0 0
                        0 0 1 0 0
                        -20 -20 -20 0 56"
              />
            </filter>
          </defs>
        </svg>
        <Component />
      </body>
    </html>
  );
}
