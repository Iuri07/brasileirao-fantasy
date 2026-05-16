// Redirecionamento de assets estáticos pro CDN do jsDelivr em produção.
//
// O Deno Deploy serve os estáticos, mas pra ~310 imagens pequenas
// (cutouts, escudos, players) o overhead de TTFB do edge da Deno
// somado a muitos round-trips fica perceptível. O jsDelivr serve
// direto do GitHub com cache agressivo e múltiplos PoPs globais.
//
// Em desenvolvimento usa o path relativo (Deno serve local de static/),
// pra não depender do GitHub ter o arquivo já comitado.

// Repo público de assets (separado do código). jsDelivr serve direto do
// GitHub com cache global agressivo. Pra invalidar cache depois de
// novas imagens: bumpar `@vN` aqui (tag) ou só esperar (~12h pra purge).
const CDN_BASE =
  "https://cdn.jsdelivr.net/gh/Iuri07/brasileirao-fantasy-assets@master";

// Decisão de usar CDN: invertida pra evitar bug onde env var não vem
// (Deno Deploy EA não popula DENO_DEPLOYMENT_ID consistentemente).
// Default: se está rodando em algum runtime Deno, usa CDN.
// Override pra dev local com symlinks: USE_LOCAL_ASSETS=1.
// No browser, `Deno` não existe → IN_DEPLOY=false (mas URLs já vêm
// resolvidas do SSR, então não importa).
function detectUseDeploy(): boolean {
  if (typeof Deno === "undefined") return false;
  try {
    if (Deno.env.get("USE_LOCAL_ASSETS") === "1") return false;
  } catch {
    // env access negado → assume prod
  }
  return true;
}
const IN_DEPLOY = detectUseDeploy();

/** Retorna a URL final do asset. URLs absolutas (http(s)://) passam direto.
 *  Em prod, paths começando com '/' viram URL absoluta do jsDelivr. */
export function cdn(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (!IN_DEPLOY) return path; // dev: serve do Deno local
  if (!path.startsWith("/")) path = "/" + path;
  return CDN_BASE + path;
}
