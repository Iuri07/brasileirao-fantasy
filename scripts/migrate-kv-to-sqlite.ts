#!/usr/bin/env -S deno run -A --unstable-kv
/// <reference lib="deno.unstable" />
// deno-lint-ignore-file no-explicit-any
// Migra dados do Deno KV (kv.db) pro SQLite novo (app.db).
//
// Uso:
//   KV_PATH=/data/kv.db DB_PATH=/data/app.db deno run -A --unstable-kv scripts/migrate-kv-to-sqlite.ts
//
// Idempotente — pode rodar múltiplas vezes, sempre upsert.
// NÃO toca no kv.db original (só leitura).

import { getDb } from "../lib/db.ts";

const KV_PATH = Deno.env.get("KV_PATH") || "/data/kv.db";

console.log(`[migrate] KV (read) = ${KV_PATH}`);
console.log(
  `[migrate] DB (write) = ${Deno.env.get("DB_PATH") || "./data/app.db"}`,
);

const kv = await Deno.openKv(KV_PATH);
const db = getDb();

let counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

// Helpers
function asInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  return null;
}

async function migrate() {
  console.log("[migrate] starting...");

  db.transaction(() => {
    // Limpa qualquer dado pré-existente pra garantir consistência
    db.exec(`
      DELETE FROM jogadores;
      DELETE FROM elencos;
      DELETE FROM historico;
      DELETE FROM email_map;
      DELETE FROM sessions;
      DELETE FROM oauth_state;
      DELETE FROM rodada_atual;
      DELETE FROM simulando;
      DELETE FROM atletas_cache;
      DELETE FROM partidas_cache;
      DELETE FROM melhor_time;
      DELETE FROM a_venda;
      DELETE FROM interesses;
      DELETE FROM subs_usadas;
      DELETE FROM time_visual;
      DELETE FROM oferta_oferecidos;
      DELETE FROM oferta_extras;
      DELETE FROM ofertas;
      DELETE FROM notificacoes;
      DELETE FROM historico_trocas;
      DELETE FROM evento_hist;
      DELETE FROM scout_estado;
      DELETE FROM mercado_cache;
      DELETE FROM classificacao;
      DELETE FROM draft_dias;
      DELETE FROM draft_ordem;
      DELETE FROM draft_meta;
      DELETE FROM prioridades;
      DELETE FROM mercado_status_cache;
    `);
  })();

  // 1. ELENCOS + JOGADORES
  const insElenco = db.prepare(
    "INSERT INTO elencos (chave, nome_time, dono) VALUES (?, ?, ?)",
  );
  const insJog = db.prepare(
    `INSERT INTO jogadores
      (chave, atleta_id, apelido_api, clube, clube_id, posicao, posicao_id,
       escalacao, status_id, provavel, lesionado, suspenso, nulo,
       entrou_em_campo, clube_casa, clube_fora, pontos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for await (
    const e of kv.list<{
      nome_time: string;
      dono: string;
      chave: string;
      jogadores: Record<string, {
        atleta_id: number;
        apelido_api: string;
        clube: string;
        clube_id: number;
        posicao: string;
        posicao_id: number;
        escalacao: string;
        status_id: number | null;
        provavel: boolean | null;
        lesionado: boolean | null;
        suspenso: boolean | null;
        nulo: boolean | null;
        entrou_em_campo: boolean | null;
        clube_casa: string | null;
        clube_fora: string | null;
        pontos: number | null;
      }>;
    }>({ prefix: ["elenco"] })
  ) {
    const elenco = e.value;
    db.transaction(() => {
      insElenco.run(elenco.chave, elenco.nome_time, elenco.dono);
      for (const j of Object.values(elenco.jogadores)) {
        insJog.run(
          elenco.chave,
          j.atleta_id,
          j.apelido_api,
          j.clube,
          j.clube_id,
          j.posicao,
          j.posicao_id,
          j.escalacao,
          j.status_id ?? null,
          asInt(j.provavel),
          asInt(j.lesionado),
          asInt(j.suspenso),
          asInt(j.nulo),
          asInt(j.entrou_em_campo),
          j.clube_casa ?? null,
          j.clube_fora ?? null,
          j.pontos ?? null,
        );
      }
    })();
    bump("elencos");
  }

  // 2. HISTORICO
  const insHist = db.prepare(
    "INSERT INTO historico (chave, rodada, pontos) VALUES (?, ?, ?)",
  );
  for await (
    const e of kv.list<Record<string, number>>({ prefix: ["historico"] })
  ) {
    const chave = String(e.key[1]);
    for (const [rodadaStr, pontos] of Object.entries(e.value)) {
      insHist.run(chave, Number(rodadaStr), pontos);
      bump("historico");
    }
  }

  // 3. EMAIL MAP
  const emailEntry = await kv.get<Record<string, string>>([
    "auth",
    "email_map",
  ]);
  if (emailEntry.value) {
    const insEmail = db.prepare(
      "INSERT INTO email_map (email, chave) VALUES (?, ?)",
    );
    for (const [email, chave] of Object.entries(emailEntry.value)) {
      insEmail.run(email, chave);
      bump("email_map");
    }
  }

  // 4. SESSIONS
  const insSession = db.prepare(
    "INSERT INTO sessions (id, role, chave, email, name, picture, created_at, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      role: "user" | "admin";
      chave?: string;
      email?: string;
      name?: string;
      picture?: string;
      expiresAt: number;
    }>({ prefix: ["session"] })
  ) {
    const s = e.value;
    if (s.expiresAt < Date.now()) continue; // skip expired
    insSession.run(
      String(e.key[1]),
      s.role,
      s.chave ?? null,
      s.email ?? null,
      s.name ?? null,
      s.picture ?? null,
      s.expiresAt - 30 * 24 * 60 * 60 * 1000, // created_at aproximado
      s.expiresAt,
    );
    bump("sessions");
  }

  // 5. RODADA ATUAL
  const rodada = await kv.get<{
    status: "aguardando" | "aguardando_inicio" | "ao_vivo";
    rodada: number;
    atualizadoEm?: string;
    fechamento?: Record<string, unknown>;
  }>(["rodada_atual"]);
  if (rodada.value) {
    db.prepare(
      "INSERT INTO rodada_atual (id, status, rodada, atualizado_em, fechamento_json) VALUES (1, ?, ?, ?, ?)",
    ).run(
      rodada.value.status,
      rodada.value.rodada,
      rodada.value.atualizadoEm ?? null,
      rodada.value.fechamento ? JSON.stringify(rodada.value.fechamento) : null,
    );
    bump("rodada_atual");
  }

  // 6. SIMULANDO
  const sim = await kv.get<boolean>(["simulando"]);
  if (sim.value !== null) {
    db.prepare("INSERT INTO simulando (id, ativo) VALUES (1, ?)")
      .run(sim.value ? 1 : 0);
    bump("simulando");
  }

  // 7. ATLETAS CACHE (era por posChave)
  const insAt = db.prepare(
    "INSERT INTO atletas_cache (atleta_id, apelido, clube, clube_id, posicao, posicao_id, status_id, foto, atualizado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      atualizadoEm: string;
      atletas: Record<string, {
        apelido: string;
        clube: string;
        clube_id: number;
        posicao: string;
        posicao_id: number;
        status_id: number | null;
        foto?: string | null;
      }>;
    }>({ prefix: ["atletas_cache"] })
  ) {
    const cache = e.value;
    db.transaction(() => {
      for (const [idStr, a] of Object.entries(cache.atletas)) {
        try {
          insAt.run(
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
          bump("atletas_cache");
        } catch (_) {
          // dup atleta_id (atleta apareceu em mais de uma posição no KV antigo)
          // ignora
        }
      }
    })();
  }

  // 8. PARTIDAS CACHE
  const partidas = await kv.get<Record<string, { casa: string; fora: string }>>(
    [
      "partidas_cache",
    ],
  );
  if (partidas.value) {
    const ins = db.prepare(
      "INSERT INTO partidas_cache (clube_id, casa, fora) VALUES (?, ?, ?)",
    );
    for (const [k, v] of Object.entries(partidas.value)) {
      ins.run(Number(k), v.casa, v.fora);
      bump("partidas_cache");
    }
  }

  // 9. MELHOR_TIME (cache derivado — vai ser recomputado pelo cron, mas migra mesmo)
  const insMt = db.prepare(
    "INSERT INTO melhor_time (chave, computed_json) VALUES (?, ?)",
  );
  for await (const e of kv.list<unknown>({ prefix: ["melhor_time"] })) {
    insMt.run(String(e.key[1]), JSON.stringify(e.value));
    bump("melhor_time");
  }

  // 10. A_VENDA (era array por chave)
  const insAv = db.prepare(
    "INSERT INTO a_venda (atleta_id, chave) VALUES (?, ?)",
  );
  for await (const e of kv.list<number[]>({ prefix: ["a_venda"] })) {
    const chave = String(e.key[1]);
    for (const id of e.value) {
      try {
        insAv.run(id, chave);
        bump("a_venda");
      } catch { /* dup */ }
    }
  }

  // 11. INTERESSADOS (formato: chave="interessados", atletaId → InteresseRegistro[])
  const insInt = db.prepare(
    "INSERT INTO interesses (chave, atleta_alvo, atleta_oferecido, criado_em) VALUES (?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<Array<{ chave: string; oferecido?: number } | string>>({
      prefix: ["interessados"],
    })
  ) {
    const atletaAlvo = Number(e.key[1]);
    const now = Date.now();
    for (const r of e.value) {
      const c = typeof r === "string" ? r : r.chave;
      const of = typeof r === "string" ? 0 : (r.oferecido ?? 0);
      try {
        insInt.run(c, atletaAlvo, of, now);
        bump("interesses");
      } catch { /* dup */ }
    }
  }

  // 12. SUBS USADAS
  const insSubs = db.prepare(
    "INSERT INTO subs_usadas (rodada, chave, count) VALUES (?, ?, ?)",
  );
  for await (const e of kv.list<number>({ prefix: ["subs"] })) {
    const rodada = Number(e.key[1]);
    const chave = String(e.key[2]);
    insSubs.run(rodada, chave, e.value);
    bump("subs_usadas");
  }

  // 13. TIME_VISUAL
  const insTv = db.prepare(
    "INSERT INTO time_visual (chave, nome_time, display_name, logo, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      nome_time?: string;
      displayName?: string;
      logo?: string;
      updatedAt?: string;
    }>({ prefix: ["time_visual"] })
  ) {
    const chave = String(e.key[1]);
    const v = e.value;
    insTv.run(
      chave,
      v.nome_time ?? null,
      v.displayName ?? null,
      v.logo ?? null,
      v.updatedAt ?? null,
    );
    bump("time_visual");
  }

  // 14. OFERTAS
  const insOf = db.prepare(
    "INSERT INTO ofertas (id, de_chave, para_chave, atleta_pedido, status, criado_em, respondido_em, mensagem) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insOferecido = db.prepare(
    "INSERT INTO oferta_oferecidos (oferta_id, atleta_id, ordem) VALUES (?, ?, ?)",
  );
  const insExtra = db.prepare(
    "INSERT INTO oferta_extras (oferta_id, atleta_id, ordem) VALUES (?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      id: string;
      deChave: string;
      paraChave: string;
      atletasOferecidos?: number[];
      atletaOferecido?: number;
      atletaPedido: number;
      atletasExtra?: number[];
      status: string;
      criadoEm: number;
      respondidoEm?: number;
      mensagem?: string;
    }>({ prefix: ["oferta"] })
  ) {
    const o = e.value;
    const oferecidos = (o.atletasOferecidos && o.atletasOferecidos.length > 0)
      ? o.atletasOferecidos
      : (o.atletaOferecido ? [o.atletaOferecido] : []);
    db.transaction(() => {
      insOf.run(
        o.id,
        o.deChave,
        o.paraChave,
        o.atletaPedido,
        o.status,
        o.criadoEm,
        o.respondidoEm ?? null,
        o.mensagem ?? null,
      );
      oferecidos.forEach((id, i) => insOferecido.run(o.id, id, i));
      if (o.atletasExtra) {
        o.atletasExtra.forEach((id, i) => insExtra.run(o.id, id, i));
      }
    })();
    bump("ofertas");
  }

  // 15. NOTIFICACOES
  const insNotif = db.prepare(
    "INSERT INTO notificacoes (id, chave, tipo, oferta_id, lida, criado_em) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      id: string;
      chave: string;
      tipo: string;
      ofertaId: string;
      lida: boolean;
      criadoEm: number;
    }>({ prefix: ["notif"] })
  ) {
    const n = e.value;
    insNotif.run(n.id, n.chave, n.tipo, n.ofertaId, n.lida ? 1 : 0, n.criadoEm);
    bump("notificacoes");
  }

  // 16. HISTORICO_TROCAS
  const insTroca = db.prepare(
    `INSERT INTO historico_trocas
      (id, oferta_id, chave_a, atleta_a_id, atleta_a_apelido, atleta_a_escalacao,
       chave_b, atleta_b_id, atleta_b_apelido, atleta_b_escalacao,
       criado_em, desfeito_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for await (
    const e of kv.list<{
      id: string;
      ofertaId: string;
      concluidaEm: number;
      desfeitaEm?: number;
      chaveA: string;
      atletaA: {
        atleta_id: number;
        apelido: string;
        escalacaoOriginal: string;
      };
      chaveB: string;
      atletaB: {
        atleta_id: number;
        apelido: string;
        escalacaoOriginal: string;
      };
    }>({ prefix: ["troca"] })
  ) {
    const t = e.value;
    insTroca.run(
      t.id,
      t.ofertaId,
      t.chaveA,
      t.atletaA.atleta_id,
      t.atletaA.apelido,
      t.atletaA.escalacaoOriginal,
      t.chaveB,
      t.atletaB.atleta_id,
      t.atletaB.apelido,
      t.atletaB.escalacaoOriginal,
      t.concluidaEm,
      t.desfeitaEm ?? null,
    );
    bump("historico_trocas");
  }

  // 17. EVENTO_HIST
  const insEvt = db.prepare(
    "INSERT OR IGNORE INTO evento_hist (rodada, ts, atleta_id, codigo, qtd) VALUES (?, ?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<{
      ts: number;
      rodada: number;
      atletaId: number;
      codigo: string;
      qtd: number;
    }>({ prefix: ["evento_hist"] })
  ) {
    const v = e.value;
    insEvt.run(v.rodada, v.ts, v.atletaId, v.codigo, v.qtd);
    bump("evento_hist");
  }

  // 18. SCOUT_ESTADO
  const insScout = db.prepare(
    "INSERT OR REPLACE INTO scout_estado (rodada, atleta_id, codigo, qtd) VALUES (?, ?, ?, ?)",
  );
  for await (
    const e of kv.list<Record<string, number>>({ prefix: ["scout_estado"] })
  ) {
    const rodada = Number(e.key[1]);
    const atletaId = Number(e.key[2]);
    for (const [codigo, qtd] of Object.entries(e.value)) {
      insScout.run(rodada, atletaId, codigo, qtd);
      bump("scout_estado");
    }
  }

  // 19. DRAFT
  const draftOrdem = await kv.get<string[]>(["draft_ordem"]);
  if (draftOrdem.value) {
    const ins = db.prepare(
      "INSERT INTO draft_ordem (chave, ordem) VALUES (?, ?)",
    );
    draftOrdem.value.forEach((c, i) => {
      ins.run(c, i);
      bump("draft_ordem");
    });
  }

  const draftDias = await kv.get<number[]>(["draft_dias_resolucao"]);
  if (draftDias.value) {
    const ins = db.prepare("INSERT INTO draft_dias (dia_semana) VALUES (?)");
    for (const d of draftDias.value) {
      try {
        ins.run(d);
        bump("draft_dias");
      } catch { /* dup */ }
    }
  }

  const draftMeta = await kv.get<{
    ciclo: number;
    rodadaCiclo: number;
    rodadaBase: number;
  }>(["draft_meta"]);
  if (draftMeta.value) {
    db.prepare(
      "INSERT INTO draft_meta (id, ciclo, rodada_ciclo, rodada_base) VALUES (1, ?, ?, ?)",
    ).run(
      draftMeta.value.ciclo,
      draftMeta.value.rodadaCiclo,
      draftMeta.value.rodadaBase,
    );
    bump("draft_meta");
  }

  // 20. PRIORIDADES
  const insPrio = db.prepare(
    "INSERT INTO prioridades (chave, atleta_id, ordem) VALUES (?, ?, ?)",
  );
  for await (const e of kv.list<number[]>({ prefix: ["minha_prioridade"] })) {
    const chave = String(e.key[1]);
    e.value.forEach((atletaId, i) => {
      try {
        insPrio.run(chave, atletaId, i);
        bump("prioridades");
      } catch { /* dup */ }
    });
  }

  // 21. CLASSIFICACAO (externa, JSON solto)
  const classif = await kv.get<unknown>(["classificacao"]);
  if (classif.value) {
    db.prepare(
      "INSERT INTO classificacao (id, data_json) VALUES (1, ?)",
    ).run(JSON.stringify(classif.value));
    bump("classificacao");
  }

  console.log("[migrate] done. counts:", JSON.stringify(counts, null, 2));
}

await migrate();
kv.close();
db.close();
console.log("[migrate] ✓");
