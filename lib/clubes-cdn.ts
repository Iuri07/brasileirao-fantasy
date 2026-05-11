// Mapping clube name → CDN URL do escudo oficial (Cartola FC).
// Snapshot do endpoint https://api.cartola.globo.com/clubes em 2026-05.
// O pattern de URL é determinístico: clubes_2026/escudos/{ABREV}/{size}.png
//
// Vantagem sobre os JPGs locais: sempre atualizado se Cartola publicar novo
// escudo, e cobre Athletico-PR (que faltava em static/escudos/).
//
// Pra próximas temporadas, atualizar o ano em CDN_BASE.

const CDN_BASE =
  "https://s3.glbimg.com/v1/AUTH_58d78b787ec34892b5aaa0c7a146155f/clubes_2026/escudos";

export type EscudoSize = "60x60" | "45x45" | "30x30";

const ABREV: Record<string, string> = {
  "Athletico-PR": "CAP",
  "Athlético-PR": "CAP",
  "Atlético-MG": "CAM",
  "Bahia": "BAH",
  "Botafogo": "BOT",
  "Bragantino": "RBB",
  "RB Bragantino": "RBB",
  "Chapecoense": "CHA",
  "Corinthians": "COR",
  "Coritiba": "CFC",
  "Cruzeiro": "CRU",
  "Flamengo": "FLA",
  "Fluminense": "FLU",
  "Grêmio": "GRE",
  "Internacional": "INT",
  "Mirassol": "MIR",
  "Palmeiras": "PAL",
  "Remo": "REM",
  "Santos": "SAN",
  "São Paulo": "SAO",
  "Vasco": "VAS",
  "Vitória": "VIT",
};

export function escudoCdnUrl(
  clube: string | null | undefined,
  size: EscudoSize = "60x60",
): string | null {
  if (!clube) return null;
  const abrev = ABREV[clube];
  return abrev ? `${CDN_BASE}/${abrev}/${size}.png` : null;
}
