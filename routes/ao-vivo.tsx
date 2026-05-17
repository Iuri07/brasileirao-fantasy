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
import AoVivoEventosPartidas, {
  type AtletaMeta,
} from "../islands/AoVivoEventosPartidas.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
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
  /** Mapa chave → posição no ranking AO VIVO (total + parcial da rodada
      atual). A posição base do card vem da ORDEM dos times (= geral),
      então o delta = posGeral - posLive mostra como a rodada está
      mexendo no ranking. */
  posLivePorChave: Record<string, number>;
  /** Metadata dos atletas da liga (escalados + banco de todos os times).
      Passado pra island filtrar pontuados Cartola e renderizar eventos. */
  ligaAtletas: AtletaMeta[];
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

    // Ordem do card = ranking GERAL (total acumulado, mesma de /liga).
    // O "ao vivo" do /ao-vivo vem do delta + parcial + eventos, não da
    // ordem em si.
    times.sort((a, b) =>
      b.total - a.total || b.pontuacaoRodada - a.pontuacaoRodada
    );

    // Ranking AO VIVO simulado = total + parcial (onde estaria SE a
    // rodada terminasse agora). Comparado com a posição geral (i+1 na
    // ordem acima) gera o delta de "mudança em tempo real".
    const ordemLive = [...times].sort((a, b) =>
      (b.total + b.pontuacaoRodada) - (a.total + a.pontuacaoRodada) ||
      b.pontuacaoRodada - a.pontuacaoRodada
    );
    const posLivePorChave: Record<string, number> = {};
    ordemLive.forEach((t, i) => {
      posLivePorChave[t.chave] = i + 1;
    });

    // Junta metadata de TODOS atletas escalados+banco de TODOS os times.
    // Island filtra Cartola pontuados por esses IDs e renderiza eventos.
    const ligaAtletas: AtletaMeta[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const calculados = melhoresPorChave.get(chave) ?? [];
      const ativos = calculados.filter((j) =>
        j.escalacao === "Sim" || j.escalacao === "Banco"
      );
      for (const j of ativos) {
        ligaAtletas.push({
          atleta_id: j.atleta_id,
          apelido: j.apelido_api,
          clube: j.clube,
          posicao: j.posicao,
          escudo: escudoUrl(j.clube),
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        });
      }
      // suprime warning de elenco não usado (precisava só pra iterar chaves)
      void elenco;
    }

    mark("data", T0);
    const Trender = performance.now();
    const resp = await ctx.render({
      available: true,
      rodada: rodadaStatus?.rodada ?? 0,
      subsMax: MAX_SUBS_AO_VIVO,
      times,
      meuChave,
      posLivePorChave,
      ligaAtletas,
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
        <link rel="stylesheet" href="/bf-styles.css?v=89" />
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
          // pos = ranking GERAL (ordem dos times). posLive = onde estaria
          // SE a rodada terminasse agora. Delta positivo = subiu na live.
          const posLive = data.posLivePorChave[t.chave] ?? pos;
          const posDelta = pos - posLive;
          return (
            <CollapsibleTeamRow
              key={t.chave}
              chave={t.chave}
              pos={pos}
              displayName={displayName}
              dono={t.dono}
              totalFmt={rodadaFmt}
              ptsLabel="PARCIAL"
              posDelta={posDelta}
              accent={accent}
              isMine={isMe}
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

      <AoVivoEventosPartidas ligaAtletas={data.ligaAtletas} />
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
      <h2 class="bf-aovivo-blocked__title">Ao Vivo indisponivel</h2>
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
