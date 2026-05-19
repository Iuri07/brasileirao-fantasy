// Histórico de trocas concluídas — registra cada oferta aceita pra
// permitir admin desfazer (mover players de volta aos elencos originais).

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { getElenco, setElenco } from "./kv.ts";
import { getDb } from "./db.ts";
import type { JogadorKV } from "./types.ts";

export type EscCat = "Sim" | "Banco" | "Não";

export interface TrocaConcluida {
  id: string;
  ofertaId: string;
  /** Unix ms */
  concluidaEm: number;
  desfeitaEm?: number;
  chaveA: string;
  atletaA: {
    atleta_id: number;
    apelido: string;
    escalacaoOriginal: EscCat;
  };
  chaveB: string;
  atletaB: {
    atleta_id: number;
    apelido: string;
    escalacaoOriginal: EscCat;
  };
}

function genId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

interface TrocaRow {
  id: string;
  oferta_id: string;
  chave_a: string;
  atleta_a_id: number;
  atleta_a_apelido: string;
  atleta_a_escalacao: EscCat;
  chave_b: string;
  atleta_b_id: number;
  atleta_b_apelido: string;
  atleta_b_escalacao: EscCat;
  criado_em: number;
  desfeito_em: number | null;
}

function rowToTroca(r: TrocaRow): TrocaConcluida {
  return {
    id: r.id,
    ofertaId: r.oferta_id,
    concluidaEm: r.criado_em,
    desfeitaEm: r.desfeito_em ?? undefined,
    chaveA: r.chave_a,
    atletaA: {
      atleta_id: r.atleta_a_id,
      apelido: r.atleta_a_apelido,
      escalacaoOriginal: r.atleta_a_escalacao,
    },
    chaveB: r.chave_b,
    atletaB: {
      atleta_id: r.atleta_b_id,
      apelido: r.atleta_b_apelido,
      escalacaoOriginal: r.atleta_b_escalacao,
    },
  };
}

export function getTroca(id: string): Promise<TrocaConcluida | null> {
  const r = getDb().prepare("SELECT * FROM historico_trocas WHERE id=?")
    .get<TrocaRow>(id);
  return Promise.resolve(r ? rowToTroca(r) : null);
}

export function registrarTroca(
  data: Omit<TrocaConcluida, "id" | "concluidaEm">,
): Promise<TrocaConcluida> {
  const troca: TrocaConcluida = {
    id: genId(),
    concluidaEm: Date.now(),
    ...data,
  };
  getDb().prepare(
    `INSERT INTO historico_trocas
      (id, oferta_id, chave_a, atleta_a_id, atleta_a_apelido, atleta_a_escalacao,
       chave_b, atleta_b_id, atleta_b_apelido, atleta_b_escalacao,
       criado_em, desfeito_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    troca.id,
    troca.ofertaId,
    troca.chaveA,
    troca.atletaA.atleta_id,
    troca.atletaA.apelido,
    troca.atletaA.escalacaoOriginal,
    troca.chaveB,
    troca.atletaB.atleta_id,
    troca.atletaB.apelido,
    troca.atletaB.escalacaoOriginal,
    troca.concluidaEm,
  );
  return Promise.resolve(troca);
}

export function listarTrocas(
  filtro?: { incluirDesfeitas?: boolean },
): Promise<TrocaConcluida[]> {
  const where = filtro?.incluirDesfeitas ? "" : "WHERE desfeito_em IS NULL";
  const rows = getDb().prepare(
    `SELECT * FROM historico_trocas ${where} ORDER BY criado_em DESC`,
  ).all<TrocaRow>();
  return Promise.resolve(rows.map(rowToTroca));
}

/** Reverte uma troca: move atletaA de volta pro elenco A (com sua
 *  escalação original) e atletaB de volta pro B. */
export async function desfazerTroca(
  id: string,
): Promise<
  | { ok: true; troca: TrocaConcluida }
  | { ok: false; erro: string }
> {
  const troca = await getTroca(id);
  if (!troca) return { ok: false, erro: "Troca não encontrada" };
  if (troca.desfeitaEm) return { ok: false, erro: "Troca já foi desfeita" };

  const [elencoA, elencoB] = await Promise.all([
    getElenco(troca.chaveA),
    getElenco(troca.chaveB),
  ]);
  if (!elencoA || !elencoB) {
    return { ok: false, erro: "Elenco sumiu" };
  }

  const idA = String(troca.atletaA.atleta_id);
  const idB = String(troca.atletaB.atleta_id);
  const jogA = elencoB.jogadores[idA];
  const jogB = elencoA.jogadores[idB];
  if (!jogA) {
    return {
      ok: false,
      erro:
        `Atleta ${troca.atletaA.apelido} não está mais no time ${troca.chaveB} — outra troca afetou ele depois`,
    };
  }
  if (!jogB) {
    return {
      ok: false,
      erro:
        `Atleta ${troca.atletaB.apelido} não está mais no time ${troca.chaveA} — outra troca afetou ele depois`,
    };
  }

  const restauradoA: JogadorKV = {
    ...jogA,
    escalacao: troca.atletaA.escalacaoOriginal,
  };
  const restauradoB: JogadorKV = {
    ...jogB,
    escalacao: troca.atletaB.escalacaoOriginal,
  };
  delete elencoB.jogadores[idA];
  delete elencoA.jogadores[idB];
  elencoA.jogadores[idA] = restauradoA;
  elencoB.jogadores[idB] = restauradoB;
  await setElenco(troca.chaveA, elencoA);
  await setElenco(troca.chaveB, elencoB);

  getDb().prepare("UPDATE historico_trocas SET desfeito_em=? WHERE id=?")
    .run(Date.now(), id);
  troca.desfeitaEm = Date.now();
  return { ok: true, troca };
}
