import { Handlers } from "$fresh/server.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getAVenda,
  getAVendaGlobal,
  getFotos,
  getInteressadosBatch,
  getMinhaPrioridade,
} from "../../../lib/kv.ts";
import { fetchAtletasMercadoCacheado } from "../../../lib/cartola.ts";
import { fotoUrl } from "../../../lib/fotos.ts";
import { coresClube } from "../../../lib/cores.ts";
import { getNomeTimeDisplay } from "../../../lib/time-visual.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

const POSICAO: Record<
  number,
  "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante"
> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
};

/**
 * Endpoint que retorna a parte PESADA da página /mercado em JSON.
 * SSR de /mercado renderiza apenas o chrome + skeleton; a island
 * fetcha aqui no mount e popula os cards. UX percebida bem mais
 * rápida (shell em ~150ms, dados em mais ~200ms).
 */
export const handler: Handlers<unknown, State> = {
  async GET(_req, ctx) {
    const chaveLogadaAux = ctx.state.session?.chave;

    const [
      elencos,
      fotos,
      mercadoResp,
      aVenda,
      minhaPrioridade,
      minhaAVendaArr,
    ] = await Promise.all([
      getAllElencos(),
      getFotos(),
      fetchAtletasMercadoCacheado().catch(() => null),
      getAVendaGlobal(),
      chaveLogadaAux
        ? getMinhaPrioridade(chaveLogadaAux)
        : Promise.resolve([] as number[]),
      chaveLogadaAux
        ? getAVenda(chaveLogadaAux)
        : Promise.resolve([] as number[]),
    ]);
    const minhaAVenda = new Set(minhaAVendaArr);

    const dono: Record<number, string> = {};
    for (const [chave, elenco] of Object.entries(elencos)) {
      for (const id of Object.keys(elenco.jogadores)) {
        dono[Number(id)] = chave;
      }
    }

    const clubes: Record<string, string> = {};
    for (const [cid, c] of Object.entries(mercadoResp?.clubes ?? {})) {
      clubes[cid] = c.nome_fantasia ?? c.nome ?? cid;
    }

    const idsDisponiveis: number[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      if (!owner || naVenda) idsDisponiveis.push(a.atleta_id);
    }
    const interessadosMap = await getInteressadosBatch(idsDisponiveis);

    const jogadores: unknown[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      if (owner && !naVenda) continue;
      const pos = POSICAO[a.posicao_id];
      if (!pos) continue;
      const regs = interessadosMap[a.atleta_id] ?? [];
      const meuReg = chaveLogadaAux
        ? regs.find((r) => r.chave === chaveLogadaAux)
        : undefined;
      const clubeNome = clubes[String(a.clube_id)] ?? "";
      const fotoKV = fotos[String(a.atleta_id)];
      const fotoCutout = fotoKV &&
          (fotoKV.includes("/atletas/") || fotoKV.includes("thesportsdb"))
        ? fotoKV
        : fotoUrl(a.apelido);
      jogadores.push({
        atleta_id: a.atleta_id,
        nome: a.apelido,
        posicao: pos,
        clubeNome,
        clubeId: a.clube_id,
        statusId: a.status_id,
        foto: fotoCutout ?? null,
        cores: coresClube(clubeNome),
        pontosUltima: a.pontos_num ?? null,
        // deno-lint-ignore no-explicit-any
        mediaPontos: (a as any).media_num ?? null,
        donoChave: owner ?? null,
        donoTime: owner
          ? getNomeTimeDisplay(owner, CHAVES_TIMES[owner]?.nome_time)
          : null,
        interessados: regs.map((r) => r.chave),
        meuOferecido: meuReg?.oferecido ?? null,
      });
    }

    const chaveLogada = chaveLogadaAux;
    const meuElenco: unknown[] = [];
    if (chaveLogada && elencos[chaveLogada]) {
      const mercadoIdx = new Map(
        (mercadoResp?.atletas ?? []).map((a) => [a.atleta_id, a]),
      );
      for (const j of Object.values(elencos[chaveLogada].jogadores)) {
        const cartola = mercadoIdx.get(j.atleta_id);
        const pos = POSICAO[cartola?.posicao_id ?? -1];
        if (!pos) continue;
        const fotoKV = fotos[String(j.atleta_id)];
        const fotoCutout = fotoKV &&
            (fotoKV.includes("/atletas/") || fotoKV.includes("thesportsdb"))
          ? fotoKV
          : fotoUrl(j.apelido_api);
        meuElenco.push({
          atleta_id: j.atleta_id,
          nome: j.apelido_api,
          posicao: pos,
          clubeNome: j.clube,
          clubeId: j.clube_id,
          statusId: j.status_id,
          foto: fotoCutout ?? null,
          cores: coresClube(j.clube),
          pontosUltima: cartola?.pontos_num ?? null,
          // deno-lint-ignore no-explicit-any
          mediaPontos: (cartola as any)?.media_num ?? null,
          donoChave: chaveLogada,
          donoTime: getNomeTimeDisplay(
            chaveLogada,
            CHAVES_TIMES[chaveLogada]?.nome_time,
          ),
          interessados: [],
          aVenda: minhaAVenda.has(j.atleta_id),
        });
      }
    }

    const meusInteresses: unknown[] = [];
    if (chaveLogada) {
      const mercadoIdx = new Map(
        (mercadoResp?.atletas ?? []).map((a) => [a.atleta_id, a]),
      );
      const meuElencoIdx = new Map(
        (elencos[chaveLogada]?.jogadores
          ? Object.values(elencos[chaveLogada].jogadores)
          : []).map((j) => [j.atleta_id, j]),
      );
      for (const atletaId of minhaPrioridade) {
        const a = mercadoIdx.get(atletaId);
        if (!a) continue;
        const pos = POSICAO[a.posicao_id];
        if (!pos) continue;
        const regs = interessadosMap[atletaId] ?? [];
        const meuReg = regs.find((r) => r.chave === chaveLogada);
        if (!meuReg) continue;
        const oferecidoJog = meuElencoIdx.get(meuReg.oferecido);
        const clubeNomeAt = clubes[String(a.clube_id)] ?? "";
        const fotoKV = fotos[String(atletaId)];
        const fotoCutout = fotoKV &&
            (fotoKV.includes("/atletas/") || fotoKV.includes("thesportsdb"))
          ? fotoKV
          : fotoUrl(a.apelido);
        meusInteresses.push({
          atleta_id: atletaId,
          nome: a.apelido,
          posicao: pos,
          clubeNome: clubeNomeAt,
          foto: fotoCutout ?? null,
          cores: coresClube(clubeNomeAt),
          statusId: a.status_id,
          oferecidoId: meuReg.oferecido,
          oferecidoNome: oferecidoJog?.apelido_api ?? "—",
          totalInteressados: regs.length,
        });
      }
    }

    return new Response(
      JSON.stringify({ jogadores, meuElenco, meusInteresses, clubes }),
      { headers: H },
    );
  },
};
