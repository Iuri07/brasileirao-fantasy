import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { getEmailMap } from "../lib/auth.ts";
import { CHAVES_TIMES, getRodadaStatus, TODAS_CHAVES } from "../lib/kv.ts";
import { getDiasResolucao } from "../lib/draft.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getAllTimeVisuais, resolveTimeVisual } from "../lib/time-visual.ts";
import { getAllHistoricos } from "../lib/historico.ts";
import { cdn } from "../lib/cdn.ts";
import SectionHeader from "../components/SectionHeader.tsx";
import TopBar from "../components/TopBar.tsx";
import AdminEmailMap from "../islands/AdminEmailMap.tsx";
import AdminDraftDias from "../islands/AdminDraftDias.tsx";
import AdminSimularRodada from "../islands/AdminSimularRodada.tsx";
import AdminHistoricoMatriz from "../islands/AdminHistoricoMatriz.tsx";
import AdminTimesGrid from "../islands/AdminTimesGrid.tsx";
import { listarTodasOfertas } from "../lib/ofertas.ts";
import { listarTrocas } from "../lib/historico-trocas.ts";
import type { State } from "./_middleware.ts";

interface AtribuicaoItem {
  chave: string;
  nomeTime: string;
  dono: string;
  displayName: string;
  email: string | null;
}

interface VisualItem {
  chave: string;
  nomeTime: string;
  displayName: string;
  logo: string | null;
  sigla: string;
  accent: string;
  customizado: boolean;
  dono: string;
  email: string | null;
}

interface HistoricoTimeItem {
  chave: string;
  displayName: string;
  escudo: string | null;
}

interface Data {
  atribuicoes: AtribuicaoItem[];
  visuais: VisualItem[];
  historicoTimes: HistoricoTimeItem[];
  historicos: Record<string, Record<string, number>>;
  diasResolucao: number[];
  simulando: boolean;
  rodadaAtual: number;
  ofertasPendentesCount: number;
  trocasConcluidasCount: number;
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const { appStateGet } = await import("../lib/app-state.ts");
    const simulando = appStateGet<boolean>("simulando") === true;
    const [
      emailMap,
      todosOverrides,
      historicos,
      diasResolucao,
      rodadaStatus,
      ofertas,
      trocas,
    ] = await Promise.all([
      getEmailMap(),
      getAllTimeVisuais(),
      getAllHistoricos(),
      getDiasResolucao(),
      getRodadaStatus(),
      listarTodasOfertas({ status: "pendente" }),
      listarTrocas(),
    ]);

    const chaveToEmail: Record<string, string> = {};
    for (const [e, c] of Object.entries(emailMap)) chaveToEmail[c] = e;

    const atribuicoes: AtribuicaoItem[] = TODAS_CHAVES.map((chave) => {
      const meta = CHAVES_TIMES[chave];
      const resolved = resolveTimeVisual(chave, todosOverrides[chave] ?? null);
      return {
        chave,
        nomeTime: resolved.nomeTime,
        dono: meta?.dono ?? "",
        displayName: resolved.displayName,
        email: chaveToEmail[chave] ?? null,
      };
    });

    const visuais: VisualItem[] = TODAS_CHAVES.map((chave) => {
      const baseInfo = timeLigaInfo(chave);
      const resolved = resolveTimeVisual(
        chave,
        todosOverrides[chave] ?? null,
        baseInfo,
      );
      const meta = CHAVES_TIMES[chave];
      return {
        chave,
        nomeTime: resolved.nomeTime,
        displayName: resolved.displayName,
        logo: cdn(resolved.logo),
        sigla: resolved.sigla,
        accent: resolved.accent,
        customizado: resolved.customizado,
        dono: meta?.dono ?? "",
        email: chaveToEmail[chave] ?? null,
      };
    });

    const historicoTimes: HistoricoTimeItem[] = TODAS_CHAVES.map((chave) => {
      const baseInfo = timeLigaInfo(chave);
      const resolved = resolveTimeVisual(
        chave,
        todosOverrides[chave] ?? null,
        baseInfo,
      );
      return {
        chave,
        displayName: resolved.displayName,
        escudo: cdn(resolved.logo),
      };
    });

    return ctx.render({
      atribuicoes,
      visuais,
      historicoTimes,
      historicos,
      diasResolucao,
      simulando,
      rodadaAtual: rodadaStatus?.rodada ?? 1,
      ofertasPendentesCount: ofertas.length,
      trocasConcluidasCount: trocas.length,
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
        <link rel="stylesheet" href="/bf-styles.css?v=137" />
      </Head>
      <div class="bf-viewport bf-admin-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        {/* ============ DESKTOP DASHBOARD (≥1024px) ============ */}
        <div class="bf-admin-desktop">
          <aside class="bf-admin-desktop__sidebar">
            <h2 class="bf-admin-desktop__sidebar-title">Admin</h2>
            <nav class="bf-admin-desktop__nav">
              <a href="#visao-geral">Visão geral</a>
              <a href="#historico">Pontos por rodada</a>
              <a href="#times">Times (visual + email)</a>
              <a href="#ofertas">Ofertas pendentes</a>
              <a href="#trocas">Histórico de trocas</a>
              <a href="#draft">Draft</a>
              <a href="#simular">Simular rodada</a>
              <a href="#times-edit">Editar elencos</a>
            </nav>
          </aside>

          <main class="bf-admin-desktop__main">
            <section id="visao-geral" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Visão geral</h2>
                <span class="bf-admin-section__sub">
                  Rodada atual: <strong>{data.rodadaAtual}</strong>
                  {" · "}
                  {data.simulando ? "Simulação ATIVA" : "Modo normal"}
                </span>
              </header>
              <div class="bf-admin-overview">
                <div class="bf-admin-overview__card">
                  <span class="bf-admin-overview__num">
                    {data.visuais.length}
                  </span>
                  <span class="bf-admin-overview__lbl">Times</span>
                </div>
                <a
                  class="bf-admin-overview__card bf-admin-overview__card--link"
                  href="/admin/ofertas"
                >
                  <span class="bf-admin-overview__num">
                    {data.ofertasPendentesCount}
                  </span>
                  <span class="bf-admin-overview__lbl">Ofertas pendentes</span>
                </a>
                <a
                  class="bf-admin-overview__card bf-admin-overview__card--link"
                  href="/admin/trocas"
                >
                  <span class="bf-admin-overview__num">
                    {data.trocasConcluidasCount}
                  </span>
                  <span class="bf-admin-overview__lbl">Trocas concluídas</span>
                </a>
                <div class="bf-admin-overview__card">
                  <span class="bf-admin-overview__num">
                    {Object.values(data.historicos).reduce(
                      (s, h) => s + Object.keys(h).length,
                      0,
                    )}
                  </span>
                  <span class="bf-admin-overview__lbl">Pontos lançados</span>
                </div>
              </div>
            </section>

            <section id="historico" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Pontos por rodada</h2>
                <span class="bf-admin-section__sub">
                  Edite qualquer célula — salva automaticamente.
                </span>
              </header>
              <AdminHistoricoMatriz
                times={data.historicoTimes}
                rodadaAtual={data.rodadaAtual}
                historicosIniciais={data.historicos}
              />
            </section>

            <section id="times" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Times</h2>
                <span class="bf-admin-section__sub">
                  Logo, nome e email atrelado de cada time. Resetar volta o
                  visual pro default.
                </span>
              </header>
              <AdminTimesGrid times={data.visuais} />
            </section>

            <section id="ofertas" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Ofertas pendentes</h2>
                <span class="bf-admin-section__sub">
                  {data.ofertasPendentesCount}{" "}
                  pendente(s) · cancela ofertas esquecidas e remove dos
                  negociáveis.
                </span>
              </header>
              <a
                href="/admin/ofertas"
                class="bf-btn bf-btn--primary"
                style="display:inline-flex"
              >
                Gerenciar →
              </a>
            </section>

            <section id="trocas" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Histórico de trocas</h2>
                <span class="bf-admin-section__sub">
                  {data.trocasConcluidasCount}{" "}
                  troca(s) concluída(s) · pode desfazer.
                </span>
              </header>
              <a
                href="/admin/trocas"
                class="bf-btn bf-btn--primary"
                style="display:inline-flex"
              >
                Ver histórico →
              </a>
            </section>

            <section id="draft" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Draft · Dias de resolução</h2>
                <span class="bf-admin-section__sub">
                  Dias da semana em que conflitos são resolvidos.
                </span>
              </header>
              <AdminDraftDias iniciais={data.diasResolucao} />
            </section>

            <section id="simular" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Simular rodada ao vivo</h2>
                <span class="bf-admin-section__sub">
                  Gera pontos aleatórios e marca status como ao_vivo (trava
                  cron).
                </span>
              </header>
              <AdminSimularRodada
                ativoInicial={data.simulando}
                rodadaAtual={data.rodadaAtual}
              />
            </section>

            <section id="times-edit" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Editar elencos</h2>
                <span class="bf-admin-section__sub">
                  Escolha um time pra editar escalação e transferir jogador.
                </span>
              </header>
              <div class="bf-admin-times bf-admin-times--desktop">
                {data.visuais.map((t) => (
                  <a
                    key={t.chave}
                    href={`/admin/times/${t.chave}`}
                    class="bf-admin-times__item"
                    style={{ "--accent": t.accent } as Record<string, string>}
                  >
                    {t.logo
                      ? (
                        <img
                          class="bf-admin-times__escudo"
                          src={t.logo}
                          alt={t.displayName}
                        />
                      )
                      : <div class="bf-admin-times__sigla">{t.sigla}</div>}
                    <div class="bf-admin-times__meta">
                      <div class="bf-admin-times__name">{t.displayName}</div>
                      <div class="bf-admin-times__dono">
                        {data.atribuicoes.find((a) => a.chave === t.chave)
                          ?.dono ?? ""}
                      </div>
                    </div>
                    <div class="bf-admin-times__count">
                      Abrir →
                    </div>
                  </a>
                ))}
              </div>
            </section>
          </main>
        </div>

        {/* ============ MOBILE LAYOUT (cards-link existentes) ============ */}
        <div class="bf-admin-mobile">
          <article class="bf-card bf-status-card">
            <div class="bf-status-card__greeting">
              <span class="bf-status-card__hello">Admin</span>
            </div>
            <p class="bf-status-card__sub" style="margin-top:8px">
              Atribua um email Google a cada time. Esse email será aceito no
              login via SSO e mapeado para o time correspondente.
            </p>
          </article>

          <SectionHeader>Editar times</SectionHeader>
          <article class="bf-card">
            <p class="bf-status-card__sub" style="margin:0 0 12px">
              Editar a escalação de qualquer time da liga, transferir jogador
              entre times. Edição funciona mesmo durante a rodada (use com
              cuidado).
            </p>
            <a href="/admin/times" class="bf-btn" style="display:inline-flex">
              Ver todos os times →
            </a>
          </article>

          <SectionHeader>Negociáveis e Ofertas</SectionHeader>
          <article class="bf-card">
            <p class="bf-status-card__sub" style="margin:0 0 12px">
              Tirar jogador dos negociáveis (override do dono) e cancelar
              ofertas pendentes esquecidas/incorretas.
            </p>
            <a href="/admin/ofertas" class="bf-btn" style="display:inline-flex">
              Gerenciar →
            </a>
          </article>

          <SectionHeader>Histórico de Trocas</SectionHeader>
          <article class="bf-card">
            <p class="bf-status-card__sub" style="margin:0 0 12px">
              Trocas concluídas (oferta aceita) registradas pra poder desfazer
              depois. Reverte os jogadores aos elencos originais com a escalação
              que tinham antes da troca.
            </p>
            <a href="/admin/trocas" class="bf-btn" style="display:inline-flex">
              Ver histórico →
            </a>
          </article>

          <SectionHeader>Atribuicoes</SectionHeader>
          <AdminEmailMap atribuicoes={data.atribuicoes} />

          <SectionHeader>Resolucao de conflitos do draft</SectionHeader>
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
              <strong>ao_vivo</strong>. Trava o cron pra não sobrescrever até
              você encerrar. Útil pra testar a UI sem depender da rodada real da
              Cartola.
            </p>
            <AdminSimularRodada
              ativoInicial={data.simulando}
              rodadaAtual={data.rodadaAtual}
            />
          </article>
        </div>
      </div>
    </>
  );
}
