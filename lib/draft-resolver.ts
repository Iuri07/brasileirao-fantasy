// Aplica resolução de conflitos do draft: pra cada atleta com 1+
// interessados, vencedor leva (pela ordem do draft); perdedores são
// notificados; atleta oferecido vai pro mercado; histórico, contador
// e ordem do draft são atualizados.

import { getDb } from "./db.ts";
import {
  getAllElencos,
  getAtletasCache,
  getDraftOrdem,
  getElenco,
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
import { adjustTrocasMercadoCount } from "./trocas-mercado.ts";
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
  atletasSemInteressado: number; // ficaria=0 sempre — drift defensivo
  errosCount: number;
  duracaoMs: number;
}

/**
 * Executa a resolução de TODOS os interesses pendentes. Idempotente
 * naquilo: após rodar, a tabela interesses fica vazia. Pode ser
 * chamada várias vezes sem efeito se não tem nada pendente.
 *
 * @returns Resumo do que foi feito. Usado por endpoint admin (manual)
 *          e cron (auto).
 */
export async function resolverDraft(): Promise<ResolucaoResultado> {
  const t0 = Date.now();
  const interessesMap = await getTodosInteresses();
  const out: ResolucaoResultado = {
    vencedores: [],
    perdedores: [],
    atletasSemInteressado: 0,
    errosCount: 0,
    duracaoMs: 0,
  };
  if (Object.keys(interessesMap).length === 0) {
    out.duracaoMs = Date.now() - t0;
    // Mesmo sem trabalho, marca timestamp pra fixar o "slot processado"
    // e evitar re-run no próximo minuto.
    appStateSet("draft_last_resolution_at", Date.now());
    return out;
  }

  const [elencos, ordem, rodadaStatus] = await Promise.all([
    getAllElencos(),
    getDraftOrdem(),
    getRodadaStatus(),
  ]);
  const ordemIndex = new Map<string, number>();
  ordem.forEach((c, i) => ordemIndex.set(c, i));
  const rodadaAtual = rodadaStatus?.rodada ?? 0;

  // Carrega cache de atletas de todas as posições (pra resolver o
  // atleta alvo que vem do mercado).
  const cacheGlobal = new Map<number, {
    apelido: string;
    clube: string;
    clube_id: number;
    posicao: string;
    posicao_id: number;
    status_id: number | null;
  }>();
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
  const pickers: string[] = [];

  for (const [alvoIdStr, lista] of Object.entries(interessesMap)) {
    const alvoId = Number(alvoIdStr);
    if (lista.length === 0) continue;

    // Ordena interessados pela posição do draft (menor índice = maior
    // prioridade). Quem não está na ordem vai pro fim (defensivo).
    const ordered = [...lista].sort((a, b) =>
      (ordemIndex.get(a.chave) ?? 999) - (ordemIndex.get(b.chave) ?? 999)
    );
    const winner = ordered[0];
    const losers = ordered.slice(1);

    const elencoWinner = elencos[winner.chave];
    if (!elencoWinner) {
      console.error(`[resolver-draft] elenco do vencedor sumiu: ${winner.chave}`);
      out.errosCount += 1;
      continue;
    }
    const oferecido = elencoWinner.jogadores[String(winner.oferecido)];
    if (!oferecido) {
      console.error(
        `[resolver-draft] atleta oferecido ${winner.oferecido} não está no elenco de ${winner.chave}`,
      );
      out.errosCount += 1;
      continue;
    }
    const alvoCache = cacheGlobal.get(alvoId);
    if (!alvoCache) {
      console.error(`[resolver-draft] atleta alvo ${alvoId} sumiu do cache`);
      out.errosCount += 1;
      continue;
    }

    // Monta JogadorKV pro atleta alvo entrar no elenco do vencedor.
    const matchAlvo = partidasCache?.[String(alvoCache.clube_id)];
    const novoJogador: JogadorKV = {
      atleta_id: alvoId,
      apelido_api: alvoCache.apelido,
      clube: alvoCache.clube,
      clube_id: alvoCache.clube_id,
      posicao: alvoCache.posicao,
      posicao_id: alvoCache.posicao_id,
      escalacao: oferecido.escalacao, // herda a função do que saiu
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

    // Aplica swap no elenco do vencedor — re-busca pra estado fresco.
    const elencoDest = await getElenco(winner.chave);
    if (!elencoDest) {
      out.errosCount += 1;
      continue;
    }
    delete elencoDest.jogadores[String(winner.oferecido)];
    elencoDest.jogadores[String(alvoId)] = novoJogador;
    await setElenco(winner.chave, elencoDest);
    // Atualiza estado local (próximas iterações leem o snapshot
    // antigo, mas usaremos só pra notif/registros).
    elencos[winner.chave] = elencoDest;

    // Registra no histórico
    const ofertaIdSint = `draft-${Date.now()}-${alvoId}`;
    await registrarTroca({
      chaveA: winner.chave,
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

    // Conta como troca com mercado pro vencedor (mesma semântica do
    // swap manual). Pode usar saldo negativo se o vencedor já tava
    // estouro acima de N.
    if (rodadaAtual > 0) {
      await adjustTrocasMercadoCount(winner.chave, rodadaAtual, +1);
    }

    // Broadcast pra todos os times — mesmo formato do swap manual.
    const nomeWinner = getNomeTimeDisplay(winner.chave);
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

    // Notifica perdedores individualmente.
    for (const loser of losers) {
      await criarNotif({
        chave: loser.chave,
        tipo: "troca_mercado",
        ofertaId: ofertaIdSint,
        mensagem:
          `Você perdeu o draft de ${alvoCache.apelido} pro ${nomeWinner}`,
      });
      out.perdedores.push({
        chave: loser.chave,
        atletaAlvoApelido: alvoCache.apelido,
        vencedorNomeTime: nomeWinner,
      });
    }

    out.vencedores.push({
      chave: winner.chave,
      nomeTime: nomeWinner,
      atletaAlvoId: alvoId,
      atletaAlvoApelido: alvoCache.apelido,
      atletaOferecidoId: oferecido.atleta_id,
      atletaOferecidoApelido: oferecido.apelido_api,
    });

    if (!pickers.includes(winner.chave)) pickers.push(winner.chave);

    // Limpa TODOS os interesses nesse alvo (vencedor + perdedores).
    db.prepare("DELETE FROM interesses WHERE atleta_alvo=?").run(alvoId);
  }

  // Shift na ordem do draft — quem usou pick vai pro fim.
  if (pickers.length > 0 && rodadaAtual > 0) {
    await avancarRodadaDraft(pickers, rodadaAtual);
  }

  // Marca timestamp da última resolução (usado pelo cron pra evitar
  // re-run no mesmo slot).
  appStateSet("draft_last_resolution_at", Date.now());

  out.duracaoMs = Date.now() - t0;
  return out;
}
