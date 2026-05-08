import type { JogadorKV } from "./types.ts";

export interface JogadorComSub extends JogadorKV {
  substituido: boolean;
}

function soma(arr: JogadorKV[]): number {
  return arr.reduce((s, j) => s + (j.pontos ?? 0), 0);
}

function topN(play: JogadorKV[], pos: string, n: number): JogadorKV[] {
  return play
    .filter((j) => j.posicao === pos)
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
    .slice(0, n);
}

function topNTitulares(play: JogadorKV[], pos: string, n: number): JogadorKV[] {
  return play
    .filter((j) => j.posicao === pos && j.escalacao === "Sim")
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
    .slice(0, n);
}

export function calcularMelhorTime(todos: JogadorKV[]): JogadorComSub[] {
  const play = todos.filter((j) => j.escalacao === "Sim" || j.escalacao === "Banco");

  // Técnico: soma de todos os jogadores / 23
  const tecnicoScore = Math.round((soma(todos) / 23) * 100) / 100;

  const slots: Array<{ pos: string; n: number }> = [
    { pos: "Goleiro",  n: 1 },
    { pos: "Zagueiro", n: 2 },
    { pos: "Lateral",  n: 2 },
    { pos: "Meia",     n: 3 },
    { pos: "Atacante", n: 3 },
  ];

  const avaliacoes = slots.map(({ pos, n }) => {
    const subst   = topN(play, pos, n);
    const titular = topNTitulares(play, pos, n);
    return { pos, n, diff: soma(subst) - soma(titular), subst, titular };
  });

  // Posições onde substituição melhora — até 3
  const top3 = [...avaliacoes]
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3)
    .filter((a) => a.diff > 0)
    .map((a) => a.pos);

  const usados = new Set<number>();
  const resultado: JogadorComSub[] = [];

  for (const { pos } of slots) {
    const av = avaliacoes.find((a) => a.pos === pos)!;
    const vencedores = top3.includes(pos)
      ? av.subst
      : av.titular.length > 0
      ? av.titular
      : av.subst;

    for (const j of vencedores) {
      const substituido = j.escalacao === "Banco" && top3.includes(pos);
      resultado.push({ ...j, escalacao: substituido ? "Sim" : j.escalacao, substituido });
      usados.add(j.atleta_id);
    }
  }

  // Técnico
  for (const j of todos.filter((j) => j.posicao === "Técnico")) {
    if (!usados.has(j.atleta_id)) {
      resultado.push({ ...j, pontos: tecnicoScore, substituido: false });
      usados.add(j.atleta_id);
    }
  }

  // Restantes (banco / não escalados que não entraram)
  for (const j of todos) {
    if (!usados.has(j.atleta_id)) {
      resultado.push({ ...j, substituido: false });
      usados.add(j.atleta_id);
    }
  }

  return resultado;
}
