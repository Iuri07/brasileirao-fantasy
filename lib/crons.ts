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
  getRodadaStatus,
  POSICAO_CHAVES_CACHE,
  setElenco,
  setPartidasCache,
  setRodadaStatus,
} from "./kv.ts";
import { fetchPlayerPhoto, sleep } from "./sportsdb.ts";
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

async function sincronizarAtletas(kv: Deno.Kv): Promise<void> {
  const [data, partidasData] = await Promise.all([
    fetchAtletasMercado(),
    fetchPartidas().catch(() => null),
  ]);
  const now = new Date().toISOString();

  // Carrega cache atual pra preservar fotos REAIS já encontradas
  // (TheSportsDB) e não sobrescrever com silhueta da Cartola
  const cacheAtual = new Map<string, AtletaCacheEntry>();
  for (const pos of POSICAO_CHAVES_CACHE) {
    const c = await getAtletasCache(kv, pos);
    if (!c) continue;
    for (const [id, e] of Object.entries(c.atletas)) cacheAtual.set(id, e);
  }

  // Cutouts locais bundled (static/atletas/{id}.png) — geração é local +
  // commit (rembg não roda em Deno Deploy). Manifesto estático em
  // lib/cutouts-manifest.ts (Deno Deploy não suporta Deno.readDir em static/).
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
    // Prioridade:
    // 1. Cutout local (gerado via ogol+rembg e commitado em static/atletas/)
    // 2. Foto real preservada do cache (TheSportsDB ou /atletas/)
    // 3. Foto da Cartola (silhueta — "FORMATO" é placeholder de tamanho)
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
    await kv.set(["atletas_cache", chave], cache);
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
    // Persiste o matchMap no KV para uso por add/swap sem nova chamada à API
    const partidasRecord: Record<string, { casa: string; fora: string }> = {};
    for (const [id, m] of matchMap) partidasRecord[String(id)] = m;
    await setPartidasCache(kv, partidasRecord);
  }

  // Atualiza status_id, clube e partida nos elencos
  const elencos = await getAllElencos(kv);
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
    if (alterado) await setElenco(kv, chave, elenco);
  }

  console.log(`[cron] atletas sincronizados: ${data.atletas.length}`);
}

export async function atualizarTudo(kv: Deno.Kv): Promise<void> {
  // Flag de simulação: admin botou a app em modo "rodada simulada"
  // (testar UI ao vivo sem mexer no Cartola). Pula o cron até desativar.
  const simulando = await kv.get<boolean>(["simulando"]);
  if (simulando.value) {
    console.log("[cron] simulação ativa — skip atualizarTudo");
    return;
  }

  const now = new Date().toISOString();

  // Sempre busca status do mercado e tenta pontuados
  const mercado = await fetchMercadoStatus();

  // Status derivado SOMENTE do mercado real (não do KV anterior).
  // status_mercado: 1=aberto, 2=fechado (rodada). bola_rolando=true→ao_vivo
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
    await setRodadaStatus(kv, {
      status: statusReal,
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
  }

  if (!pontuados?.atletas || Object.keys(pontuados.atletas).length === 0) {
    await setRodadaStatus(kv, {
      status: statusReal,
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
  }

  // === Detecta eventos chave (diff de scout) pra histórico persistido ===
  // Pra cada atleta com scout novo, compara com último estado salvo;
  // pra cada código incrementado, registra um EventoHist. Histórico
  // sobrevive reload (vs timeline client que era só da sessão).
  const rodadaPontuados = pontuados.rodada_id ?? mercado.rodada_atual;
  const agoraMs = Date.now();
  for (const [idStr, p] of Object.entries(pontuados.atletas)) {
    const scoutNovo = p?.scout ?? {};
    if (Object.keys(scoutNovo).length === 0) continue;
    const atletaId = Number(idStr);
    const scoutAntigo = await getEstadoScout(kv, rodadaPontuados, atletaId);
    let mudou = false;
    for (const [codigo, qtd] of Object.entries(scoutNovo)) {
      const antigo = scoutAntigo[codigo] ?? 0;
      if (qtd <= antigo) continue;
      // Filtra só códigos "chave" (gol, cartão, defesa, etc.) — scouts
      // ruidosos (passe errado, falta cometida etc) ficam fora.
      const info = SCOUT[codigo];
      if (!info?.chave) continue;
      const evento: EventoHist = {
        ts: agoraMs,
        rodada: rodadaPontuados,
        atletaId,
        codigo,
        qtd: qtd - antigo,
      };
      await appendEvento(kv, evento);
      mudou = true;
    }
    if (mudou) {
      await setEstadoScout(kv, rodadaPontuados, atletaId, scoutNovo);
    }
  }

  // Atualiza pontos + entrou_em_campo nos elencos
  const elencos = await getAllElencos(kv);
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
    if (alterado) await setElenco(kv, chave, elenco);
  }

  // Salva snapshot da pontuação por elenco no histórico (idempotente —
  // sobrescreve mesma rodada). Só registra quando há pontos > 0 e a
  // bola não tá rolando (ou seja, rodada já encerrou) pra evitar
  // gravar parciais que mudam ao longo do dia.
  const rodadaId = pontuados.rodada_id ?? mercado.rodada_atual;
  if (rodadaId > 0 && !mercado.bola_rolando) {
    for (const [chave, elenco] of Object.entries(elencos)) {
      const escalados = calcularMelhorTime(Object.values(elenco.jogadores))
        .filter((j) => j.escalacao === "Sim");
      const pts = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      if (pts > 0) await setHistoricoRodada(kv, chave, rodadaId, pts);
    }
  }

  await setRodadaStatus(kv, {
    status: statusReal,
    rodada: rodadaId,
    fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
    atualizadoEm: now,
  });

  // Pre-warm dos caches Cartola em KV pra que page loads não paguem
  // cold start. Roda em paralelo, todos com TTL >5min de margem.
  await Promise.all([
    fetchAtletasMercadoCacheado(kv).catch(() => {}),
    fetchPartidasCacheado(kv).catch(() => {}),
    fetchMercadoStatusCacheado(kv).catch(() => {}),
  ]);

  // Pre-computa melhor_time pra cada elenco (cache em KV). Como o
  // setElenco que rolou acima invalidou todos os caches, aqui repopula.
  const elencosAtualizados = await getAllElencos(kv);
  await Promise.all(
    Object.entries(elencosAtualizados).map(([chave, elenco]) => {
      const computed = calcularMelhorTime(Object.values(elenco.jogadores));
      return kv.set(["melhor_time", chave], computed);
    }),
  );

  console.log(`[cron] pontuação atualizada: rodada ${pontuados.rodada_id}`);
}

export function registrarCrons(): void {
  // Sync do catálogo de atletas: 1× por dia às 9h UTC (= 6h BRT)
  Deno.cron("sync-atletas", "0 9 * * *", async () => {
    try {
      const kv = await Deno.openKv();
      await sincronizarAtletas(kv);
    } catch (e) {
      console.error("[cron] sync-atletas erro:", e);
    }
  });

  // Status + pontuação ao vivo: a cada 5 minutos
  // 1min de cadência — granularidade fina pros timestamps da timeline
  // (Cartola só dá scout acumulado, sem timestamp por lance). 5min era
  // demais: todos os gols/cartões num período de 5min ficavam com o
  // mesmo horário.
  Deno.cron("atualizar", "* * * * *", async () => {
    try {
      const kv = await Deno.openKv();
      await atualizarTudo(kv);
    } catch (e) {
      console.error("[cron] atualizar erro:", e);
    }
  });
}
