import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import {
  CHAVES_TIMES,
  getAVenda,
  getElenco,
  getFotos,
  getRodadaStatus,
  getSubsUsadas,
  isRodadaEmAndamento,
  MAX_SUBS_AO_VIVO,
  TODAS_CHAVES,
} from "../../../lib/kv.ts";
import { fotoUrl } from "../../../lib/fotos.ts";
import { timeLigaInfo } from "../../../lib/times-liga.ts";
import TopBar from "../../../components/TopBar.tsx";
import SectionHeader from "../../../components/SectionHeader.tsx";
import MeuTimeEditor, {
  type AtletaElenco,
} from "../../../islands/MeuTimeEditor.tsx";
import AdminTransferirPanel from "../../../islands/AdminTransferirPanel.tsx";
import type { State } from "../../_middleware.ts";

interface JogadorParaTransferir {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
  escalacao: "Sim" | "Banco" | "Não";
}

interface TimeDestino {
  chave: string;
  displayName: string;
}

interface Data {
  chave: string;
  displayName: string;
  dono: string;
  accent: string;
  atletas: AtletaElenco[];
  /** Lista crua do elenco pro painel de transferência (inclui campos
      como clube que o MeuTimeEditor não usa). */
  jogadoresParaTransferir: JogadorParaTransferir[];
  /** Outros times da liga pra dropdown de destino na transferência. */
  outrosTimes: TimeDestino[];
  aoVivo: boolean;
  subsUsadas: number;
  subsMax: number;
  aVendaIds: number[];
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const chave = ctx.params.chave.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response("Time não encontrado", { status: 404 });
    }
    const [elenco, fotos, rodadaStatus, aVendaIds] = await Promise.all([
      getElenco(chave),
      getFotos(),
      getRodadaStatus(),
      getAVenda(chave),
    ]);
    if (!elenco) {
      return new Response("Elenco não seedado", { status: 404 });
    }
    const aoVivo = isRodadaEmAndamento(rodadaStatus?.status);
    const rodadaAtual = rodadaStatus?.rodada ?? 0;
    const subsUsadas = aoVivo ? await getSubsUsadas(rodadaAtual, chave) : 0;

    const atletas: AtletaElenco[] = Object.values(elenco.jogadores)
      .filter((j) =>
        j.escalacao === "Sim" || j.escalacao === "Banco" ||
        j.escalacao === "Não"
      )
      .map((j) => ({
        atleta_id: j.atleta_id,
        apelido: j.apelido_api,
        clube: j.clube,
        posicao: j.posicao as AtletaElenco["posicao"],
        escalacao: j.escalacao as "Sim" | "Banco" | "Não",
        pontos: j.pontos,
        foto: fotos[String(j.atleta_id)] ?? fotoUrl(j.apelido_api) ?? null,
        statusId: j.status_id,
      }));

    const meta = CHAVES_TIMES[chave];
    const visual = timeLigaInfo(chave);

    // Lista crua pro painel de transferência (todos os jogadores do
    // elenco, com clube original pra exibir).
    const jogadoresParaTransferir: JogadorParaTransferir[] = Object.values(
      elenco.jogadores,
    )
      .map((j) => ({
        atleta_id: j.atleta_id,
        apelido: j.apelido_api,
        clube: j.clube,
        posicao: j.posicao,
        escalacao: j.escalacao as "Sim" | "Banco" | "Não",
      }));

    const outrosTimes: TimeDestino[] = TODAS_CHAVES
      .filter((c) => c !== chave)
      .map((c) => {
        const v = timeLigaInfo(c);
        const m = CHAVES_TIMES[c];
        return { chave: c, displayName: v?.displayName ?? m?.nome_time ?? c };
      });

    return ctx.render({
      chave,
      displayName: visual?.displayName ?? meta?.nome_time ?? chave,
      dono: meta?.dono ?? "",
      accent: visual?.accent ?? "#888",
      atletas,
      jogadoresParaTransferir,
      outrosTimes,
      aoVivo,
      subsUsadas,
      subsMax: MAX_SUBS_AO_VIVO,
      aVendaIds,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function AdminTimeEditor({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Admin · {data.displayName}</title>
        <link rel="stylesheet" href="/bf-styles.css?v=167" />
      </Head>
      <div class="bf-viewport">
        <TopBar
          userEmail={data.userEmail}
          userRole={data.userRole}
          userNome={data.userNome}
          userPicture={data.userPicture}
        />

        <article class="bf-card bf-status-card">
          <div class="bf-status-card__top">
            <div class="bf-status-card__name">
              <h3>{data.displayName}</h3>
              <span class="bf-status-card__sub">{data.dono}</span>
            </div>
            <a
              href="/admin/times"
              class="bf-btn bf-btn--ghost"
              style="height:32px;font-size:11px;padding:0 12px"
            >
              ← outros times
            </a>
          </div>
          <p class="bf-status-card__sub" style="margin-top:8px">
            Modo admin — edição habilitada mesmo com mercado fechado/rodada
            ativa. Use com cuidado: mudanças durante o live podem afetar a
            pontuação parcial.
          </p>
        </article>

        <SectionHeader>Escalacao</SectionHeader>
        <MeuTimeEditor
          chave={data.chave}
          atletas={data.atletas}
          accent={data.accent}
          aoVivo={data.aoVivo}
          subsUsadasInicial={data.subsUsadas}
          subsMax={data.subsMax}
          showPoints={data.aoVivo}
          /* Admin entra direto em edit mode pra não precisar clicar. */
          editandoInicial={true}
          /* Admin contorna o bloqueio de edição (mercado fechado etc). */
          edicaoBloqueada={false}
          aVendaIds={data.aVendaIds}
        />

        <SectionHeader>Transferir pra outro time</SectionHeader>
        <AdminTransferirPanel
          fromChave={data.chave}
          jogadores={data.jogadoresParaTransferir}
          outrosTimes={data.outrosTimes}
        />
      </div>
    </>
  );
}
