import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getAtletasCache,
  getElenco,
  getPartidasCache,
  POSICAO_CHAVES_CACHE,
  setElenco,
  TODAS_CHAVES,
} from "../../../../../lib/kv.ts";
import type { JogadorKV } from "../../../../../lib/types.ts";
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

      return new Response(
        JSON.stringify({
          ok: true,
          tipo: elencoOrigem ? "swap-inter-elenco" : "free-agent",
          elencoOrigem,
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
