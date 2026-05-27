// Aplica resolução de conflitos do draft via SNAKE/ROUND-ROBIN.
//
// Algoritmo (rodada a rodada):
//   Pra cada chave NA ORDEM DO DRAFT (maior prioridade primeiro):
//     - Pula se não tem mais trocas com mercado restantes
//     - Pula se não tem mais prioridades ainda não picked
//     - Senão pega o atleta de maior prioridade dele que ainda não foi
//       pego, aplica swap, decrementa trocas, marca como picked
//   Repete enquanto alguém pegar algo na rodada.
//
// Consequências:
//   - User pode pegar VÁRIOS desde que tenha trocas restantes
//   - Conflitos resolvidos naturalmente: quem está mais alto no draft
//     pega antes; se 2 querem o mesmo de prioridade 1, o 1º pega e o
//     outro vai pra próxima prioridade na próxima volta do snake.
//   - Prioridade do USER decide qual atleta ele tenta — quem usou
//     muitas posições do draft "cai" naturalmente (próximas rodadas
//     ele tenta itens menos prioritários).

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
import { avancarRodadaDraft } from "./draft.ts";
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
  }>;
  perdedores: Array<{
    chave: string;
    atletaAlvoApelido: string;
    vencedorNomeTime: string;
  }>;
  /** Atletas com interesses mas SEM pick possível (sem trocas, ou
   *  todos os interessados acabaram pegando outras coisas primeiro). */
  semWinner: number;
  errosCount: number;
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
    duracaoMs: 0,
  };
  if (Object.keys(interessesMap).length === 0) {
    out.duracaoMs = Date.now() - t0;
    appStateSet("draft_last_resolution_at", Date.now());
    return out;
  }

  const [ordem, rodadaStatus] = await Promise.all([
    getDraftOrdem(),
    getRodadaStatus(),
  ]);
  const rodadaAtual = rodadaStatus?.rodada ?? 0;
  const max = getMaxTrocasMercado();

  // Saldo de trocas restantes por chave (snapshot — vai diminuindo
  // conforme processamos picks dentro dessa execução).
  const restantes = new Map<string, number>();
  for (const chave of TODAS_CHAVES) {
    const count = getTrocasMercadoCount(chave, rodadaAtual);
    restantes.set(chave, Math.max(0, max - count));
  }

  // Prioridades em ordem por chave + lookup (chave, atleta_alvo) →
  // atleta_oferecido. Filtra prioridades que correspondem a interesses
  // REAIS (user pode ter prioridade legacy sem interesse ativo).
  const prioridadesPorChave = new Map<string, number[]>();
  const oferecidoPorPar = new Map<string, number>(); // key = chave:atletaAlvo
  for (const [alvoIdStr, lista] of Object.entries(interessesMap)) {
    const alvoId = Number(alvoIdStr);
    for (const i of lista) {
      oferecidoPorPar.set(`${i.chave}:${alvoId}`, i.oferecido);
    }
  }
  for (const chave of TODAS_CHAVES) {
    const prio = await getMinhaPrioridade(chave);
    const filtrada = prio.filter((id) =>
      oferecidoPorPar.has(`${chave}:${id}`)
    );
    if (filtrada.length > 0) prioridadesPorChave.set(chave, filtrada);
  }

  // Preload caches que vamos usar várias vezes.
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

  // Snake draft loop.
  const pickedSet = new Set<number>(); // atleta_alvos já pegos nessa execução
  const tentativasFalhas = new Map<string, Set<number>>(); // chave → atletas já tentados sem sucesso
  const pickers: string[] = []; // pra shift no draft (1 entrada por user que pegou pelo menos 1)
  // Quem perdeu o quê — pra notif individual. Map: atletaAlvo → array de chaves perdedoras
  const perdedoresPorAtleta = new Map<number, string[]>();

  // Coleta inicial de "perdedores em potencial": todo mundo que marcou
  // interesse num atleta. No fim da resolução, quem marcou MAS não pegou
  // (porque outro pegou) é perdedor desse atleta específico.
  const interessadosPorAtleta = new Map<number, string[]>();
  for (const [alvoIdStr, lista] of Object.entries(interessesMap)) {
    interessadosPorAtleta.set(Number(alvoIdStr), lista.map((i) => i.chave));
  }

  let safety = 0;
  while (safety++ < 100) {
    let picksNaRodada = 0;
    for (const chave of ordem) {
      const rest = restantes.get(chave) ?? 0;
      if (rest <= 0) continue;
      const prio = prioridadesPorChave.get(chave);
      if (!prio || prio.length === 0) continue;
      // Procura próximo atleta da prioridade que ainda não foi pego e
      // não falhou em tentativa anterior (oferecido sumiu etc.).
      const falhas = tentativasFalhas.get(chave) ?? new Set<number>();
      let alvoId: number | null = null;
      for (const id of prio) {
        if (pickedSet.has(id)) continue;
        if (falhas.has(id)) continue;
        alvoId = id;
        break;
      }
      if (alvoId === null) continue;

      const oferecidoId = oferecidoPorPar.get(`${chave}:${alvoId}`);
      if (oferecidoId == null) {
        falhas.add(alvoId);
        tentativasFalhas.set(chave, falhas);
        continue;
      }

      // Aplica swap defensivamente — re-busca elenco do KV.
      const elencoDest = await getElenco(chave);
      if (!elencoDest) {
        out.errosCount += 1;
        falhas.add(alvoId);
        tentativasFalhas.set(chave, falhas);
        continue;
      }
      const oferecido = elencoDest.jogadores[String(oferecidoId)];
      if (!oferecido) {
        // Oferecido sumiu (foi trocado por oferta entre interest e
        // resolução). Marca como falha — vai pro próximo da fila.
        falhas.add(alvoId);
        tentativasFalhas.set(chave, falhas);
        continue;
      }
      const alvoCache = cacheGlobal.get(alvoId);
      if (!alvoCache) {
        out.errosCount += 1;
        falhas.add(alvoId);
        tentativasFalhas.set(chave, falhas);
        continue;
      }

      // Monta JogadorKV pro entrante.
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
      await setElenco(chave, elencoDest);

      // Registra na história
      const ofertaIdSint = `draft-${Date.now()}-${alvoId}`;
      await registrarTroca({
        chaveA: chave,
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

      // Conta como troca com mercado + atualiza saldo local pra
      // próximas iterações do loop.
      if (rodadaAtual > 0) {
        await adjustTrocasMercadoCount(chave, rodadaAtual, +1);
      }
      restantes.set(chave, rest - 1);

      // Broadcast pra todos
      const nomeWinner = getNomeTimeDisplay(chave);
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

      // Marca perdedores desse alvo (todos os interessados exceto o
      // vencedor) — pra notif individual depois.
      const todosInteressados = interessadosPorAtleta.get(alvoId) ?? [];
      for (const losChave of todosInteressados) {
        if (losChave === chave) continue;
        const arr = perdedoresPorAtleta.get(alvoId) ?? [];
        if (!arr.includes(losChave)) arr.push(losChave);
        perdedoresPorAtleta.set(alvoId, arr);
        out.perdedores.push({
          chave: losChave,
          atletaAlvoApelido: alvoCache.apelido,
          vencedorNomeTime: nomeWinner,
        });
      }

      out.vencedores.push({
        chave,
        nomeTime: nomeWinner,
        atletaAlvoId: alvoId,
        atletaAlvoApelido: alvoCache.apelido,
        atletaOferecidoId: oferecido.atleta_id,
        atletaOferecidoApelido: oferecido.apelido_api,
      });

      pickedSet.add(alvoId);
      if (!pickers.includes(chave)) pickers.push(chave);
      // Limpa todos os interesses nesse alvo
      db.prepare("DELETE FROM interesses WHERE atleta_alvo=?").run(alvoId);

      picksNaRodada += 1;
    }
    if (picksNaRodada === 0) break;
  }

  // Notifica perdedores (uma notif por par chave/atletaAlvo).
  for (const [alvoId, losers] of perdedoresPorAtleta.entries()) {
    const alvo = cacheGlobal.get(alvoId);
    if (!alvo) continue;
    // Acha o vencedor pra mensagem.
    const venc = out.vencedores.find((v) => v.atletaAlvoId === alvoId);
    if (!venc) continue;
    for (const losChave of losers) {
      await criarNotif({
        chave: losChave,
        tipo: "troca_mercado",
        ofertaId: `draft-loser-${alvoId}-${Date.now()}`,
        mensagem:
          `Você perdeu o draft de ${alvo.apelido} pro ${venc.nomeTime}`,
      });
    }
  }

  // Conta atletas que tinham interesse mas nenhum interessado conseguiu
  // pegar (sem trocas, oferecido sumiu, etc.).
  for (const alvoIdStr of Object.keys(interessesMap)) {
    if (!pickedSet.has(Number(alvoIdStr))) out.semWinner += 1;
  }

  // Shift na ordem do draft — 1 entrada por user que pegou pelo menos
  // 1 (mesmo que tenha pegado vários, vai 1× pro fim).
  if (pickers.length > 0 && rodadaAtual > 0) {
    await avancarRodadaDraft(pickers, rodadaAtual);
  }

  appStateSet("draft_last_resolution_at", Date.now());
  out.duracaoMs = Date.now() - t0;
  return out;
}
