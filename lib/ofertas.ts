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
  /** atleta_ids dos jogadores oferecidos (1-3, vêm do elenco de `deChave`).
   *  Trocas N:1 viram N:N quando destinatário aceita preenchendo
   *  atletasExtra com N-1 jogadores do próprio elenco. */
  atletasOferecidos: number[];
  /** atleta_id do jogador pedido (do elenco de `paraChave`, negociável) */
  atletaPedido: number;
  /** Atletas extras do destinatário escolhidos no momento de aceitar.
   *  length = atletasOferecidos.length - 1. Vazio/undefined em 1:1. */
  atletasExtra?: number[];
  status: StatusOferta;
  /** Unix ms */
  criadoEm: number;
  respondidoEm?: number;
  /** Mensagem opcional do ofertante */
  mensagem?: string;
  /** @deprecated Compat com ofertas pré-multi. Use atletasOferecidos. */
  atletaOferecido?: number;
}

/** Helper canônico — sempre lê via aqui pra cobrir ofertas legacy 1:1
 *  que ainda só tinham `atletaOferecido`. */
export function ofertaAtletasOferecidos(o: Oferta): number[] {
  if (o.atletasOferecidos && o.atletasOferecidos.length > 0) {
    return o.atletasOferecidos;
  }
  if (o.atletaOferecido) return [o.atletaOferecido];
  return [];
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

/** Lista TODAS as ofertas do KV (admin only — itera prefix completo).
 *  Filtro opcional por status (geralmente `pendente`). */
export async function listarTodasOfertas(
  kv: Deno.Kv,
  filtro?: { status?: StatusOferta },
): Promise<Oferta[]> {
  const out: Oferta[] = [];
  for await (const entry of kv.list<Oferta>({ prefix: ["oferta"] })) {
    const o = entry.value;
    if (filtro?.status && o.status !== filtro.status) continue;
    out.push(o);
  }
  out.sort((a, b) => b.criadoEm - a.criadoEm);
  return out;
}

/** Cancela uma oferta pendente. Idempotente — se não está pendente,
 *  retorna a oferta sem mudar. Usado pelo admin pra limpar ofertas
 *  esquecidas/incorretas. */
export async function cancelarOferta(
  kv: Deno.Kv,
  id: string,
): Promise<Oferta | null> {
  const oferta = await getOferta(kv, id);
  if (!oferta) return null;
  if (oferta.status !== "pendente") return oferta;
  oferta.status = "cancelada";
  oferta.respondidoEm = Date.now();
  await setOferta(kv, oferta);
  return oferta;
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
