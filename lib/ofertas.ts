// Sistema de oferta de troca + notificações entre times.

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { getDb, i64 } from "./db.ts";

export type StatusOferta = "pendente" | "aceita" | "negada" | "cancelada";

export interface Oferta {
  id: string;
  deChave: string;
  paraChave: string;
  /** Lista de atletas oferecidos (1-3). */
  atletasOferecidos: number[];
  /** Atleta pedido (do elenco do destinatário, negociável). */
  atletaPedido: number;
  /** Atletas extras escolhidos pelo destinatário (length = atletasOferecidos.length - 1). */
  atletasExtra?: number[];
  status: StatusOferta;
  criadoEm: number;
  respondidoEm?: number;
  mensagem?: string;
  /** @deprecated Compat com ofertas pré-multi. Use atletasOferecidos. */
  atletaOferecido?: number;
}

/** Helper canônico — cobre ofertas legacy. */
export function ofertaAtletasOferecidos(o: Oferta): number[] {
  if (o.atletasOferecidos && o.atletasOferecidos.length > 0) {
    return o.atletasOferecidos;
  }
  if (o.atletaOferecido) return [o.atletaOferecido];
  return [];
}

export type TipoNotif = "oferta_recebida" | "oferta_aceita" | "oferta_negada";

export interface Notif {
  id: string;
  chave: string;
  tipo: TipoNotif;
  ofertaId: string;
  lida: boolean;
  criadoEm: number;
}

function genId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

// ============================================================
// OFERTAS
// ============================================================

interface OfertaRow {
  id: string;
  de_chave: string;
  para_chave: string;
  atleta_pedido: number;
  status: StatusOferta;
  criado_em: number;
  respondido_em: number | null;
  mensagem: string | null;
}

function rowToOferta(
  r: OfertaRow,
  oferecidos: number[],
  extras: number[],
): Oferta {
  return {
    id: r.id,
    deChave: r.de_chave,
    paraChave: r.para_chave,
    atletasOferecidos: oferecidos,
    atletaPedido: r.atleta_pedido,
    atletasExtra: extras.length > 0 ? extras : undefined,
    status: r.status,
    criadoEm: r.criado_em,
    respondidoEm: r.respondido_em ?? undefined,
    mensagem: r.mensagem ?? undefined,
  };
}

function loadOfertaParts(
  id: string,
): { oferecidos: number[]; extras: number[] } {
  const db = getDb();
  const ofRows = db.prepare(
    "SELECT atleta_id FROM oferta_oferecidos WHERE oferta_id=? ORDER BY ordem",
  ).all<{ atleta_id: number }>(id);
  const exRows = db.prepare(
    "SELECT atleta_id FROM oferta_extras WHERE oferta_id=? ORDER BY ordem",
  ).all<{ atleta_id: number }>(id);
  return {
    oferecidos: ofRows.map((r) => r.atleta_id),
    extras: exRows.map((r) => r.atleta_id),
  };
}

export function getOferta(id: string): Promise<Oferta | null> {
  const r = getDb().prepare("SELECT * FROM ofertas WHERE id=?").get<OfertaRow>(
    id,
  );
  if (!r) return Promise.resolve(null);
  const { oferecidos, extras } = loadOfertaParts(id);
  return Promise.resolve(rowToOferta(r, oferecidos, extras));
}

export function setOferta(oferta: Oferta): Promise<void> {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO ofertas (id, de_chave, para_chave, atleta_pedido, status, criado_em, respondido_em, mensagem) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (id) DO UPDATE SET " +
        "  status=excluded.status, respondido_em=excluded.respondido_em, mensagem=excluded.mensagem",
    ).run(
      oferta.id,
      oferta.deChave,
      oferta.paraChave,
      oferta.atletaPedido,
      oferta.status,
      i64(oferta.criadoEm),
      oferta.respondidoEm ? i64(oferta.respondidoEm) : null,
      oferta.mensagem ?? null,
    );
    db.prepare("DELETE FROM oferta_oferecidos WHERE oferta_id=?").run(
      oferta.id,
    );
    db.prepare("DELETE FROM oferta_extras WHERE oferta_id=?").run(oferta.id);
    const insOf = db.prepare(
      "INSERT INTO oferta_oferecidos (oferta_id, atleta_id, ordem) VALUES (?, ?, ?)",
    );
    const lista = ofertaAtletasOferecidos(oferta);
    lista.forEach((id, i) => insOf.run(oferta.id, id, i));
    if (oferta.atletasExtra && oferta.atletasExtra.length > 0) {
      const insEx = db.prepare(
        "INSERT INTO oferta_extras (oferta_id, atleta_id, ordem) VALUES (?, ?, ?)",
      );
      oferta.atletasExtra.forEach((id, i) => insEx.run(oferta.id, id, i));
    }
  })();
  return Promise.resolve();
}

export async function criarOferta(
  data: Omit<Oferta, "id" | "status" | "criadoEm">,
): Promise<Oferta> {
  const oferta: Oferta = {
    id: genId(),
    status: "pendente",
    criadoEm: Date.now(),
    ...data,
  };
  await setOferta(oferta);
  await criarNotif({
    chave: oferta.paraChave,
    tipo: "oferta_recebida",
    ofertaId: oferta.id,
  });
  return oferta;
}

export function listarOfertasRecebidas(
  chave: string,
  filtro?: { status?: StatusOferta },
): Promise<Oferta[]> {
  const db = getDb();
  const where = filtro?.status
    ? "WHERE para_chave=? AND status=?"
    : "WHERE para_chave=?";
  const args = filtro?.status ? [chave, filtro.status] : [chave];
  const rows = db.prepare(
    `SELECT * FROM ofertas ${where} ORDER BY criado_em DESC`,
  )
    .all<OfertaRow>(...args);
  const out: Oferta[] = [];
  for (const r of rows) {
    const { oferecidos, extras } = loadOfertaParts(r.id);
    out.push(rowToOferta(r, oferecidos, extras));
  }
  return Promise.resolve(out);
}

export function listarOfertasEnviadas(chave: string): Promise<Oferta[]> {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM ofertas WHERE de_chave=? ORDER BY criado_em DESC",
  )
    .all<OfertaRow>(chave);
  const out: Oferta[] = [];
  for (const r of rows) {
    const { oferecidos, extras } = loadOfertaParts(r.id);
    out.push(rowToOferta(r, oferecidos, extras));
  }
  return Promise.resolve(out);
}

export function listarTodasOfertas(
  filtro?: { status?: StatusOferta },
): Promise<Oferta[]> {
  const db = getDb();
  const where = filtro?.status ? "WHERE status=?" : "";
  const args = filtro?.status ? [filtro.status] : [];
  const rows = db.prepare(
    `SELECT * FROM ofertas ${where} ORDER BY criado_em DESC`,
  )
    .all<OfertaRow>(...args);
  const out: Oferta[] = [];
  for (const r of rows) {
    const { oferecidos, extras } = loadOfertaParts(r.id);
    out.push(rowToOferta(r, oferecidos, extras));
  }
  return Promise.resolve(out);
}

export async function cancelarOferta(id: string): Promise<Oferta | null> {
  const oferta = await getOferta(id);
  if (!oferta) return null;
  if (oferta.status !== "pendente") return oferta;
  oferta.status = "cancelada";
  oferta.respondidoEm = Date.now();
  await setOferta(oferta);
  return oferta;
}

// ============================================================
// NOTIFICAÇÕES
// ============================================================

export function criarNotif(
  data: Omit<Notif, "id" | "lida" | "criadoEm">,
): Promise<Notif> {
  const notif: Notif = {
    id: genId(),
    lida: false,
    criadoEm: Date.now(),
    ...data,
  };
  getDb().prepare(
    "INSERT INTO notificacoes (id, chave, tipo, oferta_id, lida, criado_em) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(notif.id, notif.chave, notif.tipo, notif.ofertaId, i64(notif.criadoEm));
  return Promise.resolve(notif);
}

export function listarNotifs(
  chave: string,
  apenasNaoLidas = false,
): Promise<Notif[]> {
  const where = apenasNaoLidas ? "WHERE chave=? AND lida=0" : "WHERE chave=?";
  const rows = getDb().prepare(
    `SELECT id, chave, tipo, oferta_id, lida, criado_em
       FROM notificacoes ${where}
   ORDER BY criado_em DESC`,
  ).all<{
    id: string;
    chave: string;
    tipo: TipoNotif;
    oferta_id: string;
    lida: number;
    criado_em: number;
  }>(chave);
  return Promise.resolve(rows.map((r) => ({
    id: r.id,
    chave: r.chave,
    tipo: r.tipo,
    ofertaId: r.oferta_id,
    lida: r.lida === 1,
    criadoEm: r.criado_em,
  })));
}

export function marcarNotifLida(chave: string, id: string): Promise<void> {
  getDb().prepare("UPDATE notificacoes SET lida=1 WHERE id=? AND chave=?")
    .run(id, chave);
  return Promise.resolve();
}

export function contarNotifsNaoLidas(chave: string): Promise<number> {
  const r = getDb().prepare(
    "SELECT COUNT(*) AS n FROM notificacoes WHERE chave=? AND lida=0",
  )
    .get<{ n: number }>(chave);
  return Promise.resolve(r?.n ?? 0);
}
