import {
  fetchAtletasMercado,
  fetchAtletasPontuados,
  fetchMercadoStatus,
  fetchPartidas,
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
    // Mantém foto real (TheSportsDB) se já tem; senão usa o que vier
    // da Cartola (silhueta). "FORMATO" é placeholder de tamanho.
    const cartolaFoto = a.foto ? a.foto.replace("FORMATO", "220x220") : null;
    const foto = fotoExistente && !fotoExistente.includes("silh")
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
  const now = new Date().toISOString();

  // Sempre busca status do mercado e tenta pontuados
  const mercado = await fetchMercadoStatus();
  const statusAtual = await getRodadaStatus(kv);
  const jaAoVivo = statusAtual?.status === "ao_vivo";

  let pontuados;
  try {
    pontuados = await fetchAtletasPontuados();
  } catch {
    // Pontuados indisponível: entre jogos ou pré-rodada
    if (jaAoVivo) return; // mantém ao_vivo entre jogos da mesma rodada
    await setRodadaStatus(kv, {
      status: mercado.bola_rolando ? "aguardando_inicio" : "aguardando",
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
  }

  if (!pontuados?.atletas || Object.keys(pontuados.atletas).length === 0) {
    if (jaAoVivo) return; // mantém ao_vivo entre jogos
    await setRodadaStatus(kv, {
      status: mercado.bola_rolando ? "aguardando_inicio" : "aguardando",
      rodada: mercado.rodada_atual,
      fechamento: mercado.bola_rolando ? undefined : mercado.fechamento,
      atualizadoEm: now,
    });
    return;
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
    status: "ao_vivo",
    rodada: rodadaId,
    atualizadoEm: now,
  });

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
  Deno.cron("atualizar", "*/5 * * * *", async () => {
    try {
      const kv = await Deno.openKv();
      await atualizarTudo(kv);
    } catch (e) {
      console.error("[cron] atualizar erro:", e);
    }
  });
}
