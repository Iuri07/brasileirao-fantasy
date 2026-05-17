import { useEffect, useState } from "preact/hooks";
import SectionHeader from "../components/SectionHeader.tsx";
import Partidas from "../components/Partidas.tsx";
import ScoutIcon from "../components/ScoutIcon.tsx";
import { escudoUrl } from "../lib/escudos.ts";
import { eventos, type EventoScout, SCOUT } from "../lib/scout.ts";

/** Metadados estáticos de cada atleta da liga — vêm do SSR. */
export interface AtletaMeta {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
  escudo: string | null;
  foto: string | null;
  /** Nome do dono do time na liga (DOMINGOS, IAN, AGUIAR...) — usado
      como tooltip do escudo do time. */
  dono: string;
  /** Escudo do time da liga (Filhos de Kieza, Botafofo...). */
  donoEscudo: string | null;
}

/** Entrada da timeline — gerada por diff de scouts entre 2 polls. */
interface TimelineEvent {
  ts: Date;
  atletaId: number;
  apelido: string;
  dono: string;
  donoEscudo: string | null;
  escudo: string | null;
  clube: string;
  codigo: string;
  qtd: number;
  info: typeof SCOUT[keyof typeof SCOUT];
}

interface Props {
  /** Todos os atletas escalados/banco de todos os 9 times da liga.
      Usado pra filtrar pontuados (Cartola devolve TODOS os atletas
      da rodada) e pra exibir apelido/escudo/foto nos eventos. */
  ligaAtletas: AtletaMeta[];
}

interface PontuadoLive {
  pontuacao?: number;
  scout?: Record<string, number>;
  entrou_em_campo?: boolean;
}

interface CartolaPontuadosResp {
  atletas?: Record<string, PontuadoLive>;
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

export default function AoVivoEventosPartidas({ ligaAtletas }: Props) {
  const [pontuados, setPontuados] = useState<CartolaPontuadosResp | null>(null);
  const [partidas, setPartidas] = useState<CartolaPartidasResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  /** Expande/colapsa lista de "Eventos da liga" (mostra os primeiros N
      sempre; resto fica oculto até o usuário expandir). */
  const [eventosExpandido, setEventosExpandido] = useState(false);
  /** Toggle entre "ranking dos top scorers" vs "timeline cronológica
      de eventos chave". Default ranking (mais útil pra ver quem tá
      pontuando agora). */
  const [view, setView] = useState<"eventos" | "timeline">("eventos");
  /** Timeline gerada por diff entre polls. Persiste durante a sessão. */
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  // Map atleta_id → metadados pra enrichment dos eventos do server.
  const metaPorId = new Map(ligaAtletas.map((a) => [a.atleta_id, a]));

  async function refetch() {
    try {
      const [pResp, pdResp, evResp] = await Promise.all([
        fetch("/api/live/atletas/pontuados").then((r) => {
          if (!r.ok) throw new Error(`pontuados ${r.status}`);
          return r.json();
        }),
        fetch("/api/live/partidas").then((r) => {
          if (!r.ok) throw new Error(`partidas ${r.status}`);
          return r.json();
        }),
        fetch("/api/eventos-hist").then((r) => {
          if (!r.ok) throw new Error(`eventos-hist ${r.status}`);
          return r.json();
        }),
      ]);

      // === Timeline vem do server (persistida pelo cron via diff
      // entre snapshots de scout). Sobrevive reload e cobre desde o
      // início da rodada — não só da sessão. ===
      type EvHist = {
        ts: number;
        atletaId: number;
        codigo: string;
        qtd: number;
      };
      const evHist: EvHist[] = evResp?.eventos ?? [];
      const novos: TimelineEvent[] = [];
      for (const e of evHist) {
        const meta = metaPorId.get(e.atletaId);
        if (!meta) continue; // só liga players
        const info = SCOUT[e.codigo];
        if (!info) continue;
        novos.push({
          ts: new Date(e.ts),
          atletaId: e.atletaId,
          apelido: meta.apelido,
          dono: meta.dono,
          donoEscudo: meta.donoEscudo,
          escudo: meta.escudo,
          clube: meta.clube,
          codigo: e.codigo,
          qtd: e.qtd,
          info,
        });
      }
      // Já vem ordenado desc do server (key prefix com -ts), limita
      // por segurança.
      setTimeline(novos.slice(0, 100));

      setPontuados(pResp);
      setPartidas(pdResp);
      setAtualizadoEm(new Date());
      setErro(null);
    } catch (e) {
      setErro(String(e));
    }
  }

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const carregando = !pontuados && !erro;

  // Junta metadata + dados live, filtra só quem teve evento na rodada
  // (scouts não-vazios depois do filtro de chave conhecida).
  const eventosLiga = ligaAtletas
    .map((a) => {
      const live = pontuados?.atletas?.[String(a.atleta_id)];
      const evs = eventos(live?.scout).filter((e) => e.info.chave);
      return { ...a, pontos: live?.pontuacao ?? 0, events: evs };
    })
    .filter((j) => j.events.length > 0)
    .sort((a, b) => b.pontos - a.pontos);

  // Sobrescreve escudos das partidas pra usar os locais (jsDelivr)
  // em vez dos placeholders coloridos da Cartola.
  const clubesPartidas: CartolaPartidasResp["clubes"] = {};
  for (const [id, c] of Object.entries(partidas?.clubes ?? {})) {
    const nome = c.nome_fantasia ?? c.nome ?? "";
    const url = escudoUrl(nome);
    clubesPartidas![id] = url
      ? { ...c, escudos: { ...(c.escudos ?? {}), "30x30": url } }
      : c;
  }

  const atualizadoTxt = atualizadoEm
    ? atualizadoEm.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    : null;

  return (
    <>
      <SectionHeader
        right={atualizadoTxt && (
          <span class="bf-meta-text">atualizado às {atualizadoTxt}</span>
        )}
      >
        Eventos da liga
      </SectionHeader>

      {/* Toggle entre Top scorers (default) e Timeline cronológica. */}
      <div class="bf-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "eventos"}
          class={`bf-tabs__btn ${
            view === "eventos" ? "bf-tabs__btn--active" : ""
          }`}
          onClick={() => setView("eventos")}
        >
          Top scorers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "timeline"}
          class={`bf-tabs__btn ${
            view === "timeline" ? "bf-tabs__btn--active" : ""
          }`}
          onClick={() => setView("timeline")}
        >
          Timeline{timeline.length > 0 && (
            <span class="bf-tabs__badge">{timeline.length}</span>
          )}
        </button>
      </div>

      {view === "timeline" && (
        timeline.length === 0
          ? (
            <div class="bf-empty-state">
              {carregando
                ? "Carregando…"
                : "Sem eventos chave nesta rodada ainda. A timeline lista gols, cartões, defesas e outros lances importantes assim que detectados (~5min de atraso do real)."}
            </div>
          )
          : (
            <div class="bf-timeline">
              {timeline.map((e, i) => {
                const hora = e.ts.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                });
                return (
                  <div
                    class={`bf-timeline__row bf-timeline__row--${e.info.tipo}`}
                    key={`${e.atletaId}-${e.codigo}-${e.ts.getTime()}-${i}`}
                  >
                    <span class="bf-timeline__time">{hora}</span>
                    <span class="bf-timeline__icon">
                      <ScoutIcon codigo={e.codigo} size={16} />
                    </span>
                    <span class="bf-timeline__name">
                      {e.escudo && (
                        <img
                          class="bf-event-row__escudo"
                          src={e.escudo}
                          alt=""
                        />
                      )}
                      {e.apelido}
                      {e.donoEscudo
                        ? (
                          <img
                            class="bf-event-row__dono-escudo"
                            src={e.donoEscudo}
                            alt={e.dono}
                            title={e.dono}
                          />
                        )
                        : <span class="bf-event-row__dono">{e.dono}</span>}
                    </span>
                    <span class="bf-timeline__label">
                      {e.info.label}
                      {e.qtd > 1 && <span>×{e.qtd}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )
      )}

      {view === "eventos" && (() => {
        if (eventosLiga.length === 0) {
          return (
            <div class="bf-empty-state">
              {carregando
                ? "Carregando…"
                : erro
                ? `erro: ${erro}`
                : "Aguardando eventos…"}
            </div>
          );
        }
        const LIMIT = 5;
        const podeExpandir = eventosLiga.length > LIMIT;
        const visiveis = podeExpandir
          ? eventosLiga.slice(0, LIMIT)
          : eventosLiga;
        const extras = podeExpandir ? eventosLiga.slice(LIMIT) : [];
        const renderRow = (j: typeof eventosLiga[number]) => (
          <article class="bf-event-row" key={j.atleta_id}>
            {j.foto && <img class="bf-event-row__face" src={j.foto} alt="" />}
            <div class="bf-event-row__meta">
              <div class="bf-event-row__name">
                {j.escudo && (
                  <img class="bf-event-row__escudo" src={j.escudo} alt="" />
                )}
                {j.apelido}
                {j.donoEscudo
                  ? (
                    <img
                      class="bf-event-row__dono-escudo"
                      src={j.donoEscudo}
                      alt={j.dono}
                      title={j.dono}
                    />
                  )
                  : <span class="bf-event-row__dono">{j.dono}</span>}
              </div>
              <div class="bf-event-row__chips">
                {j.events.slice(0, 6).map((e: EventoScout) => (
                  <span
                    class={`bf-event-chip bf-event-chip--${e.info.tipo}`}
                    key={e.codigo}
                    title={e.info.label}
                  >
                    <span class="bf-event-chip__icon">
                      <ScoutIcon codigo={e.codigo} size={12} />
                    </span>
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
        );
        return (
          <>
            <div class="bf-events">{visiveis.map(renderRow)}</div>
            {extras.length > 0 && (
              <div
                class={`bf-partidas-expand ${
                  eventosExpandido ? "bf-partidas-expand--open" : ""
                }`}
                aria-hidden={!eventosExpandido}
              >
                <div class="bf-partidas-expand__inner">
                  <div class="bf-events">{extras.map(renderRow)}</div>
                </div>
              </div>
            )}
            {podeExpandir && (
              <div class="bf-section-footer">
                <button
                  type="button"
                  class="bf-section-footer__chev"
                  onClick={() => setEventosExpandido(!eventosExpandido)}
                  aria-label={eventosExpandido
                    ? "Ver menos"
                    : `Ver todos (${eventosLiga.length})`}
                  title={eventosExpandido
                    ? "Ver menos"
                    : `Ver todos (${eventosLiga.length})`}
                  aria-expanded={eventosExpandido}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class={`bf-section-footer__chev-icon ${
                      eventosExpandido ? "bf-section-footer__chev-icon--up" : ""
                    }`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            )}
          </>
        );
      })()}

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
