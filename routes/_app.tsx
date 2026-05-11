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
            {
              /* Clip do corpo da camisa — usado pra constrain padrões
                (listras/sash) à silhueta do jersey. */
            }
            <clipPath id="bf-jersey-body" clipPathUnits="userSpaceOnUse">
              <path d="M30 10 L8 22 L13 40 L27 40 L27 92 Q27 98 33 98 L67 98 Q73 98 73 92 L73 40 L87 40 L92 22 L70 10 L60 17 L50 22 L40 17 Z" />
            </clipPath>
          </defs>
        </svg>
        <Component />

        {
          /* Fade out na navegação interna — funciona em qualquer browser.
            Adiciona delay de 180ms antes de location.href, durante o qual
            o CSS .bf-leaving anima o fade-out. A página de destino entra
            com fade-in via animação CSS no .bf-viewport. */
        }
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('click', function(e) {
                var a = e.target.closest && e.target.closest('a[href]');
                if (!a) return;
                if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                if (a.origin !== location.origin) return;
                if (a.href === location.href) return;
                e.preventDefault();
                document.body.classList.add('bf-leaving');
                setTimeout(function() { location.href = a.href; }, 90);
              });
              window.addEventListener('pageshow', function() {
                document.body.classList.remove('bf-leaving');
              });
            `,
          }}
        />
      </body>
    </html>
  );
}
