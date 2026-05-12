import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { getEmailMap } from "../lib/auth.ts";
import { CHAVES_TIMES, TODAS_CHAVES } from "../lib/kv.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import SectionHeader from "../components/SectionHeader.tsx";
import TopBar from "../components/TopBar.tsx";
import AdminEmailMap from "../islands/AdminEmailMap.tsx";
import type { State } from "./_middleware.ts";

interface Data {
  atribuicoes: Array<{
    chave: string;
    nomeTime: string;
    dono: string;
    displayName: string;
    email: string | null;
  }>;
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
    return ctx.render({
      atribuicoes,
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
        <link rel="stylesheet" href="/bf-styles.css?v=54" />
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
            Atribua um email Google a cada time. Esse email será aceito no
            login via SSO e mapeado para o time correspondente.
          </p>
        </article>

        <SectionHeader>Atribuições</SectionHeader>
        <AdminEmailMap atribuicoes={data.atribuicoes} />
      </div>
    </>
  );
}
