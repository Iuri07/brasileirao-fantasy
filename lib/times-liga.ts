// Identidade visual dos 9 times da Liga da Sexta.
// Logo em /static/times_escudos/ é fonte da verdade visual; sigla + cor
// servem de fallback caso o asset suma.

import type { CrestColor } from "../components/Crest.tsx";

export interface TimeLigaInfo {
  color: CrestColor;
  sigla: string;
  /** Override do nome quando a chave/nome interno não bate com o display */
  displayName?: string;
  /** Path absoluto do logo PNG; null se não tiver asset */
  logo: string | null;
  /** Cor neon única (CSS hex) usada como accent visual (border, stripe, glow).
      Diferente de `color` que mapeia pro splatter (limitado a 6 cores). */
  accent: string;
}

const TIMES: Record<string, TimeLigaInfo> = {
  aguiar: {
    color: "magenta",
    accent: "#FF1032", // vermelho vivo
    sigla: "FK",
    logo: "/times_escudos/filhos-de-kieza.png",
  },
  ian: {
    color: "orange",
    accent: "#FF6A00", // laranja
    sigla: "BF",
    logo: "/times_escudos/botafofo.png",
  },
  costa: {
    color: "yellow",
    accent: "#FF8C00", // laranja-âmbar (Malvadinhos FC)
    sigla: "IP",
    displayName: "Ilha de Paquetá",
    logo: "/times_escudos/ilha-de-paqueta.png",
  },
  brito: {
    color: "green",
    accent: "#FFD400", // amarelo ouro (Chutoca FC)
    sigla: "CG",
    displayName: "Crefilho da Gama",
    logo: "/times_escudos/crefilho-da-gama.png",
  },
  domingos: {
    color: "blue",
    accent: "#7CFF00", // verde lima (Bendermem 23)
    sigla: "B23",
    logo: "/times_escudos/bendermem.png",
  },
  jose: {
    color: "lime",
    accent: "#00A2FF", // azul elétrico (888 Partners)
    sigla: "888",
    logo: "/times_escudos/888-partners.png",
  },
  leo: {
    color: "blue",
    accent: "#0066FF", // azul royal (Todos com Bolsonaro / Moleicester)
    sigla: "MOL",
    displayName: "Moleicester City",
    logo: "/times_escudos/moleicester-city.png",
  },
  armando: {
    color: "magenta",
    accent: "#C000FF", // roxo/violeta (Piratas do Carille / Papai Chegou)
    sigla: "PCH",
    displayName: "Papai Chegou FC",
    logo: "/times_escudos/papai-chegou.png",
  },
  jp: {
    color: "orange",
    accent: "#FF007A", // rosa choque (Dorival Juniors / Pedro Álvares Pardal)
    sigla: "PAP",
    displayName: "Pedro Álvares Pardal",
    logo: "/times_escudos/pedro-alvares-pardal.png",
  },
};

/** Overrides editáveis pelo admin (logo, displayName). Setado por
 *  `applyVisualOverrides()` quando o middleware carrega o cache.
 *  Sync porque o consumo é em SSR e components — async espalharia
 *  refactor pelo app todo. */
const OVERRIDES: Map<string, { logo?: string; displayName?: string }> =
  new Map();

/** Atualiza o cache de overrides. Chamado pelo middleware na primeira
 *  request de cada processo, e pelo endpoint POST/DELETE de visual. */
export function applyVisualOverrides(
  overrides: Record<string, { logo?: string; displayName?: string }>,
): void {
  OVERRIDES.clear();
  for (const [chave, o] of Object.entries(overrides)) {
    if (o?.logo || o?.displayName) {
      OVERRIDES.set(chave, { logo: o.logo, displayName: o.displayName });
    }
  }
}

/** Limpa um override específico (admin DELETE). */
export function clearVisualOverride(chave: string): void {
  OVERRIDES.delete(chave);
}

/** Seta override pra um time específico (admin POST). */
export function setVisualOverride(
  chave: string,
  patch: { logo?: string; displayName?: string },
): void {
  const cur = OVERRIDES.get(chave) ?? {};
  OVERRIDES.set(chave, { ...cur, ...patch });
}

export function timeLigaInfo(chave: string): TimeLigaInfo | null {
  const base = TIMES[chave];
  if (!base) return null;
  const o = OVERRIDES.get(chave);
  if (!o) return base;
  // Merge override com defaults — não muta o TIMES original
  return {
    ...base,
    logo: o.logo ?? base.logo,
    displayName: o.displayName ?? base.displayName,
  };
}
