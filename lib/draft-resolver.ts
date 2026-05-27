// Aplica resolução de conflitos do draft em TURNOS.
//
// Algoritmo:
//   Turno = 1, 2, 3, ...:
//     1. Cada user (na ordem atual do draft) propõe a #1 prioridade
//        que ainda tem (se tiver trocas restantes).
//     2. Agrupa propostas por atleta_alvo. Pra cada atleta com 2+
//        candidatos, o mais alto na ordem do draft leva.
//     3. Aplica swap pros vencedores; notifica perdedores.
//     4. Remove o atleta resolvido das prioridades de TODOS os users.
//     5. Vencedores vão pro FIM da ordem do draft (rotação snake) —
//        múltiplos vencedores no mesmo turno mantêm a ordem relativa.
//   Repete enquanto alguém propor algo no turno.
//
// Resulta em:
//   - User pode pegar vários atletas (1 por turno), respeitando saldo
//     de trocas com mercado e prioridade pessoal.
//   - Quem está mais alto no draft só ganha o 1º conflito; ao ganhar,
//     cai pro fim e perde prioridade nos próximos turnos.

import { getDb } from "./db.ts";
import {
  getAllElencos,
  getAtletasCache,
  getDraftOrdem,
  getElenco,
  getMinhaPrioridade,
  getPartidasCache,
  getRodadaStatus,
  getTodosInteresses,
  POSICAO_CHAVES_CACHE,
  setDraftOrdem,
  setElenco,
  TODAS_CHAVES,
} from "./kv.ts";
import type { JogadorKV } from "./types.ts";
import { criarNotif } from "./ofertas.ts";
import { registrarTroca } from "./historico-trocas.ts";
import {
  adjustTrocasMercadoCount,
  getMaxTrocasMercado,
  getTrocasMercadoCount,
} from "./trocas-mercado.ts";
import { appStateSet } from "./app-state.ts";
import { getNomeTimeDisplay } from "./time-visual.ts";

export interface ResolucaoResultado {
  vencedores: Array<{
    chave: string;
    nomeTime: string;
    atletaAlvoId: number;
    atletaAlvoApelido: string;
    atletaOferecidoId: number;
    atletaOferecidoApelido: string;
    turno: number;
  }>;
  perdedores: Array<{
    chave: string;
    atletaAlvoApelido: string;
    vencedorNomeTime: string;
    turno: number;
  }>;
  /** Atletas com interesse mas SEM pick (oferecido sumiu, todos sem
   *  trocas, etc.) */
  semWinner: number;
  errosCount: number;
  turnos: number;
  duracaoMs: number;
}

interface AtletaCacheData {
  apelido: string;
  clube: string;
  clube_id: number;
  posicao: string;
  posicao_id: number;
  status_id: number | null;
}

export async function resolverDraft(): Promise<ResolucaoResultado> {
  const t0 = Date.now();
  const interessesMap = await getTodosInteresses();
  const out: ResolucaoResultado = {
    vencedores: [],
    perdedores: [],
    semWinner: 0,
    errosCount: 0,
    turnos: 0,
    duracaoMs: 0,
  };
  if (Object.keys(interessesMap).length === 0) {
    out.duracaoMs = Date.now() - t0;
    appStateSet("draft_last_resolution_at", Date.now());
    return out;
  }

  const [ordemInicial, rodadaStatus] = await Promise.all([
    getDraftOrdem(),
    getRodadaStatus(),
  ]);
  const rodadaAtual = rodadaStatus?.rodada ?? 0;
  const max = getMaxTrocasMercado();

  // Estado mutável.
  let ordemAtual = [...ordemInicial];
  const restantes = new Map<string, number>();
  for (const chave of TODAS_CHAVES) {
    const count = getTrocasMercadoCount(chave, rodadaAtual);
    restantes.set(chave, Math.max(0, max - count));
  }

  // Lookup (chave, atletaAlvo) → atleta_oferecido. Vem dos interesses.
  const oferecidoPorPar = new Map<string, number>();
  for (const [alvoIdStr, lista] of Object.entries(interessesMap)) {
    const alvoId = Number(alvoIdStr);
    for (const i of lista) {
      oferecidoPorPar.set(`${i.chave}:${alvoId}`, i.oferecido);
    }
  }

  // Prioridades locais por chave — só atletas com interesse real
  // (prioridades legacy filtradas). Vai sendo encurtada conforme
  // resolvemos atletas.
  const prioridadesLocal = new Map<string, number[]>();
  for (const chave of TODAS_CHAVES) {
    const prio = await getMinhaPrioridade(chave);
    const filtrada = prio.filter((id) =>
      oferecidoPorPar.has(`${chave}:${id}`)
    );
    if (filtrada.length > 0) prioridadesLocal.set(chave, filtrada);
  }

  // Preload caches.
  const cacheGlobal = new Map<number, AtletaCacheData>();
  await Promise.all(POSICAO_CHAVES_CACHE.map(async (posChave) => {
    const cache = await getAtletasCache(posChave);
    if (!cache) return;
    for (const [idStr, a] of Object.entries(cache.atletas)) {
      cacheGlobal.set(Number(idStr), {
        apelido: a.apelido,
        clube: a.clube,
        clube_id: a.clube_id,
        posicao: a.posicao,
        posicao_id: a.posicao_id,
        status_id: a.status_id,
      });
    }
  }));
  const partidasCache = await getPartidasCache();
  const db = getDb();

  // Remove um atleta das prioridades de TODOS os users (limpa pra
  // próximos turnos).
  const removeAtletaDeTodos = (alvoId: number) => {
    for (const [c, p] of prioridadesLocal.entries()) {
      const filtrado = p.filter((id) => id !== alvoId);
      if (filtrado.length === 0) prioridadesLocal.delete(c);
      else if (filtrado.length !== p.length) {
        prioridadesLocal.set(c, filtrado);
      }
    }
  };

  // Loop por turnos.
  while (out.turnos < 50) {
    out.turnos += 1;
    // 1. Coletar propostas — todo user que tem prioridade e trocas
    //    propõe seu top.
    type Proposal = { chave: string; alvoId: number };
    const proposals: Proposal[] = [];
    for (const chave of ordemAtual) {
      if ((restantes.get(chave) ?? 0) <= 0) continue;
      const prio = prioridadesLocal.get(chave);
      if (!prio || prio.length === 0) continue;
      proposals.push({ chave, alvoId: prio[0] });
    }
    if (proposals.length === 0) break;

    // 2. Agrupar por atleta. Pra ordem dentro de cada grupo usar a
    //    ordemAtual (índice = prioridade no draft).
    const ordemIdx = new Map<string, number>();
    ordemAtual.forEach((c, i) => ordemIdx.set(c, i));
    const byAtleta = new Map<number, string[]>();
    for (const p of proposals) {
      const arr = byAtleta.get(p.alvoId) ?? [];
      arr.push(p.chave);
      byAtleta.set(p.alvoId, arr);
    }

    const winnersTurno: string[] = [];

    // 3. Resolve cada atleta. Ordem de resolução: por prioridade do
    //    draft do "mais alto candidato" (cosmético — não afeta saídas
    //    porque resolução é independente por atleta).
    const atletasOrdenados = [...byAtleta.entries()].sort((a, b) => {
      const minA = Math.min(...a[1].map((c) => ordemIdx.get(c) ?? 999));
      const minB = Math.min(...b[1].map((c) => ordemIdx.get(c) ?? 999));
      return minA - minB;
    });

    for (const [alvoId, candidatos] of atletasOrdenados) {
      const sorted = [...candidatos].sort((a, b) =>
        (ordemIdx.get(a) ?? 999) - (ordemIdx.get(b) ?? 999)
      );
      const winner = sorted[0];
      const losers = sorted.slice(1);
      const oferecidoId = oferecidoPorPar.get(`${winner}:${alvoId}`);
      if (oferecidoId == null) {
        // Defensivo: oferecido pareou errado, pula. Limpa pra todos.
        removeAtletaDeTodos(alvoId);
        continue;
      }

      // Aplica swap defensivamente — re-busca elenco.
      const elencoDest = await getElenco(winner);
      const oferecido = elencoDest?.jogadores[String(oferecidoId)];
      const alvoCache = cacheGlobal.get(alvoId);
      if (!elencoDest || !oferecido || !alvoCache) {
        // Algo sumiu (oferecido foi trocado por oferta, etc.). Marca
        // esse alvo como sem pick e remove dos picks pendentes.
        out.errosCount += 1;
        removeAtletaDeTodos(alvoId);
        continue;
      }

      const matchAlvo = partidasCache?.[String(alvoCache.clube_id)];
      const novoJogador: JogadorKV = {
        atleta_id: alvoId,
        apelido_api: alvoCache.apelido,
        clube: alvoCache.clube,
        clube_id: alvoCache.clube_id,
        posicao: alvoCache.posicao,
        posicao_id: alvoCache.posicao_id,
        escalacao: oferecido.escalacao,
        status_id: alvoCache.status_id,
        provavel: alvoCache.status_id === 7,
        lesionado: alvoCache.status_id === 5,
        suspenso: alvoCache.status_id === 3,
        nulo: alvoCache.status_id === 6,
        entrou_em_campo: null,
        clube_casa: matchAlvo?.casa ?? null,
        clube_fora: matchAlvo?.fora ?? null,
        pontos: null,
      };
      delete elencoDest.jogadores[String(oferecidoId)];
      elencoDest.jogadores[String(alvoId)] = novoJogador;
      await setElenco(winner, elencoDest);

      const ofertaIdSint = `draft-${Date.now()}-${alvoId}`;
      await registrarTroca({
        chaveA: winner,
        atletaA: {
          atleta_id: oferecido.atleta_id,
          apelido: oferecido.apelido_api,
          escalacaoOriginal: oferecido.escalacao,
        },
        chaveB: "mercado",
        atletaB: {
          atleta_id: alvoId,
          apelido: alvoCache.apelido,
          escalacaoOriginal: "Não",
        },
        ofertaId: ofertaIdSint,
      });

      if (rodadaAtual > 0) {
        await adjustTrocasMercadoCount(winner, rodadaAtual, +1);
      }
      restantes.set(winner, (restantes.get(winner) ?? 0) - 1);

      const nomeWinner = getNomeTimeDisplay(winner);
      const msg =
        `${nomeWinner} pegou ${alvoCache.apelido} do mercado em troca de ${oferecido.apelido_api}`;
      for (const c of TODAS_CHAVES) {
        await criarNotif({
          chave: c,
          tipo: "troca_mercado",
          ofertaId: ofertaIdSint,
          mensagem: msg,
        });
      }
      // Notif individual pros perdedores desse atleta nesse turno.
      for (const losChave of losers) {
        await criarNotif({
          chave: losChave,
          tipo: "troca_mercado",
          ofertaId: `${ofertaIdSint}-l-${losChave}`,
          mensagem:
            `Você perdeu o draft de ${alvoCache.apelido} pro ${nomeWinner}`,
        });
        out.perdedores.push({
          chave: losChave,
          atletaAlvoApelido: alvoCache.apelido,
          vencedorNomeTime: nomeWinner,
          turno: out.turnos,
        });
      }

      out.vencedores.push({
        chave: winner,
        nomeTime: nomeWinner,
        atletaAlvoId: alvoId,
        atletaAlvoApelido: alvoCache.apelido,
        atletaOferecidoId: oferecido.atleta_id,
        atletaOferecidoApelido: oferecido.apelido_api,
        turno: out.turnos,
      });

      winnersTurno.push(winner);
      // Limpa interesses no DB e prioridades locais
      db.prepare("DELETE FROM interesses WHERE atleta_alvo=?").run(alvoId);
      removeAtletaDeTodos(alvoId);
    }

    // 5. Vencedores vão pro fim da ordem (snake — sempre que user pega,
    //    cai pra última posição). Múltiplos vencedores mantêm ordem
    //    relativa entre si dentro do bloco "usaram".
    if (winnersTurno.length > 0) {
      const set = new Set(winnersTurno);
      const naoUsaram = ordemAtual.filter((c) => !set.has(c));
      const usaram = ordemAtual.filter((c) => set.has(c));
      ordemAtual = [...naoUsaram, ...usaram];
    }
  }

  // Persiste nova ordem do draft (cumulativo dos turnos).
  if (
    ordemAtual.length === ordemInicial.length &&
    !ordemAtual.every((c, i) => c === ordemInicial[i])
  ) {
    await setDraftOrdem(ordemAtual);
  }

  // Conta atletas que tinham interesse mas ninguém pegou (oferecido
  // sumiu, todos sem trocas, etc.).
  const aindaInteresses = await getTodosInteresses();
  out.semWinner = Object.keys(aindaInteresses).length;

  appStateSet("draft_last_resolution_at", Date.now());
  out.duracaoMs = Date.now() - t0;
  return out;
}
