import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAllElencos,
  getAVenda,
  getAVendaGlobal,
  getDraftOrdem,
  getFotos,
  getInteressadosBatch,
} from "../lib/kv.ts";
import { fetchAtletasMercado } from "../lib/cartola.ts";
import { fotoUrl } from "../lib/fotos.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import MercadoBrowser, {
  type AtletaMercado,
  type AtletaMeuTime,
} from "../islands/MercadoBrowser.tsx";
import type { State } from "./_middleware.ts";

const POSICAO: Record<number, AtletaMercado["posicao"]> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
};

interface Data {
  jogadores: AtletaMercado[];
  clubes: Record<string, string>; // clube_id → nome
  /** Chave do meu time (pra saber se já estou interessado) */
  minhaChave: string | null;
  /** Os 26 do meu elenco — pra aba "Meu time" */
  meuElenco: AtletaMeuTime[];
  /** Quantos jogadores do meu time estão à venda */
  qtdAVenda: number;
  /** Posição do meu time no draft (1-based) — null se não logado */
  posicaoDraft: number | null;
  /** Ordem completa do draft pra exibir contexto (tooltip/listagem) */
  draftOrdem: { chave: string; nome: string }[];
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, fotos, mercadoResp, aVenda, draftOrdemKeys] = await Promise
      .all([
        getAllElencos(kv),
        getFotos(kv),
        fetchAtletasMercado().catch(() => null),
        getAVendaGlobal(kv),
        getDraftOrdem(kv),
      ]);

    // Dono de cada atleta (chave). Atletas sem dono → "free agent".
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

    // Cartola serve fotos com "FORMATO" literal — substitui por tamanho válido
    const fixCartolaFoto = (url: string | undefined): string | null => {
      if (!url) return null;
      return url.replace("FORMATO", "220x220");
    };

    const idsDisponiveis: number[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      if (!owner || naVenda) idsDisponiveis.push(a.atleta_id);
    }
    const interessadosMap = await getInteressadosBatch(kv, idsDisponiveis);

    const chaveLogadaAux = ctx.state.session?.chave;

    const jogadores: AtletaMercado[] = [];
    for (const a of mercadoResp?.atletas ?? []) {
      const owner = dono[a.atleta_id];
      const naVenda = owner && aVenda[a.atleta_id] === owner;
      // Disponíveis: free agents (sem dono) OU explicitamente à venda
      if (owner && !naVenda) continue;
      const pos = POSICAO[a.posicao_id];
      if (!pos) continue;
      const regs = interessadosMap[a.atleta_id] ?? [];
      const meuReg = chaveLogadaAux
        ? regs.find((r) => r.chave === chaveLogadaAux)
        : undefined;
      jogadores.push({
        atleta_id: a.atleta_id,
        nome: a.apelido,
        posicao: pos,
        clubeNome: clubes[String(a.clube_id)] ?? "",
        clubeId: a.clube_id,
        statusId: a.status_id,
        // Prioridade: cutout salvo (KV) > local jpg (/players/) > Cartola CDN
        // (silhuetas do clube, mas pelo menos algo) > null
        foto: fotos[String(a.atleta_id)] ?? fotoUrl(a.apelido) ??
          fixCartolaFoto(a.foto) ?? null,
        pontosUltima: a.pontos_num ?? null,
        // deno-lint-ignore no-explicit-any
        mediaPontos: (a as any).media_num ?? null,
        donoChave: owner ?? null,
        donoTime: owner ? CHAVES_TIMES[owner]?.nome_time ?? null : null,
        interessados: regs.map((r) => r.chave),
        meuOferecido: meuReg?.oferecido ?? null,
      });
    }

    // Meu elenco (todos os 26 do dono logado) com flag aVenda
    const chaveLogada = chaveLogadaAux;
    const meuElenco: AtletaMeuTime[] = [];
    let qtdAVenda = 0;
    if (chaveLogada && elencos[chaveLogada]) {
      const minhaAVenda = new Set(await getAVenda(kv, chaveLogada));
      qtdAVenda = minhaAVenda.size;
      const mercadoIdx = new Map(
        (mercadoResp?.atletas ?? []).map((a) => [a.atleta_id, a]),
      );
      for (const j of Object.values(elencos[chaveLogada].jogadores)) {
        const cartola = mercadoIdx.get(j.atleta_id);
        const pos = POSICAO[cartola?.posicao_id ?? -1];
        if (!pos) continue;
        meuElenco.push({
          atleta_id: j.atleta_id,
          nome: j.apelido_api,
          posicao: pos,
          clubeNome: j.clube,
          clubeId: j.clube_id,
          statusId: j.status_id,
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ??
            fixCartolaFoto(cartola?.foto) ?? null,
          pontosUltima: cartola?.pontos_num ?? null,
          // deno-lint-ignore no-explicit-any
          mediaPontos: (cartola as any)?.media_num ?? null,
          donoChave: chaveLogada,
          donoTime: CHAVES_TIMES[chaveLogada]?.nome_time ?? null,
          interessados: [],
          aVenda: minhaAVenda.has(j.atleta_id),
        });
      }
    }

    const posicaoDraft = chaveLogada
      ? draftOrdemKeys.indexOf(chaveLogada) + 1 || null
      : null;
    const draftOrdem = draftOrdemKeys.map((c) => ({
      chave: c,
      nome: CHAVES_TIMES[c]?.nome_time ?? c,
    }));

    return ctx.render({
      jogadores,
      clubes,
      minhaChave: ctx.state.session?.chave ?? null,
      meuElenco,
      qtdAVenda,
      posicaoDraft,
      draftOrdem,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function MercadoPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Mercado · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=54" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        <SectionHeader>Mercado</SectionHeader>
        <MercadoBrowser
          jogadores={data.jogadores}
          minhaChave={data.minhaChave}
          meuElenco={data.meuElenco}
          qtdAVenda={data.qtdAVenda}
          posicaoDraft={data.posicaoDraft}
          draftOrdem={data.draftOrdem}
        />
        <BottomNav active="mercado" />
      </div>
    </>
  );
}
