import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { CHAVES_TIMES, getAllElencos, getAVendaGlobal } from "../../lib/kv.ts";
import { listarTodasOfertas, type Oferta } from "../../lib/ofertas.ts";
import { timeLigaInfo } from "../../lib/times-liga.ts";
import TopBar from "../../components/TopBar.tsx";
import SectionHeader from "../../components/SectionHeader.tsx";
import AdminOfertasPanel, {
  type AVendaItem,
  type OfertaItem,
} from "../../islands/AdminOfertasPanel.tsx";
import type { State } from "../_middleware.ts";

interface Data {
  aVenda: AVendaItem[];
  ofertas: OfertaItem[];
  userEmail: string | null;
  userRole: "admin" | "user" | null;
  userNome: string | null;
  userPicture: string | null;
}

function nomeTime(chave: string): string {
  const v = timeLigaInfo(chave);
  const m = CHAVES_TIMES[chave];
  return v?.displayName ?? m?.nome_time ?? chave;
}

export const handler: Handlers<Data, State> = {
  async GET(_req, ctx) {
    const [elencos, aVendaGlobal, ofertas] = await Promise.all([
      getAllElencos(),
      getAVendaGlobal(),
      listarTodasOfertas({ status: "pendente" }),
    ]);

    // Lookup atleta_id → { apelido, clube } em qualquer elenco
    const apelidoPorId = new Map<number, { apelido: string; clube: string }>();
    for (const elenco of Object.values(elencos)) {
      for (const j of Object.values(elenco.jogadores)) {
        apelidoPorId.set(j.atleta_id, {
          apelido: j.apelido_api,
          clube: j.clube,
        });
      }
    }
    const lookup = (id: number) =>
      apelidoPorId.get(id) ?? { apelido: `#${id}`, clube: "?" };

    const aVenda: AVendaItem[] = Object.entries(aVendaGlobal).map(
      ([atletaIdStr, chave]) => {
        const atletaId = Number(atletaIdStr);
        const info = lookup(atletaId);
        return {
          atleta_id: atletaId,
          apelido: info.apelido,
          clube: info.clube,
          chave,
          nomeTime: nomeTime(chave),
        };
      },
    );

    const ofertasItens: OfertaItem[] = ofertas.map((o: Oferta) => {
      // Compat: ofertas pré-multi têm só `atletaOferecido`. As novas
      // usam `atletasOferecidos: number[]`. Resolve via helper.
      const ofereciodosIds = o.atletasOferecidos && o.atletasOferecidos.length
        ? o.atletasOferecidos
        : o.atletaOferecido
        ? [o.atletaOferecido]
        : [];
      const pedido = lookup(o.atletaPedido);
      return {
        id: o.id,
        criadoEm: o.criadoEm,
        deChave: o.deChave,
        deNomeTime: nomeTime(o.deChave),
        paraChave: o.paraChave,
        paraNomeTime: nomeTime(o.paraChave),
        atletasOferecidosApelidos: ofereciodosIds.map((id) =>
          lookup(id).apelido
        ),
        atletaPedidoId: o.atletaPedido,
        atletaPedidoApelido: pedido.apelido,
        mensagem: o.mensagem,
      };
    });

    return ctx.render({
      aVenda,
      ofertas: ofertasItens,
      userEmail: ctx.state.session?.email ?? null,
      userRole: ctx.state.session?.role ?? null,
      userNome: ctx.state.session?.name ?? null,
      userPicture: ctx.state.session?.picture ?? null,
    });
  },
};

export default function AdminOfertasPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Admin · Negociáveis e Ofertas</title>
        <link rel="stylesheet" href="/bf-styles.css?v=153" />
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
              <h3>Negociáveis e Ofertas</h3>
              <span class="bf-status-card__sub">Admin</span>
            </div>
            <a
              href="/admin"
              class="bf-btn bf-btn--ghost"
              style="height:32px;font-size:11px;padding:0 12px"
            >
              ← admin
            </a>
          </div>
          <p class="bf-status-card__sub" style="margin-top:8px">
            Tire jogadores dos negociáveis ou cancele ofertas pendentes. Útil
            quando alguém colocou por engano ou esqueceu de cancelar.
          </p>
        </article>

        <AdminOfertasPanel aVenda={data.aVenda} ofertas={data.ofertas} />
      </div>
    </>
  );
}
