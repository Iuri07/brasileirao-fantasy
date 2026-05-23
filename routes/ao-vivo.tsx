import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  getAllElencos,
  getFotos,
  getRodadaStatus,
  isRodadaEmAndamento,
  MAX_SUBS_AO_VIVO,
} from "../lib/kv.ts";
import { getMelhorTimeCached } from "../lib/substituicao.ts";
import { getHistorico, totalPontos } from "../lib/historico.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import DesktopSidebar from "../components/DesktopSidebar.tsx";
import Field, {
  type BancoPino,
  type Escalacao,
  type Pino,
} from "../components/Field.tsx";
import CollapsibleTeamRow from "../islands/CollapsibleTeamRow.tsx";
import AoVivoEventosPartidas, {
  type AtletaMeta,
} from "../islands/AoVivoEventosPartidas.tsx";
import ReservasRow from "../components/ReservasRow.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { coresClube } from "../lib/cores.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import { getNomeTimeDisplay } from "../lib/time-visual.ts";
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
  /** Banco — pode entrar via auto-sub. */
  banco: BancoPino[];
  /** Resto do elenco — fora do banco. */
  naoEscalados: BancoPino[];
  historico: Record<string, number>;
  subsAplicadas: number;
}

interface UserInfo {
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

interface Data extends UserInfo {
  rodada: number;
  /** True quando rodada está rolando — afeta só o label do header. */
  aoVivo: boolean;
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

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const T0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      timings.push(`${label};dur=${(performance.now() - since).toFixed(1)}`);
    };
    const meuChave = ctx.state.session?.chave ?? CHAVE_FALLBACK_DEV;

    const userInfo: UserInfo = {
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    };

    const [elencos, fotos, rodadaStatus] = await Promise.all([
      getAllElencos(),
      getFotos(),
      getRodadaStatus(),
    ]);
    mark("kv1", T0);

    const aoVivo = isRodadaEmAndamento(rodadaStatus?.status);

    // === Monta a liga inteira sempre (mesmo fora de rodada ao vivo) ===
    // Fora do live: parcial = 0, delta = 0, eventos vazios. Mas a página
    // continua útil mostrando ranking + escalações + próximas partidas.

    const chavesArr = Object.keys(elencos);
    const Thist = performance.now();
    const historicos = await Promise.all(
      chavesArr.map((c) => getHistorico(c)),
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
        const r = await getMelhorTimeCached(chave, elenco);
        melhoresPorChave.set(chave, r);
      }),
    );
    mark("melhor", Tmelhor);

    const times: TimeLinha[] = [];
    for (const [chave, elenco] of Object.entries(elencos)) {
      const calculados = melhoresPorChave.get(chave) ?? [];
      const escalados = calculados.filter((j) => j.escalacao === "Sim");
      const reservas = calculados.filter((j) => j.escalacao === "Banco");
      const naoEscaladosRaw = calculados.filter((j) => j.escalacao === "Não");
      const subsAplicadas = escalados.filter((j) => j.substituido).length;
      const toBanco = (j: typeof calculados[number]): BancoPino => ({
        nome: j.apelido_api,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        posicao: j.posicao,
        statusId: j.status_id,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        subSaiu: j.descido === true,
      });
      const banco: BancoPino[] = reservas.map(toBanco);
      const naoEscalados: BancoPino[] = naoEscaladosRaw.map(toBanco);
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
        nome: getNomeTimeDisplay(chave, elenco.nome_time),
        dono: elenco.dono,
        pontuacaoRodada: ptsRodada,
        total: totalPontos(historico),
        rodadasJogadas: Object.keys(historico).length,
        escalacao,
        banco,
        naoEscalados,
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
      // Display name vem do mapping da liga (timeLigaInfo) — mais limpo
      // que elenco.dono que tem capitalização inconsistente. Escudo vem
      // do mesmo mapping, wrapped pelo cdn() pra resolver em prod.
      const visual = timeLigaInfo(chave);
      const donoDisplay =
        (visual?.displayName ?? elenco.nome_time ?? elenco.dono).toUpperCase();
      const donoEscudo = cdn(visual?.logo ?? null);
      for (const j of ativos) {
        ligaAtletas.push({
          atleta_id: j.atleta_id,
          apelido: j.apelido_api,
          clube: j.clube,
          posicao: j.posicao,
          escudo: escudoUrl(j.clube),
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
          dono: donoDisplay,
          donoEscudo,
        });
      }
    }

    mark("data", T0);
    const Trender = performance.now();
    const resp = await ctx.render({
      rodada: rodadaStatus?.rodada ?? 0,
      aoVivo,
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

export default function AoVivoPage({ data }: PageProps<Data>) {
  const meu = data.times.find((t) => t.chave === data.meuChave);
  const ranking = data.times.map((t) => ({
    chave: t.chave,
    nome: t.nome,
    total: t.total,
    accent: timeLigaInfo(t.chave)?.accent ?? "var(--bf-fg-2)",
  }));
  return (
    <>
      <Head>
        <title>Ao Vivo · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=177" />
      </Head>
      <DesktopSidebar
        active="live"
        liveDisabled={!data.aoVivo}
        meuChave={data.meuChave}
        meuNomeTime={meu?.nome ?? null}
        meuDono={meu?.dono ?? null}
        totalTimes={data.times.length}
        ranking={ranking}
        fechamentoTexto={null}
        mercadoAberto={!data.aoVivo}
        isAdmin={data.userRole === "admin"}
        userEmail={data.userEmail}
        userRole={data.userRole}
        userNome={data.userNome}
        userPicture={data.userPicture}
      />
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        <AoVivoLiga data={data} />
        <BottomNav active="live" liveDisabled={!data.aoVivo} />
      </div>
    </>
  );
}

function AoVivoLiga({ data }: { data: Data }) {
  return (
    <div class="bf-aovivo-grid">
      <header class="bf-liga-hero bf-aovivo-grid__hero">
        <span class="bf-label-micro">
          {data.aoVivo ? "Ao Vivo" : "Aguardando"}
        </span>
        <h1 class="bf-liga-hero__title">RODADA {data.rodada}</h1>
        <div class="bf-liga-hero__meta">
          <span class="bf-liga-hero__rodada">
            {data.times.length} jogadores
          </span>
        </div>
      </header>

      <div class="bf-liga-list bf-aovivo-grid__rows">
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
              posDelta={data.aoVivo ? posDelta : null}
              accent={accent}
              isMine={isMe}
              logoUrl={visual?.logo ?? null}
              subsBadge={data.aoVivo
                ? { aplicadas: t.subsAplicadas, max: data.subsMax }
                : null}
            >
              <div class="bf-team-row__expanded">
                {t.escalacao
                  ? (
                    <>
                      <Field
                        jogadores={t.escalacao}
                        showPoints={data.aoVivo}
                        /* liveMode sempre true em /ao-vivo: detecção via
                           rodadaStatus pode estar atrás (cron de 5min),
                           mas se calcularMelhorTime já marcou substituido,
                           a rodada já rolou. Status ✓/✕/? perde sentido
                           aqui — quer ver subs/em-campo. */
                        liveMode={true}
                        accent={accent}
                      />
                      <ReservasRow
                        label="Banco"
                        jogadores={t.banco}
                        showPoints={data.aoVivo}
                      />
                      <ReservasRow
                        label="Não escalados"
                        jogadores={t.naoEscalados}
                        showPoints={data.aoVivo}
                      />
                    </>
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

      <div class="bf-aovivo-grid__events">
        <AoVivoEventosPartidas ligaAtletas={data.ligaAtletas} />
      </div>
    </div>
  );
}
