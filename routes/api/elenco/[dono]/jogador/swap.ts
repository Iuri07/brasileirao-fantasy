import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getAtletasCache,
  getElenco,
  getPartidasCache,
  getRodadaStatus,
  POSICAO_CHAVES_CACHE,
  setElenco,
  TODAS_CHAVES,
} from "../../../../../lib/kv.ts";
import type { JogadorKV } from "../../../../../lib/types.ts";
import {
  getMaxTrocasMercado,
  getTrocasMercadoCount,
  incTrocasMercadoCount,
} from "../../../../../lib/trocas-mercado.ts";
import { registrarTroca } from "../../../../../lib/historico-trocas.ts";
import type { State } from "../../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Time não encontrado" }),
        { status: 404, headers: H },
      );
    }
    // Endpoint admin-only. Usuários normais trocam jogadores SÓ via
    // sistema de ofertas (que tem checks de mercado fechado, aceite
    // do destinatário, validação de elegibilidade). Swap direto na API
    // bypass todo isso — antes qualquer dono podia esvaziar elenco
    // alheio chamando esse endpoint na mão.
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }

    let body: {
      atleta_id_sai: number;
      atleta_id_entra: number;
      escalacao: "Sim" | "Banco" | "Não";
      /** Admin pode forçar o swap mesmo se o time já atingiu o limite
       *  de trocas com mercado da rodada. Default false. */
      bypass_limite_mercado?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }

    try {
      // Carrega todos os elencos para encontrar de onde vem o atleta que entra
      const elencos = await getAllElencos();
      const elencoAtual = elencos[chave];
      if (!elencoAtual) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Elenco não encontrado" }),
          { status: 404, headers: H },
        );
      }

      const idSai = String(body.atleta_id_sai);
      const idEntra = String(body.atleta_id_entra);

      if (!elencoAtual.jogadores[idSai]) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Jogador a sair não está no elenco",
          }),
          { status: 404, headers: H },
        );
      }
      if (elencoAtual.jogadores[idEntra]) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Jogador já está no seu elenco" }),
          { status: 400, headers: H },
        );
      }

      // Salva dados completos do jogador que sai antes de qualquer modificação
      const jogadorSai: JogadorKV = { ...elencoAtual.jogadores[idSai] };

      // Busca dados do atleta que entra no cache
      let atletaCache = null;
      for (const posChave of POSICAO_CHAVES_CACHE) {
        const cache = await getAtletasCache(posChave);
        if (cache?.atletas[idEntra]) {
          atletaCache = cache.atletas[idEntra];
          break;
        }
      }
      if (!atletaCache) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: "Atleta não encontrado no cache — rode sync-atletas primeiro",
          }),
          { status: 404, headers: H },
        );
      }

      // Encontra de qual elenco o atleta que entra vem (se vier de algum)
      let elencoOrigem: string | null = null;
      let escalacaoEntraOrigem: "Sim" | "Banco" | "Não" = "Banco";
      for (const [k, e] of Object.entries(elencos)) {
        if (k === chave) continue;
        if (e.jogadores[idEntra]) {
          elencoOrigem = k;
          escalacaoEntraOrigem = e.jogadores[idEntra].escalacao;
          break;
        }
      }

      // Limite de trocas com mercado por rodada. elencoOrigem === null
      // significa que o atleta veio do pool de free agents — conta como
      // troca com mercado. Trocas entre dois elencos (user-to-user) são
      // ilimitadas. Admin pode forçar via bypass_limite_mercado=true.
      const ehTrocaMercado = elencoOrigem === null;
      let trocasMercadoNovo: number | null = null;
      if (ehTrocaMercado && !body.bypass_limite_mercado) {
        const rodadaStatus = await getRodadaStatus();
        const rodadaAtual = rodadaStatus?.rodada ?? 0;
        if (rodadaAtual > 0) {
          const max = getMaxTrocasMercado();
          const atual = getTrocasMercadoCount(chave, rodadaAtual);
          if (atual >= max) {
            return new Response(
              JSON.stringify({
                ok: false,
                erro:
                  `Limite de ${max} trocas com mercado já atingido para ${chave} na rodada ${rodadaAtual}. ` +
                  `Use bypass_limite_mercado=true pra forçar.`,
              }),
              { status: 423, headers: H },
            );
          }
        }
      }

      // Monta JogadorKV para o atleta que entra
      const sid = atletaCache.status_id ?? null;
      const partidasCache = await getPartidasCache();
      const matchEntra = partidasCache?.[String(atletaCache.clube_id)];
      const jogadorEntra: JogadorKV = {
        atleta_id: body.atleta_id_entra,
        apelido_api: atletaCache.apelido,
        clube: atletaCache.clube,
        clube_id: atletaCache.clube_id,
        posicao: atletaCache.posicao,
        posicao_id: atletaCache.posicao_id,
        escalacao: body.escalacao,
        status_id: sid,
        provavel: sid === 7,
        lesionado: sid === 5,
        suspenso: sid === 3,
        nulo: sid === 6,
        entrou_em_campo: null,
        clube_casa: matchEntra?.casa ?? null,
        clube_fora: matchEntra?.fora ?? null,
        pontos: null,
      };

      // Aplica troca no elenco atual — re-busca do KV para garantir dados frescos
      const elencoDestino = await getElenco(chave);
      if (!elencoDestino) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Elenco destino sumiu" }),
          { status: 500, headers: H },
        );
      }
      delete elencoDestino.jogadores[idSai];
      elencoDestino.jogadores[idEntra] = jogadorEntra;
      await setElenco(chave, elencoDestino);

      // Se veio de outro elenco: re-busca do KV e manda jogadorSai para lá
      if (elencoOrigem) {
        const elencoFonte = await getElenco(elencoOrigem);
        if (elencoFonte) {
          delete elencoFonte.jogadores[idEntra];
          elencoFonte.jogadores[idSai] = {
            ...jogadorSai,
            escalacao: escalacaoEntraOrigem,
          };
          await setElenco(elencoOrigem, elencoFonte);
        }
      }

      // Incrementa contador de trocas com mercado (só se swap envolveu
      // o pool de free agents). Pega rodada de novo aqui — barato e
      // garante consistência se rodada virou entre o check e o apply.
      if (ehTrocaMercado) {
        const rodadaStatus = await getRodadaStatus();
        const rodadaAtual = rodadaStatus?.rodada ?? 0;
        if (rodadaAtual > 0) {
          trocasMercadoNovo = await incTrocasMercadoCount(chave, rodadaAtual);
        }
      }

      // Registra no histórico_trocas pra admin acompanhar todo movimento
      // de elenco (incluindo resolução de draft). chaveB = "mercado" como
      // sentinel quando o atleta veio do pool de free agents. Desfazer
      // só funciona pra troca entre dois elencos reais (mercado é one-way).
      await registrarTroca({
        chaveA: chave,
        atletaA: {
          atleta_id: jogadorSai.atleta_id,
          apelido: jogadorSai.apelido_api,
          escalacaoOriginal: jogadorSai.escalacao,
        },
        chaveB: elencoOrigem ?? "mercado",
        atletaB: {
          atleta_id: jogadorEntra.atleta_id,
          apelido: jogadorEntra.apelido_api,
          escalacaoOriginal: elencoOrigem ? escalacaoEntraOrigem : "Não",
        },
        ofertaId: `swap-${Date.now()}`, // sintetizado — não veio de oferta
      });

      return new Response(
        JSON.stringify({
          ok: true,
          tipo: elencoOrigem ? "swap-inter-elenco" : "free-agent",
          elencoOrigem,
          trocasMercadoNovo,
        }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
        status: 500,
        headers: H,
      });
    }
  },
};
