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

export function coresClube(clube: string | null | undefined): CoresClube {
  if (!clube) return FALLBACK;
  return CORES[clube] ?? FALLBACK;
}
