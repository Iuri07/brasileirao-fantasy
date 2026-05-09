import { Handlers } from "$fresh/server.ts";
import { getElenco, setElenco, getAtletasCache, getPartidasCache, TODAS_CHAVES, POSICAO_CHAVES_CACHE } from "../../../../../lib/kv.ts";
import type { JogadorKV } from "../../../../../lib/types.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(JSON.stringify({ ok: false, erro: "Time não encontrado" }), { status: 404, headers: H });
    }

    let body: { atleta_id: number; escalacao?: "Sim" | "Banco" | "Não" };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), { status: 400, headers: H });
    }

    const kv = await Deno.openKv();
    const elenco = await getElenco(kv, chave);
    if (!elenco) {
      return new Response(JSON.stringify({ ok: false, erro: "Elenco não encontrado" }), { status: 404, headers: H });
    }

    // Busca atleta no cache por posição
    let atletaEncontrado = null;
    for (const posChave of POSICAO_CHAVES_CACHE) {
      const cache = await getAtletasCache(kv, posChave);
      if (cache?.atletas[String(body.atleta_id)]) {
        atletaEncontrado = cache.atletas[String(body.atleta_id)];
        break;
      }
    }

    if (!atletaEncontrado) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Atleta não encontrado no cache — rode sync-atletas primeiro" }),
        { status: 404, headers: H },
      );
    }

    const sid = atletaEncontrado.status_id ?? null;
    const partidasCache = await getPartidasCache(kv);
    const match = partidasCache?.[String(atletaEncontrado.clube_id)];
    const novoJogador: JogadorKV = {
      atleta_id:       body.atleta_id,
      apelido_api:     atletaEncontrado.apelido,
      clube:           atletaEncontrado.clube,
      clube_id:        atletaEncontrado.clube_id,
      posicao:         atletaEncontrado.posicao,
      posicao_id:      atletaEncontrado.posicao_id,
      escalacao:       body.escalacao ?? "Banco",
      status_id:       sid,
      provavel:        sid === 7,
      lesionado:       sid === 5,
      suspenso:        sid === 3,
      nulo:            sid === 6,
      entrou_em_campo: null,
      clube_casa:      match?.casa ?? null,
      clube_fora:      match?.fora ?? null,
      pontos:          null,
    };

    elenco.jogadores[String(body.atleta_id)] = novoJogador;
    await setElenco(kv, chave, elenco);

    return new Response(JSON.stringify({ ok: true, jogador: novoJogador }), { headers: H });
  },
};
