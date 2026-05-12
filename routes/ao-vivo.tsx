import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES, getAllElencos, getFotos } from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import { fetchMercadoStatus } from "../lib/cartola.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import AoVivoLive, { type AtletaBase } from "../islands/AoVivoLive.tsx";
import type { State } from "./_middleware.ts";

const CHAVE_FALLBACK_DEV = "aguiar";

interface UserInfo {
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

interface DataLive extends UserInfo {
  available: true;
  chave: string;
  displayName: string;
  accent: string;
  escalados: AtletaBase[];
  banco: AtletaBase[];
}

interface DataBloqueado extends UserInfo {
  available: false;
  motivo: string;
  proximoTs: number | null;
}

type Data = DataLive | DataBloqueado;

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const CHAVE_USUARIO = ctx.state.session?.chave ?? CHAVE_FALLBACK_DEV;
    const kv = await Deno.openKv();
    const [elencos, fotos, mercado] = await Promise.all([
      getAllElencos(kv),
      getFotos(kv),
      fetchMercadoStatus().catch(() => null),
    ]);

    // Disponibilidade: ao vivo só faz sentido quando o mercado está fechado
    // (status_mercado === 2 → rodada acontecendo) ou bola_rolando explícito.
    const aoVivoOk = !!mercado?.bola_rolando ||
      mercado?.status_mercado === 2;
    const userInfo: UserInfo = {
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    };
    if (!aoVivoOk) {
      const proximoTs = mercado?.fechamento?.timestamp ?? null;
      const motivo = mercado?.status_mercado === 1
        ? "Mercado aberto — ainda não começou a rodada"
        : "Sem rodada ao vivo agora";
      return ctx.render({ available: false, motivo, proximoTs, ...userInfo });
    }

    const visual = timeLigaInfo(CHAVE_USUARIO);
    const meta = CHAVES_TIMES[CHAVE_USUARIO];
    const displayName = visual?.displayName ?? meta?.nome_time ?? "Time";
    const accent = visual?.accent ?? "#888";

    const elenco = elencos[CHAVE_USUARIO];
    const todos = elenco ? Object.values(elenco.jogadores) : [];
    const calculados = todos.length ? calcularMelhorTime(todos) : [];
    const map = (j: typeof calculados[number]): AtletaBase => ({
      atleta_id: j.atleta_id,
      apelido: j.apelido_api,
      clube: j.clube,
      posicao: j.posicao as AtletaBase["posicao"],
      escudo: escudoUrl(j.clube),
      foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
    });
    const escalados = calculados.filter((j) => j.escalacao === "Sim").map(map);
    const banco = calculados.filter((j) => j.escalacao === "Banco").map(map);

    return ctx.render({
      available: true,
      chave: CHAVE_USUARIO,
      displayName,
      accent,
      escalados,
      banco,
      ...userInfo,
    });
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
        <link rel="stylesheet" href="/bf-styles.css?v=58" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />
        {data.available
          ? (
            <AoVivoLive
              chave={data.chave}
              displayName={data.displayName}
              accent={data.accent}
              escalados={data.escalados}
              banco={data.banco}
            />
          )
          : <AoVivoBloqueado motivo={data.motivo} proximoTs={data.proximoTs} />}
        <BottomNav active="live" />
      </div>
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
