import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { getEmailMap } from "../lib/auth.ts";
import { CHAVES_TIMES, getRodadaStatus, TODAS_CHAVES } from "../lib/kv.ts";
import { getDiasResolucao } from "../lib/draft.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import SectionHeader from "../components/SectionHeader.tsx";
import TopBar from "../components/TopBar.tsx";
import AdminEmailMap from "../islands/AdminEmailMap.tsx";
import AdminDraftDias from "../islands/AdminDraftDias.tsx";
import AdminSimularRodada from "../islands/AdminSimularRodada.tsx";
import type { State } from "./_middleware.ts";

interface Data {
  atribuicoes: Array<{
    chave: string;
    nomeTime: string;
    dono: string;
    displayName: string;
    email: string | null;
  }>;
  diasResolucao: number[];
  simulando: boolean;
  rodadaAtual: number;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const emailMap = await getEmailMap(kv);
    const chaveToEmail: Record<string, string> = {};
    for (const [e, c] of Object.entries(emailMap)) {
      chaveToEmail[c] = e;
    }
    const atribuicoes = TODAS_CHAVES.map((chave) => {
      const meta = CHAVES_TIMES[chave];
      const visual = timeLigaInfo(chave);
      return {
        chave,
        nomeTime: meta?.nome_time ?? chave,
        dono: meta?.dono ?? "",
        displayName: visual?.displayName ?? meta?.nome_time ?? chave,
        email: chaveToEmail[chave] ?? null,
      };
    });
    const diasResolucao = await getDiasResolucao(kv);
    const simulandoKV = await kv.get<boolean>(["simulando"]);
    const simulando = !!simulandoKV.value;
    const rodadaStatus = await getRodadaStatus(kv);
    const rodadaAtual = rodadaStatus?.rodada ?? 1;
    return ctx.render({
      atribuicoes,
      diasResolucao,
      simulando,
      rodadaAtual,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function AdminPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Admin · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=72" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <article class="bf-card bf-status-card">
          <div class="bf-status-card__greeting">
            <span class="bf-status-card__hello">Admin</span>
          </div>
          <p class="bf-status-card__sub" style="margin-top:8px">
            Atribua um email Google a cada time. Esse email será aceito no login
            via SSO e mapeado para o time correspondente.
          </p>
        </article>

        <SectionHeader>Atribuições</SectionHeader>
        <AdminEmailMap atribuicoes={data.atribuicoes} />

        <SectionHeader>Resolução de conflitos do draft</SectionHeader>
        <article class="bf-card">
          <p class="bf-status-card__sub" style="margin:0 0 12px">
            Dias da semana em que os conflitos de interesse no draft são
            resolvidos. Mostrado pro usuário como contagem regressiva no
            mercado.
          </p>
          <AdminDraftDias iniciais={data.diasResolucao} />
        </article>

        <SectionHeader>Simular rodada ao vivo</SectionHeader>
        <article class="bf-card">
          <p class="bf-status-card__sub" style="margin:0 0 12px">
            Gera pontos aleatórios pros 26 jogadores de cada elenco e marca o
            status como{" "}
            <strong>ao_vivo</strong>. Trava o cron pra não sobrescrever até você
            encerrar. Útil pra testar a UI sem depender da rodada real da
            Cartola.
          </p>
          <AdminSimularRodada
            ativoInicial={data.simulando}
            rodadaAtual={data.rodadaAtual}
          />
        </article>
      </div>
    </>
  );
}
