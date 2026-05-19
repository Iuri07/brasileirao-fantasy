// Lê o CSV e gera um de_para_jogadores.json atualizado
import deParaRaw from "../static/de_para_jogadores.json" with { type: "json" };

type DeParaJogador = {
  atleta_id: number;
  nome_csv: string;
  apelido_api: string;
  clube: string;
  clube_id: number;
  posicao: string;
  posicao_id: number;
  escalacao: string;
};

type DeParaTime = {
  dono: string;
  nome_time: string;
  jogadores: DeParaJogador[];
};
const dePara = deParaRaw as { times: DeParaTime[] };

const POSICAO: Record<string, { nome: string; id: number }> = {
  GOL: { nome: "Goleiro", id: 1 },
  LAT: { nome: "Lateral", id: 2 },
  ZAG: { nome: "Zagueiro", id: 3 },
  MEI: { nome: "Meia", id: 4 },
  ATA: { nome: "Atacante", id: 5 },
  TEC: { nome: "Técnico", id: 6 },
};

const POSITIONS = new Set(Object.keys(POSICAO));
const ESCALACOES = new Set(["Sim", "Banco", "Não"]);

// lookup nome_csv → dados (de todos os times do de_para)
const lookup = new Map<string, DeParaJogador>();
for (const time of dePara.times) {
  for (const j of time.jogadores) {
    lookup.set(j.nome_csv.trim().toLowerCase(), j);
    lookup.set(j.apelido_api.trim().toLowerCase(), j);
  }
}

// Jogadores adicionados via swap — não estavam no de_para original
const extras: DeParaJogador[] = [
  {
    atleta_id: 39656,
    nome_csv: "Alan Franco (Atlético-MG)",
    apelido_api: "Alan Franco",
    clube: "Atlético-MG",
    clube_id: 234,
    posicao: "Meia",
    posicao_id: 4,
    escalacao: "Sim",
  },
  {
    atleta_id: 109573,
    nome_csv: "Martinelli",
    apelido_api: "Martinelli",
    clube: "Fluminense",
    clube_id: 266,
    posicao: "Meia",
    posicao_id: 4,
    escalacao: "Não",
  },
  {
    atleta_id: 99440,
    nome_csv: "Baralhas",
    apelido_api: "Baralhas",
    clube: "Vitória",
    clube_id: 285,
    posicao: "Meia",
    posicao_id: 4,
    escalacao: "Não",
  },
  {
    atleta_id: 108133,
    nome_csv: "Isidro Pitta",
    apelido_api: "Isidro Pitta",
    clube: "Bragantino",
    clube_id: 288,
    posicao: "Atacante",
    posicao_id: 5,
    escalacao: "Sim",
  },
  {
    atleta_id: 104519,
    nome_csv: "Camilo",
    apelido_api: "Camilo",
    clube: "Chapecoense",
    clube_id: 275,
    posicao: "Meia",
    posicao_id: 4,
    escalacao: "Não",
  },
  {
    atleta_id: 42135,
    nome_csv: "Willian",
    apelido_api: "Willian",
    clube: "Grêmio",
    clube_id: 284,
    posicao: "Meia",
    posicao_id: 4,
    escalacao: "Sim",
  },
];
for (const j of extras) {
  lookup.set(j.nome_csv.trim().toLowerCase(), j);
  lookup.set(j.apelido_api.trim().toLowerCase(), j);
}

const TIMES = [
  { dono: "Aguiar", nome_time: "FILHOS DE KIEZA", offset: 0 },
  { dono: "Ian", nome_time: "BOTAFOFO FR", offset: 6 },
  { dono: "Costa", nome_time: "MALVADINHOS FC", offset: 12 },
  { dono: "Brito", nome_time: "CHUTOCA FC", offset: 18 },
  { dono: "Domingos", nome_time: "BENDERMEM 23", offset: 24 },
  { dono: "José", nome_time: "888 PARTNERS", offset: 30 },
  { dono: "Leo", nome_time: "TODOS COM BOLSONARO", offset: 36 },
  { dono: "Armando", nome_time: "PIRATAS DO CARILLE", offset: 42 },
  { dono: "JP", nome_time: "DORIVAL JUNIORS", offset: 48 },
];

const csv = await Deno.readTextFile(
  "./static/players/CARTOLA V2 - 1. ELENCO.csv",
);
const lines = csv.split(/\r?\n/);

// Linhas de dados: começa na linha 3 (0-indexed), pos no col 0 deve ser posição válida
const dataLines = lines.slice(3).filter((line) => {
  const col0 = line.split(",")[0]?.trim();
  return POSITIONS.has(col0);
});

const unmatched: string[] = [];

const times = TIMES.map((team) => {
  const jogadores: DeParaJogador[] = [];
  for (const line of dataLines) {
    const cols = line.split(",");
    const pos = cols[team.offset]?.trim();
    const nome = cols[team.offset + 1]?.trim();
    const esc = cols[team.offset + 5]?.trim();

    if (!pos || !nome || !POSITIONS.has(pos)) continue;
    if (!esc || !ESCALACOES.has(esc)) continue;

    const match = lookup.get(nome.toLowerCase());
    if (match) {
      // evita duplicata no mesmo time
      if (!jogadores.find((j) => j.atleta_id === match.atleta_id)) {
        jogadores.push({
          ...match,
          posicao: POSICAO[pos].nome,
          posicao_id: POSICAO[pos].id,
          escalacao: esc as "Sim" | "Banco" | "Não",
        });
      }
    } else {
      unmatched.push(`[${team.nome_time}] ${nome} (${pos}) esc=${esc}`);
    }
  }
  return { dono: team.dono, nome_time: team.nome_time, jogadores };
});

console.log("\n=== TIMES E CONTAGEM ===");
for (const t of times) {
  console.log(`${t.nome_time}: ${t.jogadores.length} jogadores`);
}

if (unmatched.length) {
  console.log("\n=== SEM CORRESPONDÊNCIA (precisam atleta_id manual) ===");
  for (const u of unmatched) console.log(" -", u);
}

await Deno.writeTextFile(
  "./static/de_para_jogadores.json",
  JSON.stringify({ times }, null, 2),
);
console.log("\nde_para_jogadores.json atualizado.");
