// Mapeia códigos do scout do Cartola pra labels legíveis + classificação
// de "evento relevante" (alta importância = aparece na timeline).

export interface ScoutInfo {
  label: string;
  icon: string;
  tipo: "positivo" | "negativo" | "neutro";
  /** Considerado evento "chave" pra timeline (vs ruído de jogo) */
  chave?: boolean;
}

export const SCOUT: Record<string, ScoutInfo> = {
  G: { label: "Gol", icon: "⚽", tipo: "positivo", chave: true },
  A: { label: "Assistência", icon: "🎯", tipo: "positivo", chave: true },
  FT: { label: "Na trave", icon: "🥅", tipo: "neutro", chave: true },
  FD: { label: "Finalização defendida", icon: "🎯", tipo: "neutro" },
  FF: { label: "Finalização fora", icon: "↗", tipo: "neutro" },
  FS: { label: "Falta sofrida", icon: "🛡", tipo: "positivo" },
  FC: { label: "Falta cometida", icon: "👟", tipo: "negativo" },
  DS: { label: "Desarme", icon: "🧱", tipo: "positivo" },
  PS: { label: "Pênalti sofrido", icon: "✋", tipo: "positivo", chave: true },
  PP: { label: "Pênalti perdido", icon: "✗", tipo: "negativo", chave: true },
  PC: { label: "Pênalti cometido", icon: "👎", tipo: "negativo", chave: true },
  CA: { label: "Cartão amarelo", icon: "🟨", tipo: "negativo", chave: true },
  CV: { label: "Cartão vermelho", icon: "🟥", tipo: "negativo", chave: true },
  GC: { label: "Gol contra", icon: "😬", tipo: "negativo", chave: true },
  I: { label: "Impedimento", icon: "🚩", tipo: "negativo" },
  PI: { label: "Passe incompleto", icon: "→", tipo: "negativo" },
  PE: { label: "Passe errado", icon: "✗", tipo: "negativo" },
  // Goleiro
  DE: { label: "Defesa", icon: "🧤", tipo: "positivo" },
  DD: { label: "Defesa difícil", icon: "🧤", tipo: "positivo", chave: true },
  DP: { label: "Defesa de pênalti", icon: "🦾", tipo: "positivo", chave: true },
  GS: { label: "Gol sofrido", icon: "😨", tipo: "negativo", chave: true },
  SG: { label: "Jogo sem sofrer gols", icon: "🧤", tipo: "positivo" },
  // Técnico
  V: { label: "Vitória", icon: "🏆", tipo: "positivo", chave: true },
};

export interface EventoScout {
  codigo: string;
  qtd: number;
  info: ScoutInfo;
}

export function eventos(
  scout: Record<string, number> | undefined,
): EventoScout[] {
  if (!scout) return [];
  const out: EventoScout[] = [];
  for (const [codigo, qtd] of Object.entries(scout)) {
    const info = SCOUT[codigo];
    if (!info || qtd <= 0) continue;
    out.push({ codigo, qtd, info });
  }
  // Ordem: chaves primeiro, depois por positivo→negativo
  out.sort((a, b) => {
    if (!!a.info.chave !== !!b.info.chave) return a.info.chave ? -1 : 1;
    const w = { positivo: 0, neutro: 1, negativo: 2 };
    return w[a.info.tipo] - w[b.info.tipo];
  });
  return out;
}
