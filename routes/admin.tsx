import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { getEmailMap } from "../lib/auth.ts";
import { CHAVES_TIMES, getRodadaStatus, TODAS_CHAVES } from "../lib/kv.ts";
import { getDiasResolucao, getHoraResolucao } from "../lib/draft.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getAllTimeVisuais, resolveTimeVisual } from "../lib/time-visual.ts";
import { getAllHistoricos } from "../lib/historico.ts";
import { cdn } from "../lib/cdn.ts";
import { getDb } from "../lib/db.ts";
import SectionHeader from "../components/SectionHeader.tsx";
import TopBar from "../components/TopBar.tsx";
import DesktopSidebar from "../components/DesktopSidebar.tsx";
import AdminEmailMap from "../islands/AdminEmailMap.tsx";
import AdminDraftDias from "../islands/AdminDraftDias.tsx";
import AdminSimularRodada from "../islands/AdminSimularRodada.tsx";
import AdminHistoricoMatriz from "../islands/AdminHistoricoMatriz.tsx";
import AdminTimesGrid from "../islands/AdminTimesGrid.tsx";
import { listarTodasOfertas } from "../lib/ofertas.ts";
import { listarTrocas } from "../lib/historico-trocas.ts";
import type { State } from "./_middleware.ts";

interface SessaoAtiva {
  id: string;
  role: "user" | "admin";
  chave: string | null;
  name: string | null;
  email: string | null;
  lastSeenAt: number;
  createdAt: number;
}

interface UltimoLogin {
  userKey: string;
  role: "user" | "admin";
  chave: string | null;
  name: string | null;
  email: string | null;
  lastLoginAt: number;
  loginCount: number;
}

interface AtividadeRecente {
  ts: number;
  /** "troca" | "oferta" | "transferencia" */
  tipo: string;
  descricao: string;
}

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
  horaResolucao: number;
  simulando: boolean;
  rodadaAtual: number;
  ofertasPendentesCount: number;
  trocasConcluidasCount: number;
  sessoesAtivas: SessaoAtiva[];
  ultimosLogins: UltimoLogin[];
  /** Atividade recente (trocas, ofertas), ordenado desc por ts. Top 10. */
  timeline: AtividadeRecente[];
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
      horaResolucao,
      rodadaStatus,
      ofertas,
      trocas,
    ] = await Promise.all([
      getEmailMap(),
      getAllTimeVisuais(),
      getAllHistoricos(),
      getDiasResolucao(),
      getHoraResolucao(),
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

    // Sessões ATIVAS = quem está ONLINE agora (last_seen dentro
    // dos últimos 5 min — mesma janela do pip verde). Sessões mais
    // antigas (mesmo não expiradas) vão pra "Últimos logins".
    // Dedup por usuário.
    const db = getDb();
    const ATIVO_MS = 5 * 60 * 1000; // 5 minutos (= online)
    const limiteAtivo = Date.now() - ATIVO_MS;
    const sessoesRows = db.prepare(
      "SELECT id, role, chave, name, email, last_seen_at, created_at " +
        "FROM sessions " +
        "WHERE expires_at > ? AND COALESCE(last_seen_at, created_at) > ? " +
        "ORDER BY COALESCE(last_seen_at, created_at) DESC",
    ).all<{
      id: string;
      role: "user" | "admin";
      chave: string | null;
      name: string | null;
      email: string | null;
      last_seen_at: number | null;
      created_at: number;
    }>(Date.now(), limiteAtivo);
    const seenUsers = new Set<string>();
    const sessoesAtivas: SessaoAtiva[] = [];
    for (const s of sessoesRows) {
      // Dedup: admin sem chave/email vira "admin:local" (todas as
      // sessões admin contam como o mesmo usuário no UI).
      const userKey = s.chave ?? s.email ??
        (s.role === "admin" ? "admin:local" : s.id);
      if (seenUsers.has(userKey)) continue;
      seenUsers.add(userKey);
      sessoesAtivas.push({
        id: s.id.slice(0, 8),
        role: s.role,
        chave: s.chave,
        name: s.name,
        email: s.email,
        lastSeenAt: s.last_seen_at ?? s.created_at,
        createdAt: s.created_at,
      });
    }

    // Últimos logins (tabela user_logins) — 1 row por TIME (chave),
    // EXCLUINDO usuários que estão em sessões ativas (já aparecem acima).
    // Histórico permanente — sobrevive a expirar/deslogar.
    const activeChaves = new Set<string>(
      sessoesAtivas
        .filter((s) => s.chave !== null)
        .map((s) => s.chave as string),
    );
    const loginsRows = db.prepare(
      "SELECT user_key, role, chave, name, email, last_login_at, login_count " +
        "FROM user_logins " +
        "WHERE chave IS NOT NULL " +
        "ORDER BY last_login_at DESC LIMIT 100",
    ).all<{
      user_key: string;
      role: "user" | "admin";
      chave: string | null;
      name: string | null;
      email: string | null;
      last_login_at: number;
      login_count: number;
    }>();
    // Dedup por chave (1 por time, mais recente) + exclui ativos.
    const seenChaves = new Set<string>();
    const ultimosLogins: UltimoLogin[] = [];
    for (const r of loginsRows) {
      if (!r.chave) continue;
      if (activeChaves.has(r.chave)) continue;
      if (seenChaves.has(r.chave)) continue;
      seenChaves.add(r.chave);
      ultimosLogins.push({
        userKey: r.user_key,
        role: r.role,
        chave: r.chave,
        name: r.name,
        email: r.email,
        lastLoginAt: r.last_login_at,
        loginCount: r.login_count,
      });
    }

    // Timeline: mistura trocas e ofertas recentes ordenadas por ts.
    const timeline: AtividadeRecente[] = [];
    for (const t of trocas.slice(0, 10)) {
      const cA = atribuicoes.find((a) => a.chave === t.chaveA)?.displayName ??
        t.chaveA;
      const cB = atribuicoes.find((a) => a.chave === t.chaveB)?.displayName ??
        t.chaveB;
      timeline.push({
        ts: t.concluidaEm,
        tipo: "troca",
        descricao: `${cA} ↔ ${cB}: ${t.atletaA.apelido} ↔ ${t.atletaB.apelido}`,
      });
    }
    for (const o of ofertas.slice(0, 10)) {
      const cA = atribuicoes.find((a) => a.chave === o.deChave)?.displayName ??
        o.deChave;
      const cB = atribuicoes.find((a) => a.chave === o.paraChave)
        ?.displayName ?? o.paraChave;
      timeline.push({
        ts: o.criadoEm,
        tipo: "oferta",
        descricao: `${cA} → ${cB} (${o.status})`,
      });
    }
    timeline.sort((a, b) => b.ts - a.ts);
    const timelineTop = timeline.slice(0, 12);

    return ctx.render({
      atribuicoes,
      visuais,
      historicoTimes,
      historicos,
      diasResolucao,
      horaResolucao,
      simulando,
      rodadaAtual: rodadaStatus?.rodada ?? 1,
      ofertasPendentesCount: ofertas.length,
      trocasConcluidasCount: trocas.length,
      sessoesAtivas,
      ultimosLogins,
      timeline: timelineTop,
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
        <link rel="stylesheet" href="/bf-styles.css?v=180" />
      </Head>
      <DesktopSidebar
        active="admin"
        liveDisabled={false}
        isAdmin
        meuChave={null}
        meuNomeTime={null}
        meuDono={null}
        totalTimes={data.atribuicoes.length}
        ranking={data.atribuicoes.map((a) => ({
          chave: a.chave,
          nome: a.displayName,
          total: 0,
          accent: data.visuais.find((v) => v.chave === a.chave)?.accent ??
            "var(--bf-fg-2)",
        }))}
        fechamentoTexto={null}
        userEmail={data.userEmail}
        userRole={data.userRole}
        userNome={data.userNome}
        userPicture={data.userPicture}
      />
      <div class="bf-viewport bf-admin-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <div class="bf-admin-desktop">
          {/* Section nav: barra horizontal no topo da main area */}
          <nav class="bf-admin-tabs">
            <a href="#visao-geral">Visão geral</a>
            <a href="#atividade">Atividade</a>
            <a href="#historico">Pontos por rodada</a>
            <a href="#times">Times (visual + email)</a>
            <a href="#ofertas">Ofertas pendentes</a>
            <a href="#trocas">Histórico de trocas</a>
            <a href="#draft">Draft</a>
            <a href="#simular">Simular rodada</a>
            <a href="#times-edit">Editar elencos</a>
          </nav>

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
                <a
                  class="bf-admin-overview__card bf-admin-overview__card--link"
                  href="#atividade"
                >
                  <span class="bf-admin-overview__num">
                    {data.sessoesAtivas.filter((s) =>
                      Date.now() - s.lastSeenAt < 5 * 60 * 1000
                    ).length}
                  </span>
                  <span class="bf-admin-overview__lbl">Online agora</span>
                </a>
              </div>
            </section>

            {/* ATIVIDADE: sessões + timeline */}
            <section id="atividade" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Atividade</h2>
                <span class="bf-admin-section__sub">
                  Sessões ativas e últimas trocas/ofertas.
                </span>
              </header>

              <div class="bf-admin-atividade">
                {/* Sessões ONLINE (last_seen < 5min) */}
                <div class="bf-admin-atividade__col">
                  <div class="bf-admin-atividade__col-titulo">
                    Sessões online ({data.sessoesAtivas.length})
                  </div>
                  {data.sessoesAtivas.length === 0
                    ? (
                      <div class="bf-empty-state">
                        Ninguém online agora.
                      </div>
                    )
                    : (
                      <ul class="bf-admin-sessoes">
                        {data.sessoesAtivas.map((s) => {
                          const idle = Date.now() - s.lastSeenAt;
                          const idleTxt = idle < 60_000
                            ? "agora"
                            : `${Math.floor(idle / 60_000)} min`;
                          return (
                            <li
                              key={s.id}
                              class="bf-admin-sessoes__row bf-admin-sessoes__row--online"
                            >
                              <span class="bf-admin-sessoes__dot bf-admin-sessoes__dot--on" />
                              <span class="bf-admin-sessoes__name">
                                {s.name ?? s.email ?? s.id}
                              </span>
                              <span class="bf-admin-sessoes__role">
                                {s.role === "admin" ? "admin" : (s.chave ?? "—")}
                              </span>
                              <span class="bf-admin-sessoes__idle">
                                {idleTxt}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                </div>

                {/* Últimos logins (1 por time, ex-online) */}
                <div class="bf-admin-atividade__col">
                  <div class="bf-admin-atividade__col-titulo">
                    Últimos logins ({data.ultimosLogins.length})
                  </div>
                  {data.ultimosLogins.length === 0
                    ? (
                      <div class="bf-empty-state">
                        Nenhum login registrado.
                      </div>
                    )
                    : (
                      <ul class="bf-admin-sessoes">
                        {data.ultimosLogins.map((u) => {
                          const ago = Date.now() - u.lastLoginAt;
                          const agoTxt = ago < 60_000
                            ? "agora"
                            : ago < 3600_000
                            ? `${Math.floor(ago / 60_000)} min`
                            : ago < 86400_000
                            ? `${Math.floor(ago / 3600_000)} h`
                            : `${Math.floor(ago / 86400_000)} d`;
                          return (
                            <li
                              key={u.userKey}
                              class="bf-admin-sessoes__row bf-admin-sessoes__row--off"
                            >
                              <span class="bf-admin-sessoes__dot bf-admin-sessoes__dot--off" />
                              <span class="bf-admin-sessoes__name">
                                {u.name ?? u.email ?? u.userKey}
                              </span>
                              <span class="bf-admin-sessoes__role">
                                {u.role === "admin" ? "admin" : (u.chave ?? "—")}
                                {" · "}
                                {u.loginCount}x
                              </span>
                              <span class="bf-admin-sessoes__idle">
                                {agoTxt} atrás
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                </div>

                {/* Timeline de eventos */}
                <div class="bf-admin-atividade__col">
                  <div class="bf-admin-atividade__col-titulo">
                    Últimos eventos
                  </div>
                  {data.timeline.length === 0
                    ? (
                      <div class="bf-empty-state">Nenhum evento recente.</div>
                    )
                    : (
                      <ul class="bf-admin-timeline">
                        {data.timeline.map((e) => {
                          const dt = new Date(e.ts);
                          const dtTxt = dt.toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          });
                          return (
                            <li
                              key={`${e.ts}-${e.descricao}`}
                              class={`bf-admin-timeline__item bf-admin-timeline__item--${e.tipo}`}
                            >
                              <span class="bf-admin-timeline__ts">{dtTxt}</span>
                              <span class="bf-admin-timeline__tipo">
                                {e.tipo}
                              </span>
                              <span class="bf-admin-timeline__desc">
                                {e.descricao}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
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

            {/* Ações rápidas: 3 cards lado-a-lado pra economizar espaço */}
            <div class="bf-admin-acoes">
              <section
                id="ofertas"
                class="bf-admin-section bf-admin-section--mini"
              >
                <header class="bf-admin-section__header">
                  <h2>Ofertas pendentes</h2>
                  <span class="bf-admin-section__sub">
                    {data.ofertasPendentesCount}{" "}
                    pendente(s) · cancela ofertas esquecidas.
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

              <section
                id="trocas"
                class="bf-admin-section bf-admin-section--mini"
              >
                <header class="bf-admin-section__header">
                  <h2>Histórico de trocas</h2>
                  <span class="bf-admin-section__sub">
                    {data.trocasConcluidasCount}{" "}
                    troca(s) · pode desfazer.
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

              <section
                id="simular"
                class="bf-admin-section bf-admin-section--mini"
              >
                <header class="bf-admin-section__header">
                  <h2>Simular rodada</h2>
                  <span class="bf-admin-section__sub">
                    Pontos aleatórios + status ao_vivo (trava cron).
                  </span>
                </header>
                <AdminSimularRodada
                  ativoInicial={data.simulando}
                  rodadaAtual={data.rodadaAtual}
                />
              </section>
            </div>

            <section id="draft" class="bf-admin-section">
              <header class="bf-admin-section__header">
                <h2>Draft · Dias de resolução</h2>
                <span class="bf-admin-section__sub">
                  Dias da semana em que conflitos são resolvidos.
                </span>
              </header>
              <AdminDraftDias iniciais={data.diasResolucao} horaInicial={data.horaResolucao} />
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
            <AdminDraftDias iniciais={data.diasResolucao} horaInicial={data.horaResolucao} />
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
