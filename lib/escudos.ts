// Resolve URL do escudo do clube. Prefere os JPGs locais em
// /static/escudos/ — são os escudos OFICIAIS curados manualmente.
// O CDN da Cartola serve só placeholders estilizados (sigla colorida),
// então fica como último fallback caso apareça clube novo sem JPG.

import { escudoCdnUrl } from "./clubes-cdn.ts";

const LOCAL: Record<string, string> = {
  "Athletico-PR": "athletico-pr.jpg",
  "Athlético-PR": "athletico-pr.jpg",
  "Atlético-MG": "atletico-mg.jpg",
  "Bahia": "bahia.jpg",
  "Botafogo": "botafogo.jpg",
  "Bragantino": "Bragantino.jpg",
  "RB Bragantino": "Bragantino.jpg",
  "Chapecoense": "chapecoense.jpg",
  "Corinthians": "corinthians.jpg",
  "Coritiba": "coritiba.jpg",
  "Cruzeiro": "cruzeiro.jpg",
  "Flamengo": "flamengo.jpg",
  "Fluminense": "fluminense.jpg",
  "Grêmio": "gremio.jpg",
  "Internacional": "internacional.jpg",
  "Mirassol": "mirassol.jpg",
  "Palmeiras": "palmeiras.jpg",
  "Remo": "remo.jpg",
  "Santos": "santos.jpg",
  "São Paulo": "sao-paulo.jpg",
  "Vasco": "vasco.jpg",
  "Vitória": "vitoria.jpg",
};

export function escudoUrl(clube: string | null | undefined): string | null {
  if (!clube) return null;
  const local = LOCAL[clube];
  if (local) return `/escudos/${local}`;
  return escudoCdnUrl(clube);
}
