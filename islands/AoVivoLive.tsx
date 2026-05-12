import { useEffect, useState } from "preact/hooks";
import SectionHeader from "../components/SectionHeader.tsx";
import Pill from "../components/Pill.tsx";
import TeamCrest from "../components/TeamCrest.tsx";
import Field, {
  type BancoPino,
  type Escalacao,
  type Pino,
} from "../components/Field.tsx";
import Partidas from "../components/Partidas.tsx";
import { coresClube } from "../lib/cores.ts";
import { escudoUrl } from "../lib/escudos.ts";
import { eventos, type EventoScout } from "../lib/scout.ts";

/** Atleta base — dados estáticos do KV (vêm SSR). */
export interface AtletaBase {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante";
  escudo: string | null;
  foto: string | null;
}

interface Props {
  /** Time do usuário pro hero */
  chave: string;
  displayName: string;
  accent: string;
  /** Escalados (titulares após substituição automática) */
  escalados: AtletaBase[];
  /** Banco: reservas que não entraram nos titulares */
  banco: AtletaBase[];
}

const POS_ABREV: Record<string, string> = {
  Goleiro: "GOL",
  Lateral: "LAT",
  Zagueiro: "ZAG",
  Meia: "MEI",
  Atacante: "ATK",
};

interface PontuadoLive {
  pontuacao?: number;
  scout?: Record<string, number>;
  entrou_em_campo?: boolean;
}

interface CartolaPontuadosResp {
  rodada_id?: number;
  atletas?: Record<string, PontuadoLive>;
}

interface CartolaMercadoResp {
  status_mercado?: number;
  rodada_atual?: number;
  bola_rolando?: boolean;
}

interface CartolaPartidasResp {
  partidas?: Array<{
    partida_id: number;
    clube_casa_id: number;
    clube_visitante_id: number;
    partida_data: string;
    timestamp: number;
    placar_oficial_mandante: number | null;
    placar_oficial_visitante: number | null;
    local: string;
    status_transmissao_tr: string;
    valida: boolean;
  }>;
  clubes?: Record<string, {
    abreviacao: string;
    nome?: string;
    nome_fantasia?: string;
    escudos?: Record<string, string>;
  }>;
}

const POLL_MS = 30_000;

export default function AoVivoLive(
  { chave, displayName, accent, escalados, banco }: Props,
) {
  const [pontuados, setPontuados] = useState<CartolaPontuadosResp | null>(null);
  const [mercado, setMercado] = useState<CartolaMercadoResp | null>(null);
  const [partidas, setPartidas] = useState<CartolaPartidasResp | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function refetch() {
    try {
      console.log("[ao-vivo] fetching cartola...");
      // Proxy via /api/live/* (Deno cacheia 30s, evita problema de
      // mixed-content/CORS no browser do celular)
      const [pResp, mResp, pdResp] = await Promise.all([
        fetch("/api/live/atletas/pontuados").then((r) => {
          if (!r.ok) throw new Error(`pontuados ${r.status}`);
          return r.json();
        }),
        fetch("/api/live/mercado/status").then((r) => {
          if (!r.ok) throw new Error(`mercado/status ${r.status}`);
          return r.json();
        }),
        fetch("/api/live/partidas").then((r) => {
          if (!r.ok) throw new Error(`partidas ${r.status}`);
          return r.json();
        }),
      ]);
      console.log(
        "[ao-vivo] got",
        Object.keys(pResp?.atletas ?? {}).length,
        "atletas",
      );
      setPontuados(pResp);
      setMercado(mResp);
      setPartidas(pdResp);
      setAtualizadoEm(new Date());
      setErro(null);
    } catch (e) {
      console.error("[ao-vivo] fetch error:", e);
      setErro(String(e));
    }
  }

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Computa pontos + scout por atleta a partir do payload da API
  const jogadores = escalados.map((j) => {
    const liveData = pontuados?.atletas?.[String(j.atleta_id)];
    return {
      ...j,
      pontos: liveData?.pontuacao ?? 0,
      events: eventos(liveData?.scout),
      entrouEmCampo: !!liveData?.entrou_em_campo,
    };
  });

  const totalParcial =
    Math.round(jogadores.reduce((s, j) => s + j.pontos, 0) * 100) / 100;

  const ptsFmt = totalParcial.toFixed(1).replace(".", ",");
  const isLive = !!mercado?.bola_rolando;
  const rodada = mercado?.rodada_atual ?? pontuados?.rodada_id ?? 0;
  const carregando = !pontuados && !erro;

  // Monta escalação no formato do Field
  const pino = (j: typeof jogadores[number]): Pino => ({
    nome: j.apelido,
    pts: j.pontos,
    escudo: j.escudo,
    cores: coresClube(j.clube),
    pos: POS_ABREV[j.posicao],
    foto: j.foto,
  });
  const gk = jogadores.find((j) => j.posicao === "Goleiro");
  const def = jogadores.filter((j) =>
    j.posicao === "Zagueiro" || j.posicao === "Lateral"
  );
  const mid = jogadores.filter((j) => j.posicao === "Meia");
  const ata = jogadores.filter((j) => j.posicao === "Atacante");
  const escalacao: Escalacao = {
    gk: gk ? pino(gk) : {},
    def: def.map(pino),
    mid: mid.map(pino),
    ata: ata.map(pino),
  };

  const bancoPinos: BancoPino[] = banco.map((j) => {
    const live = pontuados?.atletas?.[String(j.atleta_id)];
    return {
      nome: j.apelido,
      pts: live?.pontuacao ?? null,
      escudo: j.escudo,
      cores: coresClube(j.clube),
      pos: POS_ABREV[j.posicao],
      posicao: j.posicao,
      foto: j.foto,
      entrouEmCampo: !!live?.entrou_em_campo,
    };
  });

  const comEventos = jogadores
    .map((j) => ({ ...j, events: j.events.filter((e) => e.info.chave) }))
    .filter((j) => j.events.length > 0)
    .sort((a, b) => b.pontos - a.pontos);

  // Sobrescreve escudos das partidas pra usar os locais
  const clubesPartidas: CartolaPartidasResp["clubes"] = {};
  for (const [id, c] of Object.entries(partidas?.clubes ?? {})) {
    const nome = c.nome_fantasia ?? c.nome ?? "";
    const url = escudoUrl(nome);
    clubesPartidas![id] = url
      ? { ...c, escudos: { ...(c.escudos ?? {}), "30x30": url } }
      : c;
  }

  return (
    <>
      <div class="bf-aovivo-hero">
        {isLive
          ? <Pill variant="lime" live>Ao Vivo · Rodada {rodada}</Pill>
          : <Pill>Aguardando · Rodada {rodada}</Pill>}
        <div class="bf-aovivo-hero__total">
          <span class="bf-label-micro">Sua parcial</span>
          <span class="bf-aovivo-hero__total-value">
            {carregando ? "—" : ptsFmt}
          </span>
          <span class="bf-aovivo-hero__total-foot">
            {erro
              ? `erro: ${erro}`
              : atualizadoEm
              ? `atualizado às ${
                atualizadoEm.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              }`
              : "carregando…"}
          </span>
        </div>
        <div class="bf-aovivo-hero__team">
          <TeamCrest chave={chave} size={28} />
          <span>{displayName}</span>
        </div>
      </div>

      <SectionHeader>Campo</SectionHeader>
      <Field jogadores={escalacao} showPoints accent={accent} banco={bancoPinos} />

      <SectionHeader>Eventos da rodada</SectionHeader>
      {comEventos.length === 0
        ? (
          <div class="bf-empty-state">
            {carregando
              ? "Carregando…"
              : isLive
              ? "Aguardando eventos…"
              : "Sem eventos na rodada"}
          </div>
        )
        : (
          <div class="bf-events">
            {comEventos.map((j) => (
              <article class="bf-event-row" key={j.atleta_id}>
                {j.foto && (
                  <img class="bf-event-row__face" src={j.foto} alt="" />
                )}
                <div class="bf-event-row__meta">
                  <div class="bf-event-row__name">
                    {j.escudo && (
                      <img
                        class="bf-event-row__escudo"
                        src={j.escudo}
                        alt=""
                      />
                    )}
                    {j.apelido}
                  </div>
                  <div class="bf-event-row__chips">
                    {j.events.slice(0, 6).map((e: EventoScout) => (
                      <span
                        class={`bf-event-chip bf-event-chip--${e.info.tipo}`}
                        key={e.codigo}
                        title={e.info.label}
                      >
                        <span class="bf-event-chip__icon">{e.info.icon}</span>
                        {e.qtd > 1 && (
                          <span class="bf-event-chip__qtd">{e.qtd}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                <div class="bf-event-row__pts">
                  <span
                    class={`bf-event-row__pts-value ${
                      j.pontos < 0 ? "bf-event-row__pts-value--neg" : ""
                    }`}
                  >
                    {j.pontos > 0 ? "+" : ""}
                    {j.pontos.toFixed(1).replace(".", ",")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

      <SectionHeader>Partidas</SectionHeader>
      {partidas?.partidas && partidas.partidas.length > 0
        ? (
          <Partidas
            partidas={partidas.partidas}
            clubes={clubesPartidas ?? {}}
          />
        )
        : (
          <div class="bf-empty-state">
            {carregando ? "Carregando…" : "Sem partidas"}
          </div>
        )}
    </>
  );
}
