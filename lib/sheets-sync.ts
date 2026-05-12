// Sincroniza o histórico de pontuação por rodada a partir da planilha
// pública do Google Sheets (alimentada pelo n8n do Ian).
//
// Estrutura esperada (linhas 4-12, a partir da coluna 6):
//   ,#,#,TIME,DONO,PONTOS_TOTAL,R1,R2,...,R38

const SHEET_ID = "1slpm0ICeWtp49vnBZ8IIvAbllOZ03ZLY6deVDCeKoMg";
const GID = "1458536969";

const CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// Mapping DONO normalizado (lowercase, sem acento) → chave do KV
const DONO_TO_CHAVE: Record<string, string> = {
  aguiar: "aguiar",
  ian: "ian",
  costa: "costa",
  brito: "brito",
  domingos: "domingos",
  jose: "jose",
  ze: "jose", // planilha usa "ZÉ"
  leo: "leo",
  armando: "armando",
  jp: "jp",
  john: "jp", // planilha usa "JOHN"
};

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function parseNumero(s: string): number {
  // "893,1" → 893.1; "" ou "0" → 0
  const limpo = (s ?? "").replace(/"/g, "").trim();
  if (!limpo) return 0;
  return Number(limpo.replace(/\./g, "").replace(",", ".")) || 0;
}

// CSV parser simples — campos quotados com vírgulas internas
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (c === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export interface HistoricoPorChave {
  [chave: string]: Record<string, number>; // rodada → pontos
}

export async function fetchHistoricoFromSheet(): Promise<{
  historico: HistoricoPorChave;
  donosNaoMapeados: string[];
}> {
  const r = await fetch(CSV_URL);
  if (!r.ok) throw new Error(`Sheets CSV → ${r.status}`);
  const csv = await r.text();
  const lines = csv.split("\n");

  const historico: HistoricoPorChave = {};
  const donosNaoMapeados: string[] = [];

  for (const line of lines) {
    const cols = parseCsvLine(line);
    // Esperado: ,#,POS,TIME,DONO,TOTAL,R1,R2,...
    // Header: col[1] = "#"  → pula
    if (!cols[1] || !cols[4]) continue;
    if (cols[1] === "#" || cols[1] === "" || isNaN(Number(cols[1]))) continue;

    const dono = cols[4]?.trim();
    if (!dono) continue;

    const chave = DONO_TO_CHAVE[norm(dono)];
    if (!chave) {
      donosNaoMapeados.push(dono);
      continue;
    }

    const rodadas: Record<string, number> = {};
    // R1 começa na col[6], vai até col[6+37] = col[43]
    for (let r = 1; r <= 38; r++) {
      const valor = cols[5 + r];
      if (valor == null) break;
      const pts = parseNumero(valor);
      // Só grava se rodada teve pontuação (>0); rodadas futuras vêm como 0
      if (pts > 0) rodadas[String(r)] = pts;
    }
    historico[chave] = rodadas;
  }

  return { historico, donosNaoMapeados };
}
