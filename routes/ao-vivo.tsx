import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  getAllElencos,
  getFotos,
  getRodadaStatus,
  MAX_SUBS_AO_VIVO,
} from "../lib/kv.ts";
import { getMelhorTimeCached } from "../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../lib/historico.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import Field, {
  type BancoPino,
  type Escalacao,
  type Pino,
} from "../components/Field.tsx";
import CollapsibleTeamRow from "../islands/CollapsibleTeamRow.tsx";
import LeagueChart, { type LinhaTime } from "../islands/LeagueChart.tsx";
import SectionHeader from "../components/SectionHeader.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { cdn } from "../lib/cdn.ts";
import type { State } from "./_middleware.ts";

const CHAVE_FALLBACK_DEV = "aguiar";

const POS_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

interface TimeLinha {
  chave: string;
  nome: string;
  dono: string;
  pontuacaoRodada: number;
  total: number;
  rodadasJogadas: number;
  escalacao: Escalacao | null;
  banco: BancoPino[];
  historico: Record<string, number>;
  subsAplicadas: number;
}

interface UserInfo {
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

interface DataLive extends UserInfo {
  available: true;
  rodada: number;
  subsMax: number;
  times: TimeLinha[];
  meuChave: string;
}

interface DataBloqueado extends UserInfo {
  available: false;
  motivo: string;
  proximoTs: number | null;
}

type Data = DataLive | DataBloqueado;

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const T0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      timings.push(`${label};dur=${(performance.now() - since).toFixed(1)}`);
    };
    const kv = await Deno.openKv();
    const meuChave = ctx.state.session?.chave ?? CHAVE_FALLBACK_DEV;

    const userInfo: UserInfo = {
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    };

    const [elencos, fotos, rodadaStatus] = await Promise.all([
      getAllElencos(kv),
      getFotos(kv),
      getRodadaStatus(kv),
    ]);
    mark("kv1", T0);

    const aoVivo = rodadaStatus?.status === "ao_vivo";
    if (!aoVivo) {
      // Sem rodada rolando → bloqueia com placeholder + countdown.
      const proximoTs = rodadaStatus?.fechamento?.timestamp ?? null;
      const motivo = rodadaStatus?.status === "aguardando"
        ? "Mercado aberto — ainda não começou a rodada"
        : "Sem rodada ao vivo agora";
      mark("total", T0);
      const resp = await ctx.render({
        available: false,
        motivo,
        proximoTs,
        ...userInfo,
      });
      resp.headers.set("Server-Timing", timings.join(","));
      return resp;
    }

    // === Live: monta a liga inteira (mirror de /liga handler) ===

    const chavesArr = Object.keys(elencos);
    const Thist = performance.now();
    const historicos = await Promise.all(
      chavesArr.map((c) => getHistorico(kv, c)),
    );
    const historicoPorChave = new Map<string, Record<string, number>>();
    chavesArr.forEach((c, i) => historicoPorChave.set(c, historicos[i]));
    mark("hist", Thist);

    const Tmelhor = performance.now();
    const melhoresPorChave = new Map<
      string,
      Awaited<ReturnType<typeof getMelhorTimeCached>>
    >();
    await Promise.all(
      Object.entries(elencos).map(async ([chave, elenco]) => {
        const r = await getMelhorTimeCached(kv, chave, elenco);
        melhoresPorChave.set(chave, r);
      }),
    );
    mark("melhor", Tmelhor);

    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const calculados = melhoresPorChave.get(chave) ?? [];
      const escalados = calculados.filter((j) => j.escalacao === "Sim");
      const reservas = calculados.filter((j) => j.escalacao === "Banco");
      const subsAplicadas = escalados.filter((j) => j.substituido).length;
      const banco: BancoPino[] = reservas.map((j) => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        posicao: j.posicao,
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        subSaiu: j.descido === true,
      }));
      const ptsRodada = Math.round(
        escalados.reduce((s, j) => s + (j.pontos ?? 0), 0) * 100,
      ) / 100;
      const historico = historicoPorChave.get(chave) ?? {};

      const pino = (j: typeof escalados[number]): Pino => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        subEntrou: j.substituido,
      });
      const gk = escalados.find((j) => j.posicao === "Goleiro");
      const def = escalados.filter((j) =>
        j.posicao === "Zagueiro" || j.posicao === "Lateral"
      );
      const mid = escalados.filter((j) => j.posicao === "Meia");
      const ata = escalados.filter((j) => j.posicao === "Atacante");
      const escalacao: Escalacao | null = escalados.length
        ? {
          gk: gk ? pino(gk) : {},
          def: def.map(pino),
          mid: mid.map(pino),
          ata: ata.map(pino),
        }
        : null;

      times.push({
        chave,
        nome: elenco.nome_time,
        dono: elenco.dono,
        pontuacaoRodada: ptsRodada,
        total: totalPontos(historico),
        rodadasJogadas: Object.keys(historico).length,
        escalacao,
        banco,
        historico,
        subsAplicadas,
      });
    }

    // Ordena por pontos da rodada (ao vivo: o que importa é AGORA, não
    // total acumulado — diferente de /liga que ordena por total)
    times.sort((a, b) =>
      b.pontuacaoRodada - a.pontuacaoRodada || b.total - a.total
    );

    mark("data", T0);
    const Trender = performance.now();
    const resp = await ctx.render({
      available: true,
      rodada: rodadaStatus?.rodada ?? 0,
      subsMax: MAX_SUBS_AO_VIVO,
      times,
      meuChave,
      ...userInfo,
    });
    mark("render", Trender);
    mark("total", T0);
    resp.headers.set("Server-Timing", timings.join(","));
    return resp;
  },
};

function formatProximaAbertura(ts: number | null): string | null {
  if (!ts) return null;
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return null;
  const min = Math.floor(diff / 60000);
  const d = Math.floor(min / (60 * 24));
  const h = Math.floor((min % (60 * 24)) / 60);
  const m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export default function AoVivoPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Ao Vivo · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=82" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        {data.available
          ? <AoVivoLiga data={data} />
          : <AoVivoBloqueado motivo={data.motivo} proximoTs={data.proximoTs} />}
        <BottomNav active="live" />
      </div>
    </>
  );
}

function AoVivoLiga({ data }: { data: DataLive }) {
  return (
    <>
      <header class="bf-liga-hero">
        <span class="bf-label-micro">Ao Vivo</span>
        <h1 class="bf-liga-hero__title">RODADA {data.rodada}</h1>
        <div class="bf-liga-hero__meta">
          <span class="bf-liga-hero__rodada">
            {data.times.length} jogadores
          </span>
        </div>
      </header>

      <div class="bf-liga-list">
        {data.times.map((t, i) => {
          const pos = i + 1;
          const visual = timeLigaInfo(t.chave);
          const displayName = visual?.displayName ?? t.nome;
          const isMe = t.chave === data.meuChave;
          const accent = visual?.accent ?? "var(--bf-fg-2)";
          // Mostra pontos da rodada AO VIVO em vez do total acumulado.
          const rodadaFmt = t.pontuacaoRodada.toFixed(1).replace(".", ",");
          return (
            <CollapsibleTeamRow
              key={t.chave}
              chave={t.chave}
              pos={pos}
              displayName={displayName}
              dono={t.dono}
              totalFmt={rodadaFmt}
              accent={accent}
              isMine={isMe}
              historico={t.historico}
              subsBadge={{ aplicadas: t.subsAplicadas, max: data.subsMax }}
            >
              <div class="bf-team-row__expanded">
                {t.escalacao
                  ? (
                    <Field
                      jogadores={t.escalacao}
                      showPoints={true}
                      liveMode={true}
                      accent={accent}
                      banco={t.banco}
                    />
                  )
                  : (
                    <div class="bf-empty-state">
                      Sem escalação no elenco
                    </div>
                  )}
              </div>
            </CollapsibleTeamRow>
          );
        })}
      </div>

      <SectionHeader>Evolução</SectionHeader>
      <LeagueChart
        times={data.times.map((t): LinhaTime => {
          const info = timeLigaInfo(t.chave);
          return {
            chave: t.chave,
            nome: info?.displayName ?? t.nome,
            accent: info?.accent ?? "#888",
            logo: cdn(info?.logo ?? null),
            pontosPorRodada: t.historico,
          };
        })}
        destaque={data.meuChave}
      />
    </>
  );
}

function AoVivoBloqueado(
  { motivo, proximoTs }: { motivo: string; proximoTs: number | null },
) {
  const ate = formatProximaAbertura(proximoTs);
  return (
    <div class="bf-aovivo-blocked">
      <svg
        class="bf-aovivo-blocked__icon"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="32" cy="32" r="22" />
        <path d="M32 18v14l9 6" />
      </svg>
      <h2 class="bf-aovivo-blocked__title">Ao Vivo indisponível</h2>
      <p class="bf-aovivo-blocked__motivo">{motivo}</p>
      {ate && (
        <p class="bf-aovivo-blocked__contagem">
          Mercado fecha em <strong>{ate}</strong>
        </p>
      )}
      <a href="/" class="bf-aovivo-blocked__cta">Voltar para a home</a>
    </div>
  );
}
