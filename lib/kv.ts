// Camada de acesso ao banco. Antes Deno KV, agora SQLite.
// Os nomes dos exports são mantidos pra minimizar churn nos call sites —
// só a assinatura mudou (sem `kv` param, usa o singleton de lib/db.ts).
//
// Tipos retornados (`ElencoKV`, `AtletaCacheKV`, etc) são os MESMOS
// que existiam antes pra manter compat com SSR/componentes/handlers.

import type {
  AtletaCacheKV,
  ElencoKV,
  JogadorKV,
  RodadaStatus,
} from "./types.ts";
import { getDb, i64 } from "./db.ts";
import { appStateGet, appStateSet } from "./app-state.ts";

export const DONOS_CHAVES: Record<string, string> = {
  "Aguiar": "aguiar",
  "Ian": "ian",
  "Costa": "costa",
  "Brito": "brito",
  "Domingos": "domingos",
  "José": "jose",
  "Leo": "leo",
  "Armando": "armando",
  "JP": "jp",
};

export const CHAVES_TIMES: Record<string, { nome_time: string; dono: string }> =
  {
    "aguiar": { nome_time: "FILHOS DE KIEZA", dono: "Aguiar" },
    "ian": { nome_time: "BOTAFOFO FR", dono: "Ian" },
    "costa": { nome_time: "MALVADINHOS FC", dono: "Costa" },
    "brito": { nome_time: "CHUTOCA FC", dono: "Brito" },
    "domingos": { nome_time: "BENDERMEM 23", dono: "Domingos" },
    "jose": { nome_time: "888 PARTNERS", dono: "José" },
    "leo": { nome_time: "TODOS COM BOLSONARO", dono: "Leo" },
    "armando": { nome_time: "PIRATAS DO CARILLE", dono: "Armando" },
    "jp": { nome_time: "DORIVAL JUNIORS", dono: "JP" },
  };

export const TODAS_CHAVES = Object.keys(CHAVES_TIMES);
export const POSICAO_CHAVES_CACHE = ["GOL", "LAT", "ZAG", "MEI", "ATA", "TEC"];
export const MAX_SUBS_AO_VIVO = 3;

/** Mapping posição_id Cartola → chave de cache. Usado pra coletar
 *  atletas por posição mesmo agora que o cache não é mais separado
 *  por posChave no storage. */
const POSICAO_ID_TO_CHAVE: Record<number, string> = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC",
};
const POSICAO_CHAVE_TO_ID: Record<string, number> = {
  GOL: 1,
  LAT: 2,
  ZAG: 3,
  MEI: 4,
  ATA: 5,
  TEC: 6,
};

// ============================================================
// SUBS USADAS (durante rodada ao vivo)
// ============================================================

// Coluna no elenco — só rodada atual importa. Quando muda de rodada,
// count zera automaticamente porque rodada não bate.
export function getSubsUsadas(rodada: number, chave: string): Promise<number> {
  const r = getDb().prepare(
    "SELECT subs_usadas_rodada AS rodada, subs_usadas_count AS count FROM elencos WHERE chave=?",
  ).get<{ rodada: number | null; count: number }>(chave);
  if (!r || r.rodada !== rodada) return Promise.resolve(0);
  return Promise.resolve(r.count);
}

export async function incrementSubsUsadas(
  rodada: number,
  chave: string,
): Promise<number> {
  const atual = await getSubsUsadas(rodada, chave);
  const proximo = atual + 1;
  getDb().prepare(
    "UPDATE elencos SET subs_usadas_rodada=?, subs_usadas_count=? WHERE chave=?",
  ).run(rodada, proximo, chave);
  return proximo;
}

// ============================================================
// MERCADO / NEGOCIÁVEIS (à venda)
// ============================================================

export function getAVenda(chave: string): Promise<number[]> {
  const rows = getDb().prepare("SELECT atleta_id FROM a_venda WHERE chave=?")
    .all<{ atleta_id: number }>(chave);
  return Promise.resolve(rows.map((r) => r.atleta_id));
}

export function setAVenda(chave: string, ids: number[]): Promise<void> {
  const uniq = Array.from(new Set(ids));
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM a_venda WHERE chave=?").run(chave);
    const ins = db.prepare(
      "INSERT INTO a_venda (atleta_id, chave) VALUES (?, ?)",
    );
    for (const id of uniq) ins.run(id, chave);
  })();
  return Promise.resolve();
}

export async function toggleAVenda(
  chave: string,
  atletaId: number,
): Promise<{ aVenda: boolean }> {
  const atual = await getAVenda(chave);
  const idx = atual.indexOf(atletaId);
  if (idx >= 0) {
    atual.splice(idx, 1);
    await setAVenda(chave, atual);
    return { aVenda: false };
  }
  atual.push(atletaId);
  await setAVenda(chave, atual);
  return { aVenda: true };
}

export function getAVendaGlobal(): Promise<Record<number, string>> {
  const rows = getDb().prepare("SELECT atleta_id, chave FROM a_venda")
    .all<{ atleta_id: number; chave: string }>();
  const out: Record<number, string> = {};
  for (const r of rows) out[r.atleta_id] = r.chave;
  return Promise.resolve(out);
}

// ============================================================
// INTERESSES (free agents / draft)
// ============================================================

export interface InteresseRegistro {
  chave: string;
  oferecido: number;
}

export function getInteressados(
  atletaId: number,
): Promise<InteresseRegistro[]> {
  const rows = getDb().prepare(
    "SELECT chave, atleta_oferecido AS oferecido FROM interesses WHERE atleta_alvo=? ORDER BY criado_em",
  ).all<InteresseRegistro>(atletaId);
  return Promise.resolve(rows);
}

export function setInteresse(
  atletaId: number,
  chave: string,
  oferecido: number,
): Promise<{ total: number }> {
  const db = getDb();
  db.prepare(
    "INSERT INTO interesses (chave, atleta_alvo, atleta_oferecido, criado_em) " +
      "VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (chave, atleta_alvo) DO UPDATE SET atleta_oferecido=excluded.atleta_oferecido",
  ).run(chave, atletaId, oferecido, i64(Date.now()));
  const total =
    db.prepare("SELECT COUNT(*) AS n FROM interesses WHERE atleta_alvo=?")
      .get<{ n: number }>(atletaId)?.n ?? 0;
  return Promise.resolve({ total });
}

export function removeInteresse(
  atletaId: number,
  chave: string,
): Promise<{ total: number }> {
  const db = getDb();
  db.prepare("DELETE FROM interesses WHERE atleta_alvo=? AND chave=?").run(
    atletaId,
    chave,
  );
  const total =
    db.prepare("SELECT COUNT(*) AS n FROM interesses WHERE atleta_alvo=?")
      .get<{ n: number }>(atletaId)?.n ?? 0;
  return Promise.resolve({ total });
}

export function getInteressadosBatch(
  atletaIds: number[],
): Promise<Record<number, InteresseRegistro[]>> {
  if (atletaIds.length === 0) return Promise.resolve({});
  const placeholders = atletaIds.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT atleta_alvo, chave, atleta_oferecido AS oferecido
       FROM interesses
      WHERE atleta_alvo IN (${placeholders})
   ORDER BY atleta_alvo, criado_em`,
  ).all<{ atleta_alvo: number } & InteresseRegistro>(...atletaIds);
  const out: Record<number, InteresseRegistro[]> = {};
  for (const r of rows) {
    (out[r.atleta_alvo] ??= []).push({
      chave: r.chave,
      oferecido: r.oferecido,
    });
  }
  return Promise.resolve(out);
}

// ============================================================
// PRIORIDADE PESSOAL DOS INTERESSES
// ============================================================

export function getMinhaPrioridade(chave: string): Promise<number[]> {
  const rows = getDb().prepare(
    "SELECT atleta_id FROM prioridades WHERE chave=? ORDER BY ordem",
  ).all<{ atleta_id: number }>(chave);
  return Promise.resolve(rows.map((r) => r.atleta_id));
}

export function setMinhaPrioridade(
  chave: string,
  ordem: number[],
): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM prioridades WHERE chave=?").run(chave);
    const ins = db.prepare(
      "INSERT INTO prioridades (chave, atleta_id, ordem) VALUES (?, ?, ?)",
    );
    ordem.forEach((atletaId, i) => ins.run(chave, atletaId, i));
  })();
  return Promise.resolve();
}

export async function appendPrioridade(
  chave: string,
  atletaId: number,
): Promise<number[]> {
  const atual = await getMinhaPrioridade(chave);
  if (atual.includes(atletaId)) return atual;
  const nova = [...atual, atletaId];
  await setMinhaPrioridade(chave, nova);
  return nova;
}

export async function removePrioridade(
  chave: string,
  atletaId: number,
): Promise<number[]> {
  const atual = await getMinhaPrioridade(chave);
  const nova = atual.filter((id) => id !== atletaId);
  if (nova.length !== atual.length) {
    await setMinhaPrioridade(chave, nova);
  }
  return nova;
}

// ============================================================
// DRAFT ORDEM
// ============================================================

export function getDraftOrdem(): Promise<string[]> {
  const stored = appStateGet<string[]>("draft_ordem");
  if (stored && stored.length > 0) {
    const set = new Set(stored);
    const faltando = TODAS_CHAVES.filter((c) => !set.has(c));
    return Promise.resolve(
      faltando.length === 0 ? stored : [...stored, ...faltando],
    );
  }
  return Promise.resolve([...TODAS_CHAVES]);
}

export function setDraftOrdem(ordem: string[]): Promise<void> {
  appStateSet("draft_ordem", ordem);
  return Promise.resolve();
}

export async function getPosicaoDraft(chave: string): Promise<number | null> {
  const ordem = await getDraftOrdem();
  const idx = ordem.indexOf(chave);
  return idx >= 0 ? idx + 1 : null;
}

// ============================================================
// ELENCOS + JOGADORES (relational, mas API retorna ElencoKV)
// ============================================================

interface JogadorRow {
  chave: string;
  atleta_id: number;
  apelido_api: string;
  clube: string;
  clube_id: number;
  posicao: string;
  posicao_id: number;
  escalacao: "Sim" | "Banco" | "Não";
  status_id: number | null;
  provavel: number | null;
  lesionado: number | null;
  suspenso: number | null;
  nulo: number | null;
  entrou_em_campo: number | null;
  clube_casa: string | null;
  clube_fora: string | null;
  pontos: number | null;
}

function rowToJogador(r: JogadorRow): JogadorKV {
  const b = (v: number | null) => v === null ? null : v === 1;
  return {
    atleta_id: r.atleta_id,
    apelido_api: r.apelido_api,
    clube: r.clube,
    clube_id: r.clube_id,
    posicao: r.posicao,
    posicao_id: r.posicao_id,
    escalacao: r.escalacao,
    status_id: r.status_id,
    provavel: b(r.provavel),
    lesionado: b(r.lesionado),
    suspenso: b(r.suspenso),
    nulo: b(r.nulo),
    entrou_em_campo: b(r.entrou_em_campo),
    clube_casa: r.clube_casa,
    clube_fora: r.clube_fora,
    pontos: r.pontos,
  };
}

export function getElenco(chave: string): Promise<ElencoKV | null> {
  const db = getDb();
  const meta = db.prepare(
    "SELECT chave, nome_time, dono FROM elencos WHERE chave=?",
  )
    .get<{ chave: string; nome_time: string; dono: string }>(chave);
  if (!meta) return Promise.resolve(null);
  const rows = db.prepare("SELECT * FROM jogadores WHERE chave=?")
    .all<JogadorRow>(chave);
  const jogadores: Record<string, JogadorKV> = {};
  for (const r of rows) jogadores[String(r.atleta_id)] = rowToJogador(r);
  return Promise.resolve({
    nome_time: meta.nome_time,
    dono: meta.dono,
    chave: meta.chave,
    jogadores,
  });
}

export function setElenco(chave: string, elenco: ElencoKV): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    // Não tocar nas colunas de override (nome_time_override etc) nem em
    // melhor_time_json/subs_usadas — só nome_time/dono que mudam aqui.
    // Se o row não existe, criamos com defaults nulos pros overrides.
    db.prepare(
      "INSERT INTO elencos (chave, nome_time, dono) VALUES (?, ?, ?) " +
        "ON CONFLICT (chave) DO UPDATE SET nome_time=excluded.nome_time, dono=excluded.dono",
    ).run(chave, elenco.nome_time, elenco.dono);
    db.prepare("DELETE FROM jogadores WHERE chave=?").run(chave);
    const ins = db.prepare(
      `INSERT INTO jogadores
        (chave, atleta_id, apelido_api, clube, clube_id, posicao, posicao_id,
         escalacao, status_id, provavel, lesionado, suspenso, nulo,
         entrou_em_campo, clube_casa, clube_fora, pontos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const b = (v: boolean | null) => v === null ? null : v ? 1 : 0;
    for (const j of Object.values(elenco.jogadores)) {
      ins.run(
        chave,
        j.atleta_id,
        j.apelido_api,
        j.clube,
        j.clube_id,
        j.posicao,
        j.posicao_id,
        j.escalacao,
        j.status_id,
        b(j.provavel),
        b(j.lesionado),
        b(j.suspenso),
        b(j.nulo),
        b(j.entrou_em_campo),
        j.clube_casa,
        j.clube_fora,
        j.pontos,
      );
    }
    // Invalida cache derivado (melhor_time é coluna no próprio row)
    db.prepare("UPDATE elencos SET melhor_time_json=NULL WHERE chave=?").run(chave);
  })();
  return Promise.resolve();
}

export async function getAllElencos(): Promise<Record<string, ElencoKV>> {
  const result: Record<string, ElencoKV> = {};
  for (const chave of TODAS_CHAVES) {
    const e = await getElenco(chave);
    if (e) result[chave] = e;
  }
  return result;
}

// ============================================================
// RODADA ATUAL
// ============================================================

export function getRodadaStatus(): Promise<RodadaStatus | null> {
  return Promise.resolve(appStateGet<RodadaStatus>("rodada_atual"));
}

export function isRodadaEmAndamento(
  status: RodadaStatus["status"] | null | undefined,
): boolean {
  return status === "ao_vivo" || status === "aguardando_inicio";
}

export async function isAoVivo(): Promise<boolean> {
  const s = await getRodadaStatus();
  return isRodadaEmAndamento(s?.status);
}

export function setRodadaStatus(status: RodadaStatus): Promise<void> {
  appStateSet("rodada_atual", status);
  return Promise.resolve();
}

// ============================================================
// CACHES (atletas + partidas)
// ============================================================

export function getAtletasCache(
  posChave: string,
): Promise<AtletaCacheKV | null> {
  const posId = POSICAO_CHAVE_TO_ID[posChave];
  if (!posId) return Promise.resolve(null);
  const rows = getDb().prepare(
    "SELECT atleta_id, apelido, clube, clube_id, posicao, posicao_id, status_id, foto, atualizado_em " +
      "FROM atletas_cache WHERE posicao_id=?",
  ).all<{
    atleta_id: number;
    apelido: string;
    clube: string;
    clube_id: number;
    posicao: string;
    posicao_id: number;
    status_id: number | null;
    foto: string | null;
    atualizado_em: string;
  }>(posId);
  if (rows.length === 0) return Promise.resolve(null);
  const atletas: AtletaCacheKV["atletas"] = {};
  for (const r of rows) {
    atletas[String(r.atleta_id)] = {
      apelido: r.apelido,
      clube: r.clube,
      clube_id: r.clube_id,
      posicao: r.posicao,
      posicao_id: r.posicao_id,
      status_id: r.status_id,
      foto: r.foto,
    };
  }
  return Promise.resolve({
    atualizadoEm: rows[0].atualizado_em,
    atletas,
  });
}

/** Sobrescreve o cache pra UMA posição. Usado pelo sync-atletas que
 *  monta os dados por posChave. */
export function setAtletasCache(
  posChave: string,
  cache: AtletaCacheKV,
): Promise<void> {
  const posId = POSICAO_CHAVE_TO_ID[posChave];
  if (!posId) return Promise.resolve();
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM atletas_cache WHERE posicao_id=?").run(posId);
    const ins = db.prepare(
      "INSERT INTO atletas_cache (atleta_id, apelido, clube, clube_id, posicao, posicao_id, status_id, foto, atualizado_em) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const [idStr, a] of Object.entries(cache.atletas)) {
      ins.run(
        Number(idStr),
        a.apelido,
        a.clube,
        a.clube_id,
        a.posicao,
        a.posicao_id,
        a.status_id ?? null,
        a.foto ?? null,
        cache.atualizadoEm,
      );
    }
  })();
  return Promise.resolve();
}

export function getPartidasCache(): Promise<
  Record<string, { casa: string; fora: string }> | null
> {
  return Promise.resolve(
    appStateGet<Record<string, { casa: string; fora: string }>>("partidas_cache"),
  );
}

export function setPartidasCache(
  data: Record<string, { casa: string; fora: string }>,
): Promise<void> {
  appStateSet("partidas_cache", data);
  return Promise.resolve();
}

export function donoToChave(dono: string): string | undefined {
  return DONOS_CHAVES[dono];
}

// ============================================================
// FOTOS (mapa atleta_id → URL pra renderizar campo/listas)
// ============================================================

export async function getFotos(): Promise<Record<string, string>> {
  const { cdn } = await import("./cdn.ts");
  const rows = getDb().prepare(
    "SELECT atleta_id, foto FROM atletas_cache WHERE foto IS NOT NULL",
  ).all<{ atleta_id: number; foto: string }>();
  const out: Record<string, string> = {};
  for (const r of rows) {
    const wrapped = cdn(r.foto);
    if (wrapped) out[String(r.atleta_id)] = wrapped;
  }
  return out;
}

// Re-export do mapping pra módulos que importam de kv.ts
export { POSICAO_ID_TO_CHAVE };
