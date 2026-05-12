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

export function timeLigaInfo(chave: string): TimeLigaInfo | null {
  return TIMES[chave] ?? null;
}
