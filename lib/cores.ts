// Cores e padrão visual por clube. Usado pra renderizar a camisa SVG
// estilizada, aproximando o uniforme real.
//
// Pattern:
//   solid     — corpo monocromático
//   vstripes  — duas listras verticais da cor secundária sobre a primária
//   hstripes  — três faixas horizontais (hoops) da secundária sobre a primária
//   sash      — faixa diagonal da secundária (Vasco-style)

export type CoresPattern = "solid" | "vstripes" | "hstripes" | "sash";

export interface CoresClube {
  primary: string;
  secondary: string;
  pattern: CoresPattern;
}

const CORES: Record<string, CoresClube> = {
  "Athletico-PR": {
    primary: "#B8232C",
    secondary: "#000000",
    pattern: "vstripes",
  },
  "Atlético-MG": {
    primary: "#000000",
    secondary: "#FFFFFF",
    pattern: "vstripes",
  },
  "Bahia": { primary: "#FFFFFF", secondary: "#005CB7", pattern: "hstripes" },
  "Botafogo": { primary: "#000000", secondary: "#FFFFFF", pattern: "vstripes" },
  "Bragantino": {
    primary: "#FFFFFF",
    secondary: "#B8232C",
    pattern: "hstripes",
  },
  "RB Bragantino": {
    primary: "#FFFFFF",
    secondary: "#B8232C",
    pattern: "hstripes",
  },
  "Chapecoense": {
    primary: "#FFFFFF",
    secondary: "#0F8D2A",
    pattern: "vstripes",
  },
  "Corinthians": { primary: "#FFFFFF", secondary: "#000000", pattern: "solid" },
  "Coritiba": { primary: "#FFFFFF", secondary: "#0F8D2A", pattern: "vstripes" },
  "Cruzeiro": { primary: "#003DA5", secondary: "#FFFFFF", pattern: "solid" },
  "Flamengo": { primary: "#B8232C", secondary: "#000000", pattern: "hstripes" },
  "Fluminense": {
    primary: "#7A0F1F",
    secondary: "#0F4730",
    pattern: "vstripes",
  },
  "Grêmio": { primary: "#0E72B5", secondary: "#000000", pattern: "vstripes" },
  "Internacional": {
    primary: "#B8232C",
    secondary: "#FFFFFF",
    pattern: "solid",
  },
  "Mirassol": { primary: "#FFD400", secondary: "#0F8D2A", pattern: "solid" },
  "Palmeiras": { primary: "#005A2C", secondary: "#FFFFFF", pattern: "solid" },
  "Remo": { primary: "#005CB7", secondary: "#FFFFFF", pattern: "vstripes" },
  "Santos": { primary: "#FFFFFF", secondary: "#000000", pattern: "solid" },
  "São Paulo": {
    primary: "#FFFFFF",
    secondary: "#B8232C",
    pattern: "hstripes",
  },
  "Vasco": { primary: "#000000", secondary: "#FFFFFF", pattern: "sash" },
  "Vitória": { primary: "#B8232C", secondary: "#000000", pattern: "vstripes" },
};

const FALLBACK: CoresClube = {
  primary: "#1B1D26",
  secondary: "#7A7B82",
  pattern: "solid",
};

// Cartola API passou a devolver abreviações (BOT, FLA, CAM, etc.) em
// nome_fantasia e nome — antes vinham nomes completos ("Botafogo",
// "Flamengo"). Sem esse mapa, tudo caía no FALLBACK e as camisas
// SVG ficavam pretas.
const ABREV_TO_NOME: Record<string, string> = {
  BAH: "Bahia",
  BOT: "Botafogo",
  RBB: "RB Bragantino",
  CHA: "Chapecoense",
  COR: "Corinthians",
  CFC: "Coritiba",
  CRU: "Cruzeiro",
  FLA: "Flamengo",
  FLU: "Fluminense",
  GRE: "Grêmio",
  INT: "Internacional",
  MIR: "Mirassol",
  PAL: "Palmeiras",
  REM: "Remo",
  SAN: "Santos",
  SAO: "São Paulo",
  VAS: "Vasco",
  VIT: "Vitória",
  CAM: "Atlético-MG",
  CAP: "Athletico-PR",
};

export function coresClube(clube: string | null | undefined): CoresClube {
  if (!clube) return FALLBACK;
  // Tenta lookup direto (nome completo) primeiro; se não achar,
  // tenta normalizar de abreviação pra nome completo.
  const direto = CORES[clube];
  if (direto) return direto;
  const nomeExpandido = ABREV_TO_NOME[clube.toUpperCase()];
  if (nomeExpandido) return CORES[nomeExpandido] ?? FALLBACK;
  return FALLBACK;
}
