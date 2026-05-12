// Sistema de oferta de troca + notificações entre times.
//
// Fluxo:
// 1. Usuário A vê jogador B (de time T) "à venda" no /mercado.
// 2. A oferece jogador X (do seu elenco) por B → cria Oferta.
// 3. Dono de B recebe notificação. Aceita/nega.
// 4. Se aceita → swap real (X muda pra T, B vai pra A). Notif vai pra A.
// 5. Se nega → notif vai pra A.

import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

export type StatusOferta = "pendente" | "aceita" | "negada" | "cancelada";

export interface Oferta {
  id: string;
  /** Chave do time que está ofertando */
  deChave: string;
  /** Chave do time que recebe a oferta (dono do atleta pedido) */
  paraChave: string;
  /** atleta_id do jogador oferecido (vem do elenco de `deChave`) */
  atletaOferecido: number;
  /** atleta_id do jogador pedido (do elenco de `paraChave`, à venda) */
  atletaPedido: number;
  status: StatusOferta;
  /** Unix ms */
  criadoEm: number;
  respondidoEm?: number;
  /** Mensagem opcional do ofertante */
  mensagem?: string;
}

export type TipoNotif =
  | "oferta_recebida"
  | "oferta_aceita"
  | "oferta_negada";

export interface Notif {
  id: string;
  /** Chave do destinatário */
  chave: string;
  tipo: TipoNotif;
  /** Id da oferta relacionada */
  ofertaId: string;
  lida: boolean;
  criadoEm: number;
}

function genId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return encodeHex(buf);
}

/* --- Ofertas ----------------------------------------------------------- */

export async function getOferta(
  kv: Deno.Kv,
  id: string,
): Promise<Oferta | null> {
  const r = await kv.get<Oferta>(["oferta", id]);
  return r.value;
}

export async function setOferta(kv: Deno.Kv, oferta: Oferta): Promise<void> {
  await kv.set(["oferta", oferta.id], oferta);
}

export async function criarOferta(
  kv: Deno.Kv,
  data: Omit<Oferta, "id" | "status" | "criadoEm">,
): Promise<Oferta> {
  const oferta: Oferta = {
    id: genId(),
    status: "pendente",
    criadoEm: Date.now(),
    ...data,
  };
  await setOferta(kv, oferta);
  // Indexes pra listar por usuário
  await kv.set(
    ["ofertas_recebidas", oferta.paraChave, oferta.id],
    oferta.id,
  );
  await kv.set(
    ["ofertas_enviadas", oferta.deChave, oferta.id],
    oferta.id,
  );
  // Notif pro destinatário
  await criarNotif(kv, {
    chave: oferta.paraChave,
    tipo: "oferta_recebida",
    ofertaId: oferta.id,
  });
  return oferta;
}

export async function listarOfertasRecebidas(
  kv: Deno.Kv,
  chave: string,
  filtro?: { status?: StatusOferta },
): Promise<Oferta[]> {
  const out: Oferta[] = [];
  for await (
    const entry of kv.list<string>({
      prefix: ["ofertas_recebidas", chave],
    })
  ) {
    const oferta = await getOferta(kv, entry.value);
    if (!oferta) continue;
    if (filtro?.status && oferta.status !== filtro.status) continue;
    out.push(oferta);
  }
  out.sort((a, b) => b.criadoEm - a.criadoEm);
  return out;
}

export async function listarOfertasEnviadas(
  kv: Deno.Kv,
  chave: string,
): Promise<Oferta[]> {
  const out: Oferta[] = [];
  for await (
    const entry of kv.list<string>({
      prefix: ["ofertas_enviadas", chave],
    })
  ) {
    const oferta = await getOferta(kv, entry.value);
    if (oferta) out.push(oferta);
  }
  out.sort((a, b) => b.criadoEm - a.criadoEm);
  return out;
}

/* --- Notificações ------------------------------------------------------ */

export async function criarNotif(
  kv: Deno.Kv,
  data: Omit<Notif, "id" | "lida" | "criadoEm">,
): Promise<Notif> {
  const notif: Notif = {
    id: genId(),
    lida: false,
    criadoEm: Date.now(),
    ...data,
  };
  await kv.set(["notif", notif.chave, notif.id], notif);
  return notif;
}

export async function listarNotifs(
  kv: Deno.Kv,
  chave: string,
  apenasNaoLidas = false,
): Promise<Notif[]> {
  const out: Notif[] = [];
  for await (
    const entry of kv.list<Notif>({ prefix: ["notif", chave] })
  ) {
    if (apenasNaoLidas && entry.value.lida) continue;
    out.push(entry.value);
  }
  out.sort((a, b) => b.criadoEm - a.criadoEm);
  return out;
}

export async function marcarNotifLida(
  kv: Deno.Kv,
  chave: string,
  id: string,
): Promise<void> {
  const r = await kv.get<Notif>(["notif", chave, id]);
  if (r.value) {
    await kv.set(["notif", chave, id], { ...r.value, lida: true });
  }
}

export async function contarNotifsNaoLidas(
  kv: Deno.Kv,
  chave: string,
): Promise<number> {
  let n = 0;
  for await (
    const entry of kv.list<Notif>({ prefix: ["notif", chave] })
  ) {
    if (!entry.value.lida) n++;
  }
  return n;
}
