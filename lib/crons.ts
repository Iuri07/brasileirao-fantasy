import {
  fetchMercadoStatus,
  fetchAtletasMercado,
  fetchAtletasPontuados,
  POSICAO_ID_NOME,
  POSICAO_NOME_CHAVE,
} from "./cartola.ts";
import {
  getAllElencos,
  setElenco,
  setRodadaStatus,
  POSICAO_CHAVES_CACHE,
} from "./kv.ts";
import type { AtletaCacheKV } from "./types.ts";

async function sincronizarAtletas(kv: Deno.Kv): Promise<void> {
  const data = await fetchAtletasMercado();
  const now = new Date().toISOString();

  const grupos: Record<string, Record<string, { apelido: string; clube: string; clube_id: number; posicao: string; posicao_id: number }>> = {};
  for (const c of POSICAO_CHAVES_CACHE) grupos[c] = {};

  for (const a of data.atletas) {
    const posNome = POSICAO_ID_NOME[a.posicao_id];
    if (!posNome) continue;
    const posChave = POSICAO_NOME_CHAVE[posNome];
    if (!posChave || !grupos[posChave]) continue;
    const clube = data.clubes[String(a.clube_id)];
    grupos[posChave][String(a.atleta_id)] = {
      apelido: a.apelido,
      clube: clube?.nome ?? "",
      clube_id: a.clube_id,
      posicao: posNome,
      posicao_id: a.posicao_id,
    };
  }

  for (const [chave, atletas] of Object.entries(grupos)) {
    const cache: AtletaCacheKV = { atualizadoEm: now, atletas };
    await kv.set(["atletas_cache", chave], cache);
  }

  console.log(`[cron] atletas sincronizados: ${data.atletas.length}`);
}

async function atualizarTudo(kv: Deno.Kv): Promise<void> {
  const now = new Date().toISOString();

  // Busca status do mercado e todos os atletas em paralelo
  const [mercado, apiData] = await Promise.all([
    fetchMercadoStatus(),
    fetchAtletasMercado(),
  ]);

  // Mapa atleta_id → status + entrou_em_campo
  const statusMap = new Map(
    apiData.atletas.map((a) => [
      a.atleta_id,
      { status_id: a.status_id ?? null, entrou_em_campo: a.entrou_em_campo },
    ]),
  );

  // Atualiza campos de status nos elencos (sempre, independente do mercado)
  const elencos = await getAllElencos(kv);
  for (const [chave, elenco] of Object.entries(elencos)) {
    let alterado = false;
    for (const [id, jogador] of Object.entries(elenco.jogadores)) {
      const api = statusMap.get(jogador.atleta_id);
      if (!api) continue;
      if (jogador.status_id === api.status_id && jogador.entrou_em_campo === api.entrou_em_campo) continue;
      elenco.jogadores[id] = {
        ...jogador,
        status_id:       api.status_id,
        provavel:        api.status_id === 5,
        lesionado:       api.status_id === 2,
        suspenso:        api.status_id === 3,
        nulo:            api.status_id === 6,
        entrou_em_campo: api.entrou_em_campo,
      };
      alterado = true;
    }
    if (alterado) await setElenco(kv, chave, elenco);
  }

  // Mercado aberto: aguardando próxima rodada
  if (mercado.status_mercado === 2) {
    await setRodadaStatus(kv, {
      status: "aguardando",
      rodada: mercado.rodada_atual,
      fechamento: mercado.fechamento,
    });
    return;
  }

  // Mercado fechado: busca pontuados
  let pontuados;
  try {
    pontuados = await fetchAtletasPontuados();
  } catch {
    await setRodadaStatus(kv, {
      status: "aguardando_inicio",
      rodada: mercado.rodada_atual,
      atualizadoEm: now,
    });
    return;
  }

  if (!pontuados?.atletas || Object.keys(pontuados.atletas).length === 0) {
    await setRodadaStatus(kv, {
      status: "aguardando_inicio",
      rodada: mercado.rodada_atual,
      atualizadoEm: now,
    });
    return;
  }

  // Atualiza pontos nos elencos
  const elencos2 = await getAllElencos(kv);
  for (const [chave, elenco] of Object.entries(elencos2)) {
    let alterado = false;
    for (const [id, jogador] of Object.entries(elenco.jogadores)) {
      const p = pontuados.atletas[String(jogador.atleta_id)];
      if (!p) continue;
      elenco.jogadores[id] = { ...jogador, pontos: p.pontuacao, entrou_em_campo: p.entrou_em_campo };
      alterado = true;
    }
    if (alterado) await setElenco(kv, chave, elenco);
  }

  await setRodadaStatus(kv, {
    status: "ao_vivo",
    rodada: pontuados.rodada_id ?? mercado.rodada_atual,
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

  // Status + pontuação ao vivo: a cada 2 minutos
  Deno.cron("atualizar", "*/2 * * * *", async () => {
    try {
      const kv = await Deno.openKv();
      await atualizarTudo(kv);
    } catch (e) {
      console.error("[cron] atualizar erro:", e);
    }
  });
}
