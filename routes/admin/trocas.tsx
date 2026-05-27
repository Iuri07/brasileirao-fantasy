import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES } from "../../lib/kv.ts";
import {
  listarTrocas,
  type TrocaConcluida,
} from "../../lib/historico-trocas.ts";
import { timeLigaInfo } from "../../lib/times-liga.ts";
import TopBar from "../../components/TopBar.tsx";
import SectionHeader from "../../components/SectionHeader.tsx";
import AdminTrocasPanel, {
  type TrocaItem,
} from "../../islands/AdminTrocasPanel.tsx";
import type { State } from "../_middleware.ts";

interface Data {
  trocas: TrocaItem[];
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

function nomeTime(chave: string): string {
  const v = timeLigaInfo(chave);
  const m = CHAVES_TIMES[chave];
  return v?.displayName ?? m?.nome_time ?? chave;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    // Inclui as desfeitas pra admin ter contexto histórico completo
    const trocas = await listarTrocas({ incluirDesfeitas: true });
    const items: TrocaItem[] = trocas.map((t: TrocaConcluida) => ({
      id: t.id,
      concluidaEm: t.concluidaEm,
      desfeitaEm: t.desfeitaEm,
      chaveA: t.chaveA,
      nomeA: nomeTime(t.chaveA),
      atletaA: t.atletaA.apelido,
      chaveB: t.chaveB,
      nomeB: nomeTime(t.chaveB),
      atletaB: t.atletaB.apelido,
    }));
    return ctx.render({
      trocas: items,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function AdminTrocasPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Admin · Histórico de Trocas</title>
        <link rel="stylesheet" href="/bf-styles.css?v=185" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <article class="bf-card bf-status-card">
          <div class="bf-status-card__top">
            <div class="bf-status-card__name">
              <h3>Histórico de Trocas</h3>
              <span class="bf-status-card__sub">Admin</span>
            </div>
            <a
              href="/admin"
              class="bf-btn bf-btn--ghost"
              style="height:32px;font-size:11px;padding:0 12px"
            >
              ← admin
            </a>
          </div>
          <p class="bf-status-card__sub" style="margin-top:8px">
            Lista de trocas aceitas. Use "desfazer" pra mover os jogadores de
            volta aos elencos originais. Falha se algum dos dois jogadores foi
            envolvido em outra troca depois — desfaça as posteriores primeiro.
          </p>
        </article>

        <SectionHeader>Trocas concluídas ({data.trocas.length})</SectionHeader>
        <AdminTrocasPanel trocas={data.trocas} />
      </div>
    </>
  );
}
