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

// Decisão de usar CDN — precisa funcionar em DOIS contextos:
//
// 1. Server (SSR): Deno definido. Em deploy → CDN; em dev local
//    com symlinks (USE_LOCAL_ASSETS=1) → path relativo.
//
// 2. Browser (islands hidratadas): Deno NÃO definido. Antes
//    bailava pra path relativo, mas islands como MeuTimeEditor
//    recomputam URLs em useMemo no client → escudos 404'avam em
//    prod porque hostname não é o repo de assets. Solução:
//    detectar prod via hostname (qualquer coisa ≠ localhost).
function detectUseDeploy(): boolean {
  // Server side
  if (typeof Deno !== "undefined") {
    try {
      return Deno.env.get("USE_LOCAL_ASSETS") !== "1";
    } catch {
      return true;
    }
  }
  // Browser side
  if (typeof location !== "undefined") {
    const h = location.hostname;
    return h !== "localhost" && h !== "127.0.0.1" && h !== "0.0.0.0";
  }
  return true;
}
const IN_DEPLOY = detectUseDeploy();

/** Retorna a URL final do asset. URLs absolutas (http(s)://) passam direto.
 *  Em prod, paths começando com '/' viram URL absoluta do jsDelivr.
 *  Exceção: /uploads/ é servido pelo próprio app (volume Docker, asset
 *  dinâmico) e nunca passa pelo CDN. */
export function cdn(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/uploads/")) return path; // asset dinâmico
  if (!IN_DEPLOY) return path; // dev: serve do Deno local
  if (!path.startsWith("/")) path = "/" + path;
  return CDN_BASE + path;
}
