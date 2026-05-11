import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES, getAllElencos, getFotos } from "../lib/kv.ts";
import { calcularMelhorTime } from "../lib/substituicao.ts";
import TopBar from "../components/TopBar.tsx";
import BottomNav from "../components/BottomNav.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { fotoUrl } from "../lib/fotos.ts";
import { timeLigaInfo } from "../lib/times-liga.ts";
import AoVivoLive, { type AtletaBase } from "../islands/AoVivoLive.tsx";

const CHAVE_USUARIO = "aguiar";

interface Data {
  chave: string;
  displayName: string;
  accent: string;
  escalados: AtletaBase[];
}

export const handler: Handlers<Data> = {
  async GET(_req, ctx) {
    const kv = await Deno.openKv();
    const [elencos, fotos] = await Promise.all([
      getAllElencos(kv),
      getFotos(kv),
    ]);

    const visual = timeLigaInfo(CHAVE_USUARIO);
    const meta = CHAVES_TIMES[CHAVE_USUARIO];
    const displayName = visual?.displayName ?? meta?.nome_time ?? "Time";
    const accent = visual?.accent ?? "#888";

    const elenco = elencos[CHAVE_USUARIO];
    const escalados: AtletaBase[] = elenco
      ? calcularMelhorTime(Object.values(elenco.jogadores))
        .filter((j) => j.escalacao === "Sim")
        .map((j) => ({
          atleta_id: j.atleta_id,
          apelido: j.apelido_api,
          clube: j.clube,
          posicao: j.posicao as AtletaBase["posicao"],
          escudo: escudoUrl(j.clube),
          foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        }))
      : [];

    return ctx.render({
      chave: CHAVE_USUARIO,
      displayName,
      accent,
      escalados,
    });
  },
};

export default function AoVivoPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Ao Vivo · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=2" />
      </Head>
      <div class="bf-viewport">
        <TopBar />
        <AoVivoLive
          chave={data.chave}
          displayName={data.displayName}
          accent={data.accent}
          escalados={data.escalados}
        />
        <BottomNav active="live" />
      </div>
    </>
  );
}
