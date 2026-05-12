// Scraper do ogol.com.br (rede zerozero/PlaymakerStats).
//
// Estrutura:
//   /equipe/{slug}           → lista do plantel atual com /jogador/{slug}/{id}
//   /jogador/{slug}/{id}     → página do jogador com a foto em alta
//
// Foto: PNG RGBA (cutout transparente) servido em cdn-img.staticzz.com
// Padrão: /img/jogadores/new/{XX}/{YY}/{id}_{slug}_{timestamp}.png
// (XX/YY são as duas penúltimas e últimas duas casas do ID, mas timestamp é
// variável, então sempre extraímos do HTML.)

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 BFFantasy/1.0";

/** Mapeia o nome do clube vindo do Cartola pro path no ogol. */
export const OGOL_TEAM_SLUGS: Record<string, string> = {
  "Mirassol": "mirassol/3348",
  "Flamengo": "flamengo",
  "Botafogo": "botafogo",
  "Corinthians": "corinthians",
  "Bahia": "bahia/2231",
  "Fluminense": "fluminense",
  "Vasco": "vasco",
  "Palmeiras": "palmeiras",
  "São Paulo": "sao-paulo",
  "Santos": "santos",
  "Bragantino": "red-bull-bragantino",
  "RB Bragantino": "red-bull-bragantino",
  "Atlético-MG": "atletico-mineiro",
  "Cruzeiro": "cruzeiro",
  "Grêmio": "gremio",
  "Internacional": "internacional",
  "Vitória": "vitoria/2259",
  "Athletico-PR": "athletico-paranaense",
  "Athlético-PR": "athletico-paranaense",
  "Coritiba": "coritiba/2235",
  "Chapecoense": "chapecoense/3195",
  "Remo": "remo/3423",
};

export interface OgolPlayer {
  /** ID numérico no ogol (ex: 404779) */
  ogolId: number;
  /** Slug pra montar URL: /jogador/{slug}/{id} */
  slug: string;
}

/** Normaliza nome pra match: lowercase, sem acentos, sem hifens/espaços. */
export function normName(s: string): string {
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`ogol ${url} → ${r.status}`);
  // Site serve em ISO-8859-1; converte pra UTF-8 antes de parsear
  const buf = await r.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buf);
}

/** Coleta o plantel atual a partir de `/equipe/{slug}`. */
export async function fetchOgolRoster(teamSlug: string): Promise<OgolPlayer[]> {
  const url = `https://www.ogol.com.br/equipe/${teamSlug}`;
  const html = await fetchHtml(url);
  // Match /jogador/{slug}/{id} (ignora ?epoca_id e duplicatas)
  const seen = new Set<number>();
  const out: OgolPlayer[] = [];
  for (const m of html.matchAll(/\/jogador\/([a-z0-9-]+)\/(\d+)/g)) {
    const slug = m[1];
    const id = Number(m[2]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ogolId: id, slug });
  }
  return out;
}

export interface OgolPhoto {
  url: string;
  /** "png" = cutout transparente (preferido); "jpg" = precisa background-removal */
  format: "png" | "jpg";
}

/** Devolve a foto principal de um jogador. PNG quando disponível (cutout
    transparente), JPG como fallback (precisa background-removal). */
export async function fetchOgolPhoto(
  player: OgolPlayer,
): Promise<OgolPhoto | null> {
  const url = `https://www.ogol.com.br/jogador/${player.slug}/${player.ogolId}`;
  const html = await fetchHtml(url);
  // og:image é a foto canônica do jogador, independente do ID interno
  // (ogol às vezes troca o ID interno em refresh; o slug fica)
  const og = html.match(
    /property="og:image"\s+content="(https?:\/\/[^"]+\/img\/jogadores\/[^"]+\.(png|jpg|jpeg))"/i,
  );
  if (og) {
    const url = og[1];
    const ext = og[2].toLowerCase();
    // Apenas PNGs em /new/ são cutouts transparentes do ogol. PNGs no
    // diretório legado (sem /new/) costumam ter fundo sólido (preto/branco),
    // então também precisam de rembg.
    const isNewCutout = ext === "png" && url.includes("/img/jogadores/new/");
    return { url, format: isNewCutout ? "png" : "jpg" };
  }
  return null;
}

/** Baixa a foto e devolve os bytes. */
export async function downloadOgolPhoto(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Verifica se um PNG tem transparência real (pelo menos 1% dos pixels com
    alpha < 255). PNGs RGBA com alpha=255 em todos os pixels são "fake
    cutouts" — fundo opaco baked-in, precisam passar por rembg. */
export async function pngHasTransparency(bytes: Uint8Array): Promise<boolean> {
  try {
    const { decode } = await import("https://deno.land/x/pngs@0.1.1/mod.ts");
    const img = decode(bytes);
    const px = img.image;
    // Se decode retornou RGB (sem alpha), .image tem 3 bytes/pixel
    if (px.length === img.width * img.height * 3) return false;
    let transparentish = 0;
    const total = px.length / 4;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 255) {
        transparentish++;
        // Early-out: 1% já indica cutout real
        if (transparentish > total * 0.01) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Roda `rembg i input output` pra remover o fundo de um JPG. Devolve os
    bytes do PNG resultante. Requer `rembg[cli]` instalado via pipx. */
export async function rembg(inputBytes: Uint8Array): Promise<Uint8Array> {
  const tmpIn = await Deno.makeTempFile({ suffix: ".jpg" });
  const tmpOut = await Deno.makeTempFile({ suffix: ".png" });
  try {
    await Deno.writeFile(tmpIn, inputBytes);
    const cmd = new Deno.Command("rembg", {
      args: ["i", tmpIn, tmpOut],
      stdout: "piped",
      stderr: "piped",
      env: { PATH: `${Deno.env.get("HOME")}/.local/bin:${Deno.env.get("PATH")}` },
    });
    const { code, stderr } = await cmd.output();
    if (code !== 0) {
      throw new Error(`rembg falhou: ${new TextDecoder().decode(stderr)}`);
    }
    return await Deno.readFile(tmpOut);
  } finally {
    await Deno.remove(tmpIn).catch(() => {});
    await Deno.remove(tmpOut).catch(() => {});
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
