import { AppProps } from "$fresh/server.ts";
import LiveStatusPoller from "../islands/LiveStatusPoller.tsx";

export default function App({ Component }: AppProps) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0a3d20" />
        <title>Fantasy Cartola - Ranking</title>
        <link rel="stylesheet" href="/styles.css?v=54" />
        {
          /* Preconnect pro CDN de imagens — economiza ~100ms no primeiro
             load por estabelecer TLS antes do primeiro img request. */
        }
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossorigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />

        {
          /* Speculation Rules — Chrome/Edge pré-renderizam a página
             (HTML + JS executado) em background quando user passa o
             mouse num link. No clique, a página já tá pronta no GPU
             memory e é exibida instantaneamente.
             Browsers sem suporte caem no prefetch normal (já adicionado
             via JS no body). */
        }
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              prerender: [
                {
                  // EAGER: pré-renderiza imediatamente os 5 links da
                  // bottom nav. Mobile-first: usuário não tem hover, mas
                  // sempre vai pular entre essas rotas — vale gastar.
                  source: "document",
                  where: { selector_matches: ".bf-bottom-nav__item" },
                  eagerness: "eager",
                },
                {
                  // MODERATE: hover/touchstart em qualquer link interno
                  // dispara prerender. Pra navegação fora da bottom nav.
                  source: "document",
                  where: {
                    and: [
                      { href_matches: "/*" },
                      {
                        not: {
                          or: [
                            { href_matches: "/api/*" },
                            { href_matches: "/login*" },
                            { href_matches: "/logout*" },
                          ],
                        },
                      },
                    ],
                  },
                  eagerness: "moderate",
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        {/* Barra de progresso no topo durante navegação */}
        <div id="bf-nav-progress" aria-hidden="true"></div>

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
        <LiveStatusPoller />

        {
          /* Fade out na navegação interna — funciona em qualquer browser.
            Adiciona delay de 180ms antes de location.href, durante o qual
            o CSS .bf-leaving anima o fade-out. A página de destino entra
            com fade-in via animação CSS no .bf-viewport. */
        }
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Prefetch ao hover/touch: dá vantagem de TTFB pra navegação
              // que provavelmente vai acontecer. Browser pega a página em
              // background, então o clique fica instantâneo.
              var prefetched = new Set();
              function maybePrefetch(href) {
                if (!href || prefetched.has(href)) return;
                if (!href.startsWith(location.origin)) return;
                if (href === location.href) return;
                prefetched.add(href);
                var link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = href;
                document.head.appendChild(link);
              }
              document.addEventListener('mouseover', function(e) {
                var a = e.target.closest && e.target.closest('a[href]');
                if (a) maybePrefetch(a.href);
              }, { passive: true });
              document.addEventListener('touchstart', function(e) {
                var a = e.target.closest && e.target.closest('a[href]');
                if (a) maybePrefetch(a.href);
              }, { passive: true });

              // Barra de progresso atrasada — só aparece se a próxima
              // página demorar mais que THRESH ms. Pra navegações rápidas
              // (skeleton + cache) fica invisível, sem flicker.
              var navBar = document.getElementById('bf-nav-progress');
              var THRESH = 350;
              var navTimer = null;
              function startProgress() {
                document.body.classList.add('bf-leaving');
                if (navTimer) clearTimeout(navTimer);
                navTimer = setTimeout(function() {
                  if (navBar) navBar.classList.add('bf-nav-progress--on');
                }, THRESH);
              }
              function endProgress() {
                document.body.classList.remove('bf-leaving');
                if (navTimer) { clearTimeout(navTimer); navTimer = null; }
                if (navBar) {
                  // Se ainda tava animando, finaliza pra 100% rápido
                  if (navBar.classList.contains('bf-nav-progress--on')) {
                    navBar.classList.add('bf-nav-progress--done');
                    setTimeout(function() {
                      navBar.classList.remove('bf-nav-progress--on', 'bf-nav-progress--done');
                    }, 220);
                  }
                }
              }
              document.addEventListener('click', function(e) {
                var a = e.target.closest && e.target.closest('a[href]');
                if (!a) return;
                if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                if (a.origin !== location.origin) return;
                if (a.href === location.href) return;
                startProgress();
              });
              // Forms POST que navegam também
              document.addEventListener('submit', function(e) {
                var f = e.target;
                if (f && f.method && f.method.toLowerCase() === 'post') startProgress();
              });
              window.addEventListener('pageshow', endProgress);
              window.addEventListener('beforeunload', startProgress);
            `,
          }}
        />
      </body>
    </html>
  );
}
