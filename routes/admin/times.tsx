import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES, getAllElencos, TODAS_CHAVES } from "../../lib/kv.ts";
import { timeLigaInfo } from "../../lib/times-liga.ts";
import { cdn } from "../../lib/cdn.ts";
import SectionHeader from "../../components/SectionHeader.tsx";
import TopBar from "../../components/TopBar.tsx";
import type { State } from "../_middleware.ts";

interface TimeItem {
  chave: string;
  displayName: string;
  dono: string;
  accent: string;
  escudo: string | null;
  numJogadores: number;
}

interface Data {
  times: TimeItem[];
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const elencos = await getAllElencos();
    const times: TimeItem[] = TODAS_CHAVES.map((chave) => {
      const meta = CHAVES_TIMES[chave];
      const visual = timeLigaInfo(chave);
      const elenco = elencos[chave];
      return {
        chave,
        displayName: visual?.displayName ?? meta?.nome_time ?? chave,
        dono: meta?.dono ?? "",
        accent: visual?.accent ?? "#888",
        escudo: cdn(visual?.logo ?? null),
        numJogadores: elenco ? Object.keys(elenco.jogadores).length : 0,
      };
    });
    return ctx.render({
      times,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function AdminTimesIndex({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Admin · Times</title>
        <link rel="stylesheet" href="/bf-styles.css?v=163" />
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
            <span class="bf-status-card__hello">Admin · Times</span>
          </div>
          <p class="bf-status-card__sub" style="margin-top:8px">
            Selecione um time pra editar a escalação. Você terá poder de edição
            sobre qualquer jogador (mesmo durante a rodada).
          </p>
        </article>

        <SectionHeader>Todos os times</SectionHeader>
        <div class="bf-admin-times">
          {data.times.map((t) => (
            <a
              key={t.chave}
              href={`/admin/times/${t.chave}`}
              class="bf-admin-times__item"
              style={{ "--accent": t.accent } as Record<string, string>}
            >
              {t.escudo && (
                <img
                  class="bf-admin-times__escudo"
                  src={t.escudo}
                  alt={t.displayName}
                />
              )}
              <div class="bf-admin-times__meta">
                <div class="bf-admin-times__name">{t.displayName}</div>
                <div class="bf-admin-times__dono">{t.dono}</div>
              </div>
              <div class="bf-admin-times__count">
                {t.numJogadores}
                <span class="bf-admin-times__count-lbl">jog</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
