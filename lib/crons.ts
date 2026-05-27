/// <reference lib="deno.unstable" />
import {
  fetchAtletasMercado,
  fetchAtletasMercadoCacheado,
  fetchAtletasPontuados,
  fetchMercadoStatus,
  fetchMercadoStatusCacheado,
  fetchPartidas,
  fetchPartidasCacheado,
  POSICAO_ID_NOME,
  POSICAO_NOME_CHAVE,
} from "./cartola.ts";
import {
  getAllElencos,
  getAtletasCache,
  POSICAO_CHAVES_CACHE,
  setAtletasCache,
  setElenco,
  setPartidasCache,
  setRodadaStatus,
} from "./kv.ts";
import { getDb } from "./db.ts";
import { setHistoricoRodada } from "./historico.ts";
import { calcularMelhorTime } from "./substituicao.ts";
import {
  appendEvento,
  type EventoHist,
  getEstadoScout,
  setEstadoScout,
} from "./eventos-hist.ts";
import { SCOUT } from "./scout.ts";
import { CUTOUTS_DISPONIVEIS } from "./cutouts-manifest.ts";
import type { AtletaCacheEntry, AtletaCacheKV } from "./types.ts";

async function sincronizarAtletas(): Promise<void> {
  const [data, partidasData] = await Promise.all([
    fetchAtletasMercado(),
    fetchPartidas().catch(() => null),
  ]);
  const now = new Date().toISOString();

  // Carrega cache atual pra preservar fotos REAIS (TheSportsDB etc)
  const cacheAtual = new Map<string, AtletaCacheEntry>();
  for (const pos of POSICAO_CHAVES_CACHE) {
    const c = await getAtletasCache(pos);
    if (!c) continue;
    for (const [id, e] of Object.entries(c.atletas)) cacheAtual.set(id, e);
  }

  const cutoutsLocais = CUTOUTS_DISPONIVEIS;

  // Cache de atletas por posição (para busca/troca)
  const grupos: Record<string, Record<string, AtletaCacheEntry>> = {};
  for (const c of POSICAO_CHAVES_CACHE) grupos[c] = {};

  const statusMap = new Map<number, number | null>();
  const clubeNomeMap = new Map<number, string>();

  for (const a of data.atletas) {
    const posNome = POSICAO_ID_NOME[a.posicao_id];
    if (!posNome) continue;
    const posChave = POSICAO_NOME_CHAVE[posNome];
    if (!posChave || !grupos[posChave]) continue;
    const clube = data.clubes[String(a.clube_id)];
    const clubeNome = clube?.nome_fantasia ?? clube?.nome ?? "";
    const idStr = String(a.atleta_id);
    const fotoExistente = cacheAtual.get(idStr)?.foto;
    const cartolaFoto = a.foto ? a.foto.replace("FORMATO", "220x220") : null;
    const foto = cutoutsLocais.has(idStr)
      ? `/atletas/${idStr}.png`
      : fotoExistente && !fotoExistente.includes("silh")
      ? fotoExistente
      : cartolaFoto;
    grupos[posChave][idStr] = {
      apelido: a.apelido,
      clube: clubeNome,
      clube_id: a.clube_id,
      posicao: posNome,
      posicao_id: a.posicao_id,
      status_id: a.status_id ?? null,
      foto,
    };
    statusMap.set(a.atleta_id, a.status_id ?? null);
    clubeNomeMap.set(a.atleta_id, clubeNome);
  }

  for (const [chave, atletas] of Object.entries(grupos)) {
    const cache: AtletaCacheKV = { atualizadoEm: now, atletas };
    await setAtletasCache(chave, cache);
  }

  // Mapa clube_id → { casa, fora } com abreviações
  const matchMap = new Map<number, { casa: string; fora: string }>();
  if (partidasData) {
    for (const p of partidasData.partidas) {
      const casaAbrev =
        partidasData.clubes[String(p.clube_casa_id)]?.abreviacao ??
          String(p.clube_casa_id);
      const foraAbrev =
        partidasData.clubes[String(p.clube_visitante_id)]?.abreviacao ??
          String(p.clube_visitante_id);
      matchMap.set(p.clube_casa_id, { casa: casaAbrev, fora: foraAbrev });
      matchMap.set(p.clube_visitante_id, { casa: casaAbrev, fora: foraAbrev });
    }
    const partidasRecord: Record<string, { casa: string; fora: string }> = {};
    for (const [id, m] of matchMap) partidasRecord[String(id)] = m;
    await setPartidasCache(partidasRecord);
  }

  // Atualiza status_id, clube e partida nos elencos
  const elencos = await getAllElencos();
  for (const [chave, elenco] of Object.entries(elencos)) {
    let alterado = false;
    for (const [id, jogador] of Object.entries(elenco.jogadores)) {
      const sid = statusMap.has(jogador.atleta_id)
        ? statusMap.get(jogador.atleta_id)!
        : jogador.status_id;
      const novoClube = clubeNomeMap.get(jogador.atleta_id) ?? jogador.clube;
      const match = matchMap.get(jogador.clube_id);
      const novoCasa = match ? match.casa : jogador.clube_casa;
      const novaFora = match ? match.fora : jogador.clube_fora;
      if (
        jogador.status_id === sid &&
        jogador.clube === novoClube &&
        jogador.clube_casa === novoCasa &&
        jogador.clube_fora === novaFora
      ) continue;
      elenco.jogadores[id] = {
        ...jogador,
        status_id: sid,
        provavel: sid === 7,
        lesionado: sid === 5,
        suspenso: sid === 3,
        nulo: sid === 6,
        clube: novoClube,
        clube_casa: novoCasa,
        clube_fora: novaFora,
      };
      alterado = true;
    }
    if (alterado) await setElenco(chave, elenco);
  }

  console.log(`[cron] atletas sincronizados: ${data.atletas.length}`);
}

export async function atualizarTudo(): Promise<void> {
  // Flag de simulação
  const { appStateGet } = await import("./app-state.ts");
  const sim = appStateGet<boolean>("simulando");
  if (sim === true) {
    console.log("[cron] simulação ativa — skip atualizarTudo");
    return;
  }
  const db = getDb();

  const now = new Date().toISOString();
  const mercado = await fetchMercadoStatus();

  const statusReal: "ao_vivo" | "aguardando_inicio" | "aguardando" =
    mercado.bola_rolando
      ? "ao_vivo"
      : mercado.status_mercado === 1
      ? "aguardando"
      : "aguardando_inicio";

  let pontuados;
  try {
    pontuados = await fetchAtletasPontuados();
  } catch {
    await setRodadaStatus({
      status: statusReal,
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
  }

  if (!pontuados?.atletas || Object.keys(pontuados.atletas).length === 0) {
    await setRodadaStatus({
      status: statusReal,
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
  }

  // Detecta eventos chave (diff de scout) pra histórico persistido
  const rodadaPontuados = pontuados.rodada_id ?? mercado.rodada_atual;
  const agoraMs = Date.now();
  for (const [idStr, p] of Object.entries(pontuados.atletas)) {
    const scoutNovo = p?.scout ?? {};
    if (Object.keys(scoutNovo).length === 0) continue;
    const atletaId = Number(idStr);
    const scoutAntigo = await getEstadoScout(rodadaPontuados, atletaId);
    let mudou = false;
    for (const [codigo, qtd] of Object.entries(scoutNovo)) {
      const antigo = scoutAntigo[codigo] ?? 0;
      if (qtd <= antigo) continue;
      const info = SCOUT[codigo];
      if (!info?.chave) continue;
      const evento: EventoHist = {
        ts: agoraMs,
        rodada: rodadaPontuados,
        atletaId,
        codigo,
        qtd: qtd - antigo,
      };
      await appendEvento(evento);
      mudou = true;
    }
    if (mudou) {
      await setEstadoScout(rodadaPontuados, atletaId, scoutNovo);
    }
  }

  // Atualiza pontos + entrou_em_campo nos elencos
  const elencos = await getAllElencos();
  for (const [chave, elenco] of Object.entries(elencos)) {
    let alterado = false;
    for (const [id, jogador] of Object.entries(elenco.jogadores)) {
      const p = pontuados.atletas[String(jogador.atleta_id)];
      if (!p) continue;
      const novoPontos = p.pontuacao ?? 0;
      const novoEntrou = p.entrou_em_campo ?? null;
      if (
        jogador.pontos === novoPontos && jogador.entrou_em_campo === novoEntrou
      ) continue;
      elenco.jogadores[id] = {
        ...jogador,
        pontos: novoPontos,
        entrou_em_campo: novoEntrou,
      };
      alterado = true;
    }
    if (alterado) await setElenco(chave, elenco);
  }

  // Salva snapshot da pontuação por elenco no histórico
  const rodadaId = pontuados.rodada_id ?? mercado.rodada_atual;
  if (rodadaId > 0 && !mercado.bola_rolando) {
    for (const [chave, elenco] of Object.entries(elencos)) {
      const escalados = calcularMelhorTime(Object.values(elenco.jogadores))
        .filter((j) => j.escalacao === "Sim");
      const pts = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      if (pts > 0) await setHistoricoRodada(chave, rodadaId, pts);
    }
  }

  await setRodadaStatus({
    status: statusReal,
    rodada: rodadaId,
    fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
    atualizadoEm: now,
  });

  // Pre-warm dos caches Cartola
  await Promise.all([
    fetchAtletasMercadoCacheado().catch(() => {}),
    fetchPartidasCacheado().catch(() => {}),
    fetchMercadoStatusCacheado().catch(() => {}),
  ]);

  // Pre-computa melhor_time pra cada elenco (coluna no próprio row)
  const elencosAtualizados = await getAllElencos();
  for (const [chave, elenco] of Object.entries(elencosAtualizados)) {
    const computed = calcularMelhorTime(Object.values(elenco.jogadores));
    db.prepare("UPDATE elencos SET melhor_time_json=? WHERE chave=?")
      .run(JSON.stringify(computed), chave);
  }

  console.log(`[cron] pontuação atualizada: rodada ${pontuados.rodada_id}`);
}

export function registrarCrons(): void {
  // Sync do catálogo de atletas: 1× por dia às 9h UTC (= 6h BRT)
  Deno.cron("sync-atletas", "0 9 * * *", async () => {
    try {
      await sincronizarAtletas();
    } catch (e) {
      console.error("[cron] sync-atletas erro:", e);
    }
  });

  // Status + pontuação ao vivo: 1min de cadência
  Deno.cron("atualizar", "* * * * *", async () => {
    try {
      await atualizarTudo();
    } catch (e) {
      console.error("[cron] atualizar erro:", e);
    }
  });

  // Resolução de draft: checa 1× por minuto se passou do horário
  // configurado e ainda não rodou nesse slot. Trigger lazy — bem mais
  // simples que cron por dia/hora dinâmica (admin pode mudar o
  // schedule a qualquer momento).
  Deno.cron("resolver-draft", "* * * * *", async () => {
    try {
      const { appStateGet } = await import("./app-state.ts");
      const { getDiasResolucao, getHoraResolucao, proximaResolucao } =
        await import("./draft.ts");
      const lastMs = appStateGet<number>("draft_last_resolution_at") ?? 0;
      const dias = await getDiasResolucao();
      const hora = await getHoraResolucao();
      // Próximo slot DEPOIS do último processado. Se já passou → roda.
      const proximo = proximaResolucao(dias, new Date(lastMs), hora);
      if (!proximo || Date.now() < proximo.getTime()) return;
      const { resolverDraft } = await import("./draft-resolver.ts");
      const res = await resolverDraft();
      console.log(
        `[cron] resolver-draft: ${res.vencedores.length} vencedor(es), ${res.perdedores.length} perdedor(es), ${res.errosCount} erro(s) em ${res.duracaoMs}ms`,
      );
    } catch (e) {
      console.error("[cron] resolver-draft erro:", e);
    }
  });
}
