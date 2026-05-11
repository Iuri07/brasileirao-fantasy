// Resolve URL do escudo do clube. Prefere o CDN oficial do Cartola
// (sempre atualizado, cobre Athletico-PR que faltava no fallback local),
// e cai pros JPGs em /static/escudos/ se a abreviação for desconhecida.

import { escudoCdnUrl } from "./clubes-cdn.ts";

const FALLBACK_LOCAL: Record<string, string> = {
  "Athletico-PR": "athletico-pr.jpg",
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
  const cdn = escudoCdnUrl(clube);
  if (cdn) return cdn;
  const local = FALLBACK_LOCAL[clube];
  return local ? `/escudos/${local}` : null;
}
