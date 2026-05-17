// Histórico de trocas concluídas — registra cada oferta aceita pra
// permitir admin desfazer (mover players de volta aos elencos originais).
//
// Persistido em KV em ["troca", id] + index ["trocas_concluidas", -ts, id]
// (timestamp negativo no key pra listar mais recentes primeiro com
// kv.list ascending sem precisar sort em memória).

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { getElenco, setElenco } from "./kv.ts";
import type { JogadorKV } from "./types.ts";

export type EscCat = "Sim" | "Banco" | "Não";

export interface TrocaConcluida {
  id: string;
  ofertaId: string;
  /** Unix ms */
  concluidaEm: number;
  /** Se desfeita pelo admin: ms da reversão. */
  desfeitaEm?: number;
  /** Time A — cedeu atletaA, recebeu atletaB (= oferta.deChave). */
  chaveA: string;
  atletaA: {
    atleta_id: number;
    apelido: string;
    /** Categoria de escalação de A no elenco A ANTES da troca. */
    escalacaoOriginal: EscCat;
  };
  /** Time B — cedeu atletaB, recebeu atletaA (= oferta.paraChave). */
  chaveB: string;
  atletaB: {
    atleta_id: number;
    apelido: string;
    /** Categoria de B no elenco B ANTES da troca. */
    escalacaoOriginal: EscCat;
  };
}

function genId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

export async function getTroca(
  kv: Deno.Kv,
  id: string,
): Promise<TrocaConcluida | null> {
  const r = await kv.get<TrocaConcluida>(["troca", id]);
  return r.value;
}

export async function registrarTroca(
  kv: Deno.Kv,
  data: Omit<TrocaConcluida, "id" | "concluidaEm">,
): Promise<TrocaConcluida> {
  const troca: TrocaConcluida = {
    id: genId(),
    concluidaEm: Date.now(),
    ...data,
  };
  // Key index com timestamp negativo pra ordem descendente natural
  await kv.atomic()
    .set(["troca", troca.id], troca)
    .set(
      ["trocas_concluidas", -troca.concluidaEm, troca.id],
      troca.id,
    )
    .commit();
  return troca;
}

export async function listarTrocas(
  kv: Deno.Kv,
  filtro?: { incluirDesfeitas?: boolean },
): Promise<TrocaConcluida[]> {
  const out: TrocaConcluida[] = [];
  // O index ["trocas_concluidas", -ts, id] dá listagem por ts desc
  // (porque negativo: mais recente = menor número = vem primeiro).
  for await (
    const entry of kv.list<string>({ prefix: ["trocas_concluidas"] })
  ) {
    const troca = await getTroca(kv, entry.value);
    if (!troca) continue;
    if (!filtro?.incluirDesfeitas && troca.desfeitaEm) continue;
    out.push(troca);
  }
  return out;
}

/** Reverte uma troca: move atletaA de volta pro elenco A (com sua
 *  escalação original) e atletaB de volta pro B. Marca a troca como
 *  desfeita pra não desfazer duas vezes. Falha se o atleta não estiver
 *  mais no elenco que esperamos (ex: foi transferido por outra troca). */
export async function desfazerTroca(
  kv: Deno.Kv,
  id: string,
): Promise<
  | { ok: true; troca: TrocaConcluida }
  | { ok: false; erro: string }
> {
  const troca = await getTroca(kv, id);
  if (!troca) return { ok: false, erro: "Troca não encontrada" };
  if (troca.desfeitaEm) return { ok: false, erro: "Troca já foi desfeita" };

  const [elencoA, elencoB] = await Promise.all([
    getElenco(kv, troca.chaveA),
    getElenco(kv, troca.chaveB),
  ]);
  if (!elencoA || !elencoB) {
    return { ok: false, erro: "Elenco sumiu" };
  }

  // Pós-troca esperado: atletaA está no elenco B, atletaB está no elenco A.
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

  // Reverte: A volta pro elenco A com escalação original; B volta pro B.
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
  await setElenco(kv, troca.chaveA, elencoA);
  await setElenco(kv, troca.chaveB, elencoB);

  // Marca desfeita pra não rodar de novo
  troca.desfeitaEm = Date.now();
  await kv.set(["troca", id], troca);
  return { ok: true, troca };
}
