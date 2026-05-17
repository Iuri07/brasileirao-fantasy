import { useEffect, useRef, useState } from "preact/hooks";
import SectionHeader from "../components/SectionHeader.tsx";
import Partidas from "../components/Partidas.tsx";
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
  /** Nome do dono do time na liga (DOMINGOS, IAN, AGUIAR...). */
  dono: string;
}

/** Entrada da timeline — gerada por diff de scouts entre 2 polls. */
interface TimelineEvent {
  ts: Date;
  atletaId: number;
  apelido: string;
  dono: string;
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
  /** Timeline gerada por diff entre polls. Persiste durante a sessão. */
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  /** Snapshot do último scout por atleta — pra computar diff no próximo poll.
      useRef pra não disparar re-render quando atualiza. */
  const prevScoutsRef = useRef<
    Record<string, Record<string, number>>
  >({});
  /** True na primeira execução — não loga eventos no boot (eles já existiam). */
  const isFirstFetchRef = useRef(true);

  // Map atleta_id → metadados pra olhar no diff sem refazer Array.find.
  const metaPorId = new Map(ligaAtletas.map((a) => [a.atleta_id, a]));

  async function refetch() {
    try {
      const [pResp, pdResp] = await Promise.all([
        fetch("/api/live/atletas/pontuados").then((r) => {
          if (!r.ok) throw new Error(`pontuados ${r.status}`);
          return r.json();
        }),
        fetch("/api/live/partidas").then((r) => {
          if (!r.ok) throw new Error(`partidas ${r.status}`);
          return r.json();
        }),
      ]);

      // === Diff de scouts pra alimentar a timeline ===
      // Só gera eventos a partir do 2º poll — o primeiro estabelece a
      // baseline (todos os pontos já marcados antes do user abrir a tela).
      const novosScouts: Record<string, Record<string, number>> = {};
      const curr = (pResp as CartolaPontuadosResp)?.atletas ?? {};
      const novosEventos: TimelineEvent[] = [];
      const agora = new Date();
      for (const [id, p] of Object.entries(curr)) {
        const scout = p?.scout ?? {};
        novosScouts[id] = scout;
        const atletaId = Number(id);
        const meta = metaPorId.get(atletaId);
        if (!meta) continue; // só liga players
        if (isFirstFetchRef.current) continue; // skip boot
        const prev = prevScoutsRef.current[id] ?? {};
        for (const [codigo, qtd] of Object.entries(scout)) {
          const prevQtd = prev[codigo] ?? 0;
          const diff = qtd - prevQtd;
          if (diff <= 0) continue;
          const info = SCOUT[codigo];
          // Filtra só eventos "chaves" (gol, cartão, defesa difícil, etc.)
          if (!info?.chave) continue;
          novosEventos.push({
            ts: agora,
            atletaId,
            apelido: meta.apelido,
            dono: meta.dono,
            escudo: meta.escudo,
            clube: meta.clube,
            codigo,
            qtd: diff,
            info,
          });
        }
      }
      prevScoutsRef.current = novosScouts;
      isFirstFetchRef.current = false;

      if (novosEventos.length > 0) {
        // Prepend (mais recentes primeiro) e limita a 50 entradas
        setTimeline((prev) => [...novosEventos, ...prev].slice(0, 50));
      }

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
      {
        /* Timeline — eventos detectados via diff entre polls. Aparece
          quando há pelo menos 1 evento desde que a tela abriu. */
      }
      {timeline.length > 0 && (
        <>
          <SectionHeader>Timeline</SectionHeader>
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
                  <span class="bf-timeline__icon">{e.info.icon}</span>
                  <span class="bf-timeline__name">
                    {e.escudo && (
                      <img
                        class="bf-event-row__escudo"
                        src={e.escudo}
                        alt=""
                      />
                    )}
                    {e.apelido}
                    <span class="bf-event-row__dono">{e.dono}</span>
                  </span>
                  <span class="bf-timeline__label">
                    {e.info.label}
                    {e.qtd > 1 && <span>×{e.qtd}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionHeader
        right={atualizadoTxt && (
          <span class="bf-meta-text">atualizado às {atualizadoTxt}</span>
        )}
      >
        Eventos da liga
      </SectionHeader>
      {eventosLiga.length === 0
        ? (
          <div class="bf-empty-state">
            {carregando
              ? "Carregando…"
              : erro
              ? `erro: ${erro}`
              : "Aguardando eventos…"}
          </div>
        )
        : (
          <div class="bf-events">
            {eventosLiga.map((j) => (
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
                    <span class="bf-event-row__dono">{j.dono}</span>
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
