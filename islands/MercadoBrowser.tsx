import { useEffect, useMemo, useState } from "preact/hooks";
import JerseySvg from "../components/JerseySvg.tsx";
import AtletaPontosChart from "../components/AtletaPontosChart.tsx";
import type { CoresClube } from "../lib/cores.ts";
import { escudoUrl } from "../lib/escudos.ts";

export interface AtletaMercado {
  atleta_id: number;
  nome: string;
  posicao: "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante";
  clubeNome: string;
  clubeId: number;
  statusId: number | null;
  foto: string | null;
  /** Cores do clube pra renderizar camisa SVG quando não houver cutout. */
  cores: CoresClube;
  pontosUltima: number | null;
  mediaPontos: number | null;
  /** Se está marcado à venda, qual o time dono. Null se free agent. */
  donoChave: string | null;
  donoTime: string | null;
  /** Times que demonstraram interesse (chaves) — só pra free agents */
  interessados: string[];
  /** atleta_id que EU ofereci (se já marquei interesse). null caso contrário. */
  meuOferecido?: number | null;
}

export interface AtletaMeuTime extends AtletaMercado {
  aVenda: boolean;
}

export interface DraftEntry {
  chave: string;
  nome: string;
}

export interface MeuInteresse {
  atleta_id: number;
  nome: string;
  posicao: "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante";
  clubeNome: string;
  foto: string | null;
  cores: CoresClube;
  statusId: number | null;
  oferecidoId: number;
  oferecidoNome: string;
  totalInteressados: number;
}

export interface DraftMetaProp {
  ciclo: number;
  rodadaCiclo: number;
  rodadaBase: number;
}

interface Props {
  /** Rodada rolando — gating de ações de mutação. */
  aoVivo?: boolean;
  /** Quando true, vem inicial vazio e fetcha /api/mercado/data no mount */
  lazy?: boolean;
  jogadores: AtletaMercado[];
  /** Chave do meu time (pra saber se já estou interessado) */
  minhaChave?: string | null;
  /** Todos os 26 fixos do meu elenco — pra aba "Meu time" */
  meuElenco?: AtletaMeuTime[];
  /** Quantos jogadores meus estão à venda */
  qtdAVenda?: number;
  /** Posição do meu time no draft (1-based) */
  posicaoDraft?: number | null;
  /** Ordem do draft pra abrir num menu */
  draftOrdem?: DraftEntry[];
  /** Estado do ciclo: ciclo + rodadaCiclo + rodadaBase */
  draftMeta?: DraftMetaProp | null;
  /** Meus interesses em ordem de prioridade (top = primeiro). */
  meusInteresses?: MeuInteresse[];
  /** Admin sem chave própria — habilita dropdown de "visualizar como X". */
  isAdmin?: boolean;
  /** Lista de times disponíveis pro admin escolher (ignorado se !isAdmin). */
  timesDisponiveis?: Array<{ chave: string; nome: string }>;
}

const STATUS_LABEL: Record<number, { sym: string; cor: string; txt: string }> =
  {
    7: { sym: "✓", cor: "var(--bf-lime)", txt: "Provável" },
    2: { sym: "?", cor: "var(--bf-yellow)", txt: "Dúvida" },
    3: { sym: "✕", cor: "var(--bf-red)", txt: "Suspenso" },
    5: { sym: "✚", cor: "var(--bf-red)", txt: "Contundido" },
    6: { sym: "−", cor: "var(--bf-fg-3)", txt: "Nulo" },
  };

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function MercadoBrowser(
  {
    aoVivo = false,
    lazy = false,
    jogadores: inicial,
    minhaChave: minhaChaveProp = null,
    meuElenco = [],
    qtdAVenda: _qtdAVendaInicial = 0,
    posicaoDraft = null,
    draftOrdem = [],
    draftMeta = null,
    meusInteresses = [],
    isAdmin = false,
    timesDisponiveis = [],
  }: Props,
) {
  const [jogadores, setJogadores] = useState<AtletaMercado[]>(inicial);
  const [meu, setMeu] = useState<AtletaMeuTime[]>(meuElenco);
  // Admin: chave virtual (sobrescreve sessão) pra simular logar como um time.
  const [adminAsChave, setAdminAsChave] = useState<string | null>(
    isAdmin && !minhaChaveProp && timesDisponiveis.length > 0
      ? timesDisponiveis[0].chave
      : null,
  );
  const minhaChave = adminAsChave ?? minhaChaveProp;
  // Derivado de `meu` — atualiza automaticamente ao pôr/tirar à venda
  const qtdAVenda = useMemo(
    () => meu.filter((j) => j.aVenda).length,
    [meu],
  );
  const [busca, setBusca] = useState("");
  const [posicao, setPosicao] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [clube, setClube] = useState<string>("");
  const [tipo, setTipo] = useState<
    "todos" | "free" | "venda" | "meu" | "minhas-venda"
  >("todos");
  // Confirmação custom (substitui window.confirm pra ficar no estilo)
  const [confirma, setConfirma] = useState<
    { titulo: string; texto: string; onOk: () => void } | null
  >(null);
  const [pendendo, setPendendo] = useState<number | null>(null);
  const [draftAberto, setDraftAberto] = useState(false);
  const [interesses, setInteresses] = useState<MeuInteresse[]>(meusInteresses);
  const [interessesAberto, setInteressesAberto] = useState(false);
  const [carregando, setCarregando] = useState(lazy);
  /** Atleta cujos detalhes estão abertos no modal. */
  const [detalhes, setDetalhes] = useState<AtletaMercado | null>(null);

  // Lazy load: SSR mandou shell vazio; busca dados pesados na hidratação.
  // Refetcha quando admin troca o time visualizado (asChave query param).
  useEffect(() => {
    if (!lazy && !adminAsChave) return;
    let cancelado = false;
    setCarregando(true);
    (async () => {
      try {
        const url = adminAsChave
          ? `/api/mercado/data?asChave=${adminAsChave}`
          : "/api/mercado/data";
        const r = await fetch(url);
        const d = await r.json();
        if (cancelado) return;
        setJogadores(d.jogadores ?? []);
        setMeu(d.meuElenco ?? []);
        setInteresses(d.meusInteresses ?? []);
      } catch {
        // mantém vazio em caso de erro
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [lazy, adminAsChave]);

  // Modal único — distingue por modo:
  // - "oferta": trade entre times (precisa enviar pra dono)
  // - "interesse": oferecer jogador pelo free agent
  const [modal, setModal] = useState<
    | { modo: "oferta"; pedido: AtletaMercado }
    | { modo: "interesse"; pedido: AtletaMercado }
    | null
  >(null);

  // Trava scroll do body quando qualquer modal está aberto — senão o
  // background rola junto e o bottom-nav (position: fixed) salta.
  useEffect(() => {
    const anyOpen = draftAberto || interessesAberto || !!confirma || !!modal;
    if (typeof document === "undefined") return;
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [draftAberto, interessesAberto, confirma, modal]);

  async function enviarOferta(
    pedido: AtletaMercado,
    oferecidos: AtletaMeuTime[],
  ): Promise<{ ok: boolean; erro?: string }> {
    try {
      const r = await fetch("/api/ofertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atleta_pedido: pedido.atleta_id,
          atletas_oferecidos: oferecidos.map((j) => j.atleta_id),
        }),
      });
      const d = await r.json();
      return d;
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  }

  async function registrarInteresse(
    pedido: AtletaMercado,
    oferecido: AtletaMeuTime,
  ): Promise<{ ok: boolean; erro?: string }> {
    if (!minhaChave) return { ok: false, erro: "Sem time" };
    try {
      const r = await fetch(`/api/atleta/${pedido.atleta_id}/interesse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atleta_oferecido: oferecido.atleta_id }),
      });
      const d = await r.json();
      if (d.ok) {
        // Atualiza otimisticamente
        setJogadores((arr) =>
          arr.map((x) =>
            x.atleta_id === pedido.atleta_id
              ? {
                ...x,
                interessados: x.interessados.includes(minhaChave)
                  ? x.interessados
                  : [...x.interessados, minhaChave],
                meuOferecido: oferecido.atleta_id,
              }
              : x
          )
        );
        // Append na lista local de interesses (no fim = menor prioridade)
        setInteresses((arr) => {
          if (arr.some((m) => m.atleta_id === pedido.atleta_id)) {
            // Atualiza oferecido se já existe
            return arr.map((m) =>
              m.atleta_id === pedido.atleta_id
                ? {
                  ...m,
                  oferecidoId: oferecido.atleta_id,
                  oferecidoNome: oferecido.nome,
                }
                : m
            );
          }
          return [
            ...arr,
            {
              atleta_id: pedido.atleta_id,
              nome: pedido.nome,
              posicao: pedido.posicao,
              clubeNome: pedido.clubeNome,
              foto: pedido.foto,
              cores: pedido.cores,
              statusId: pedido.statusId,
              oferecidoId: oferecido.atleta_id,
              oferecidoNome: oferecido.nome,
              totalInteressados: pedido.interessados.length + 1,
            },
          ];
        });
      }
      return d;
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  }

  async function removerInteresse(atletaId: number) {
    if (!minhaChave) return;
    setPendendo(atletaId);
    const alvo = jogadores.find((x) => x.atleta_id === atletaId);
    const prevInter = alvo?.interessados;
    const prevOf = alvo?.meuOferecido;
    const prevInteresses = interesses;
    setJogadores((arr) =>
      arr.map((x) =>
        x.atleta_id === atletaId
          ? {
            ...x,
            interessados: x.interessados.filter((c) => c !== minhaChave),
            meuOferecido: null,
          }
          : x
      )
    );
    setInteresses((arr) => arr.filter((m) => m.atleta_id !== atletaId));
    try {
      const r = await fetch(`/api/atleta/${atletaId}/interesse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remover: true }),
      });
      const d = await r.json();
      if (!d.ok) {
        if (prevInter !== undefined) {
          setJogadores((arr) =>
            arr.map((x) =>
              x.atleta_id === atletaId
                ? { ...x, interessados: prevInter, meuOferecido: prevOf }
                : x
            )
          );
        }
        setInteresses(prevInteresses);
      }
    } catch {
      if (prevInter !== undefined) {
        setJogadores((arr) =>
          arr.map((x) =>
            x.atleta_id === atletaId
              ? { ...x, interessados: prevInter, meuOferecido: prevOf }
              : x
          )
        );
      }
      setInteresses(prevInteresses);
    } finally {
      setPendendo(null);
    }
  }

  async function persistirOrdemInteresses(ordem: number[]) {
    try {
      await fetch("/api/me/prioridade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordem }),
      });
    } catch {
      // silencioso — próximo refresh corrige
    }
  }

  function moverInteresse(atletaId: number, dir: -1 | 1) {
    setInteresses((arr) => {
      const idx = arr.findIndex((m) => m.atleta_id === atletaId);
      if (idx < 0) return arr;
      const novoIdx = idx + dir;
      if (novoIdx < 0 || novoIdx >= arr.length) return arr;
      const novo = [...arr];
      [novo[idx], novo[novoIdx]] = [novo[novoIdx], novo[idx]];
      persistirOrdemInteresses(novo.map((m) => m.atleta_id));
      return novo;
    });
  }

  async function toggleAVenda(j: AtletaMeuTime) {
    if (aoVivo) return;
    if (!minhaChave) return;
    setPendendo(j.atleta_id);
    const prev = j.aVenda;
    setMeu((arr) =>
      arr.map((x) => x.atleta_id === j.atleta_id ? { ...x, aVenda: !prev } : x)
    );
    try {
      const r = await fetch(`/api/elenco/${minhaChave}/a-venda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atleta_id: j.atleta_id }),
      });
      const d = await r.json();
      if (!d.ok) {
        setMeu((arr) =>
          arr.map((x) =>
            x.atleta_id === j.atleta_id ? { ...x, aVenda: prev } : x
          )
        );
      }
    } catch {
      setMeu((arr) =>
        arr.map((x) => x.atleta_id === j.atleta_id ? { ...x, aVenda: prev } : x)
      );
    } finally {
      setPendendo(null);
    }
  }

  function abrirInteresse(j: AtletaMercado) {
    if (aoVivo) return;
    if (!minhaChave || j.donoChave) return;
    if (j.interessados.includes(minhaChave)) {
      setConfirma({
        titulo: "Remover interesse?",
        texto:
          "O jogador oferecido é liberado e seu interesse some da fila do draft.",
        onOk: () => removerInteresse(j.atleta_id),
      });
      return;
    }
    setModal({ modo: "interesse", pedido: j });
  }

  const clubesDisponiveis = useMemo(() => {
    const s = new Set<string>();
    for (const j of jogadores) if (j.clubeNome) s.add(j.clubeNome);
    return Array.from(s).sort();
  }, [jogadores]);

  const filtrados = useMemo(() => {
    const buscaNorm = norm(busca.trim());
    const usaMeu = tipo === "meu" || tipo === "minhas-venda";
    const src = usaMeu ? meu : jogadores;
    return src.filter((j) => {
      if (posicao && j.posicao !== posicao) return false;
      if (status && String(j.statusId) !== status) return false;
      if (clube && j.clubeNome !== clube) return false;
      if (tipo === "free" && j.donoChave) return false;
      if (tipo === "venda" && !j.donoChave) return false;
      if (tipo === "minhas-venda" && !(j as AtletaMeuTime).aVenda) return false;
      if (buscaNorm && !norm(j.nome).includes(buscaNorm)) return false;
      return true;
    }).sort((a, b) => (b.mediaPontos ?? 0) - (a.mediaPontos ?? 0));
  }, [jogadores, meu, busca, posicao, status, clube, tipo]);

  return (
    <div class="bf-mercado">
      <div class="bf-mercado__stats">
        <button
          type="button"
          class={`bf-mercado__stat bf-mercado__stat--btn ${
            tipo === "minhas-venda" ? "bf-mercado__stat--ativo" : ""
          }`}
          onClick={() =>
            setTipo(tipo === "minhas-venda" ? "todos" : "minhas-venda")}
          disabled={!minhaChave || qtdAVenda === 0}
          title="Filtrar meus jogadores negociáveis"
        >
          <span class="bf-mercado__stat-val">{qtdAVenda}</span>
          <span class="bf-mercado__stat-lbl">negociáveis</span>
        </button>
        <div class="bf-mercado__stat-div" />
        <button
          type="button"
          class="bf-mercado__stat bf-mercado__stat--btn"
          onClick={() => setInteressesAberto(true)}
          disabled={!minhaChave || interesses.length === 0}
          title="Ver e ordenar interesses"
        >
          <span class="bf-mercado__stat-val">{interesses.length}</span>
          <span class="bf-mercado__stat-lbl">interesses</span>
        </button>
        <div class="bf-mercado__stat-div" />
        <button
          type="button"
          class="bf-mercado__stat bf-mercado__stat--btn"
          onClick={() => setDraftAberto(true)}
          disabled={draftOrdem.length === 0}
          title="Ver ordem do draft"
        >
          <span class="bf-mercado__stat-val">
            {posicaoDraft ? `${posicaoDraft}º` : "—"}
          </span>
          <span class="bf-mercado__stat-lbl">
            {draftMeta ? `draft · r${draftMeta.rodadaCiclo}/5` : "no draft"}
          </span>
        </button>
      </div>

      {draftAberto && draftOrdem.length > 0 && (
        <ModalDraft
          ordem={draftOrdem}
          minhaChave={minhaChave}
          meta={draftMeta}
          onClose={() => setDraftAberto(false)}
        />
      )}

      {interessesAberto && (
        <ModalInteresses
          itens={interesses}
          onClose={() => setInteressesAberto(false)}
          onMover={moverInteresse}
          onPedirRemover={(m) =>
            setConfirma({
              titulo: "Remover interesse?",
              texto:
                `Tira ${m.nome} da fila e libera ${m.oferecidoNome} da oferta.`,
              onOk: () => removerInteresse(m.atleta_id),
            })}
        />
      )}

      {isAdmin && timesDisponiveis.length > 0 && (
        <div class="bf-mercado__admin-as">
          <span class="bf-label-micro">Visualizar como</span>
          <select
            class="bf-mercado__select bf-mercado__admin-as-select"
            value={adminAsChave ?? ""}
            onChange={(e) =>
              setAdminAsChave((e.target as HTMLSelectElement).value || null)}
          >
            {timesDisponiveis.map((t) => (
              <option key={t.chave} value={t.chave}>{t.nome}</option>
            ))}
          </select>
        </div>
      )}

      <div class="bf-mercado__filtros">
        <input
          type="search"
          class="bf-mercado__busca"
          placeholder="Buscar jogador…"
          value={busca}
          onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
        />
        <div class="bf-mercado__chips">
          <Chip ativo={tipo === "todos"} onClick={() => setTipo("todos")}>
            Todos
          </Chip>
          <Chip ativo={tipo === "free"} onClick={() => setTipo("free")}>
            Free agents
          </Chip>
          <Chip ativo={tipo === "venda"} onClick={() => setTipo("venda")}>
            Negociáveis
          </Chip>
          {minhaChave && meu.length > 0 && (
            <Chip
              ativo={tipo === "meu"}
              onClick={() => setTipo("meu")}
            >
              Meu time
            </Chip>
          )}
        </div>
        <div class="bf-mercado__selects">
          <select
            class="bf-mercado__select"
            value={posicao}
            onChange={(e) => setPosicao((e.target as HTMLSelectElement).value)}
          >
            <option value="">Todas posições</option>
            <option value="Goleiro">Goleiro</option>
            <option value="Lateral">Lateral</option>
            <option value="Zagueiro">Zagueiro</option>
            <option value="Meia">Meia</option>
            <option value="Atacante">Atacante</option>
          </select>
          <select
            class="bf-mercado__select"
            value={status}
            onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
          >
            <option value="">Qualquer status</option>
            <option value="7">Provável</option>
            <option value="2">Dúvida</option>
            <option value="3">Suspenso</option>
            <option value="5">Contundido</option>
            <option value="6">Nulo</option>
          </select>
          <select
            class="bf-mercado__select"
            value={clube}
            onChange={(e) => setClube((e.target as HTMLSelectElement).value)}
          >
            <option value="">Todos times</option>
            {clubesDisponiveis.map((c) => <option key={c} value={c}>{c}
            </option>)}
          </select>
        </div>
      </div>

      <div class="bf-mercado__meta">
        {carregando
          ? <span class="bf-mercado__meta-loading">carregando…</span>
          : (
            <>
              <span>{filtrados.length}</span> jogadores
            </>
          )}
      </div>

      <div class="bf-mercado__grid">
        {carregando &&
          Array.from({ length: 12 }).map((_, i) => (
            <div
              key={`skel-${i}`}
              class="bf-merc-card bf-merc-card--skeleton"
              aria-hidden="true"
            />
          ))}
        {!carregando && filtrados.map((j) =>
          tipo === "meu" || tipo === "minhas-venda"
            ? (
              <CardMeu
                key={j.atleta_id}
                j={j as AtletaMeuTime}
                onToggleVenda={toggleAVenda}
                onDetalhes={setDetalhes}
                pendendo={pendendo === j.atleta_id}
                aoVivo={aoVivo}
              />
            )
            : (
              <CardJogador
                key={j.atleta_id}
                j={j}
                minhaChave={minhaChave}
                meuElenco={meu}
                onInteresse={abrirInteresse}
                onOfertar={aoVivo
                  ? undefined
                  : (jj) => setModal({ modo: "oferta", pedido: jj })}
                onDetalhes={setDetalhes}
                pendendo={pendendo === j.atleta_id}
                aoVivo={aoVivo}
              />
            )
        )}
        {!carregando && filtrados.length === 0 && (
          <div class="bf-empty-state">Nenhum jogador encontrado</div>
        )}
      </div>

      {modal && (
        <ModalOferta
          modo={modal.modo}
          pedido={modal.pedido}
          meuElenco={meu}
          onClose={() => setModal(null)}
          onEnviarOferta={enviarOferta}
          onEnviarInteresse={registrarInteresse}
        />
      )}

      {confirma && (
        <ModalConfirma
          titulo={confirma.titulo}
          texto={confirma.texto}
          onCancel={() => setConfirma(null)}
          onOk={() => {
            const fn = confirma.onOk;
            setConfirma(null);
            fn();
          }}
        />
      )}

      {detalhes && (
        <ModalAtletaDetalhes
          base={detalhes}
          onClose={() => setDetalhes(null)}
        />
      )}
    </div>
  );
}

function ModalConfirma(
  { titulo, texto, onCancel, onOk }: {
    titulo: string;
    texto: string;
    onCancel: () => void;
    onOk: () => void;
  },
) {
  return (
    <div class="bf-modal bf-modal--confirm" onClick={onCancel}>
      <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
        <h3 class="bf-modal__titulo">{titulo}</h3>
        <p class="bf-modal__txt">{texto}</p>
        <div class="bf-modal__acoes" style="padding:0 16px 16px">
          <button
            type="button"
            class="bf-modal__btn"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            class="bf-modal__btn bf-modal__btn--danger"
            onClick={onOk}
          >
            Remover
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalOferta(
  { modo, pedido, meuElenco, onClose, onEnviarOferta, onEnviarInteresse }: {
    modo: "oferta" | "interesse";
    pedido: AtletaMercado;
    meuElenco: AtletaMeuTime[];
    onClose: () => void;
    onEnviarOferta: (
      pedido: AtletaMercado,
      oferecidos: AtletaMeuTime[],
    ) => Promise<{ ok: boolean; erro?: string }>;
    onEnviarInteresse: (
      pedido: AtletaMercado,
      oferecido: AtletaMeuTime,
    ) => Promise<{ ok: boolean; erro?: string }>;
  },
) {
  // Modo oferta: até 3 jogadores selecionados (qualquer posição, mas pelo
  // menos 1 da posição do pedido). Modo interesse: 1 só (mesma posição).
  const [selecionados, setSelecionados] = useState<AtletaMeuTime[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<"ok" | string | null>(null);

  const lista = useMemo(() => {
    if (modo === "interesse") {
      // Interesse continua 1:1 com mesma posição
      return meuElenco
        .filter((j) => j.posicao === pedido.posicao)
        .sort((a, b) => (b.mediaPontos ?? 0) - (a.mediaPontos ?? 0));
    }
    // Oferta: todos meus jogadores, ordenados por (mesma posição primeiro, depois média)
    return [...meuElenco].sort((a, b) => {
      const sameA = a.posicao === pedido.posicao ? 1 : 0;
      const sameB = b.posicao === pedido.posicao ? 1 : 0;
      if (sameA !== sameB) return sameB - sameA;
      return (b.mediaPontos ?? 0) - (a.mediaPontos ?? 0);
    });
  }, [meuElenco, pedido, modo]);

  function toggle(j: AtletaMeuTime) {
    if (modo === "interesse") {
      setSelecionados((cur) => cur[0]?.atleta_id === j.atleta_id ? [] : [j]);
      return;
    }
    setSelecionados((cur) => {
      if (cur.some((x) => x.atleta_id === j.atleta_id)) {
        return cur.filter((x) => x.atleta_id !== j.atleta_id);
      }
      if (cur.length >= 3) return cur; // máx 3
      return [...cur, j];
    });
  }

  const temPosDoPedido = selecionados.some((j) => j.posicao === pedido.posicao);
  const podeEnviar = modo === "interesse"
    ? selecionados.length === 1
    : selecionados.length >= 1 && selecionados.length <= 3 && temPosDoPedido;

  async function submit() {
    if (!podeEnviar) return;
    setEnviando(true);
    const r = modo === "interesse"
      ? await onEnviarInteresse(pedido, selecionados[0])
      : await onEnviarOferta(pedido, selecionados);
    setEnviando(false);
    if (r.ok) setFeito("ok");
    else setFeito(r.erro ?? "Erro desconhecido");
  }

  if (feito === "ok") {
    return (
      <div class="bf-modal" onClick={onClose}>
        <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
          <h3 class="bf-modal__titulo">
            {modo === "interesse"
              ? "Interesse registrado ✓"
              : "Oferta enviada ✓"}
          </h3>
          <p class="bf-modal__txt">
            {modo === "interesse"
              ? (
                <>
                  Você ofereceu um jogador por{" "}
                  <strong>{pedido.nome}</strong>. Se mais alguém marcar
                  interesse, vence quem está mais alto no draft.
                </>
              )
              : (
                <>
                  O dono de <strong>{pedido.nome}</strong>{" "}
                  vai receber uma notificação e poderá aceitar ou negar.
                </>
              )}
          </p>
          <button
            type="button"
            class="bf-modal__btn bf-modal__btn--ok"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="bf-modal" onClick={onClose}>
      <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="bf-modal__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
        <h3 class="bf-modal__titulo">
          {modo === "interesse" ? "Tenho interesse em " : "Oferecer troca por "}
          <span style="color:var(--bf-lime)">{pedido.nome}</span>
        </h3>
        <p class="bf-modal__txt">
          {modo === "interesse"
            ? `Ofereça um jogador da mesma posição (${
              pedido.posicao
            }). Se você ganhar o draft, ele entra no seu time e o oferecido vira free agent.`
            : (
              <>
                Selecione <strong>até 3 jogadores</strong>{" "}
                do seu elenco. Pelo menos 1 precisa ser{" "}
                <strong>{pedido.posicao}</strong>{" "}
                (posição do pedido). Se você oferecer 2 ou 3, o destinatário
                escolhe quantos jogadores do próprio elenco vão completar a
                troca.
              </>
            )}
        </p>
        {modo === "oferta" && selecionados.length > 0 && (
          <div class="bf-modal__resumo">
            <span class="bf-modal__resumo-lbl">Selecionados</span>
            <span class="bf-modal__resumo-val">
              {selecionados.length}/3
              {!temPosDoPedido && (
                <span class="bf-modal__resumo-warn">
                  · falta {pedido.posicao}
                </span>
              )}
            </span>
          </div>
        )}
        <div class="bf-modal__lista">
          {lista.length === 0 && (
            <div class="bf-empty-state" style="margin:8px 4px">
              {modo === "interesse"
                ? `Você não tem nenhum ${pedido.posicao} no elenco`
                : "Seu elenco está vazio"}
            </div>
          )}
          {lista.map((j) => {
            const sel = selecionados.some((s) => s.atleta_id === j.atleta_id);
            const posMatch = j.posicao === pedido.posicao;
            return (
              <button
                type="button"
                key={j.atleta_id}
                class={`bf-modal__opt ${sel ? "bf-modal__opt--sel" : ""} ${
                  modo === "oferta" && !sel && selecionados.length >= 3
                    ? "bf-modal__opt--blocked"
                    : ""
                }`}
                onClick={() => toggle(j)}
                disabled={modo === "oferta" && !sel && selecionados.length >= 3}
              >
                <span
                  class={`bf-modal__opt-pos ${
                    posMatch ? "bf-modal__opt-pos--match" : ""
                  }`}
                >
                  {j.posicao}
                </span>
                <span class="bf-modal__opt-nome">{j.nome}</span>
                <span class="bf-modal__opt-clube">{j.clubeNome}</span>
                <span class="bf-modal__opt-media">
                  {j.mediaPontos != null
                    ? j.mediaPontos.toFixed(1).replace(".", ",")
                    : "—"}
                </span>
              </button>
            );
          })}
        </div>
        {feito && feito !== "ok" && <div class="bf-modal__erro">{feito}</div>}
        <div class="bf-modal__acoes">
          <button
            type="button"
            class="bf-modal__btn"
            onClick={onClose}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="button"
            class="bf-modal__btn bf-modal__btn--ok"
            onClick={submit}
            disabled={!podeEnviar || enviando}
          >
            {enviando
              ? "Enviando…"
              : modo === "interesse"
              ? "Confirmar interesse"
              : `Enviar oferta${
                selecionados.length > 1
                  ? ` (${selecionados.length} jogadores)`
                  : ""
              }`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip(
  { ativo, onClick, children }: {
    ativo: boolean;
    onClick: () => void;
    children: preact.ComponentChildren;
  },
) {
  return (
    <button
      type="button"
      class={`bf-mercado__chip ${ativo ? "bf-mercado__chip--ativo" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CardJogador(
  {
    j,
    minhaChave,
    meuElenco,
    onInteresse,
    onOfertar,
    onDetalhes,
    pendendo,
    aoVivo,
  }: {
    j: AtletaMercado;
    minhaChave: string | null;
    meuElenco: AtletaMeuTime[];
    onInteresse: (j: AtletaMercado) => void;
    onOfertar?: (j: AtletaMercado) => void;
    onDetalhes: (j: AtletaMercado) => void;
    pendendo: boolean;
    aoVivo: boolean;
  },
) {
  const nomeOferecido = j.meuOferecido
    ? meuElenco.find((m) => m.atleta_id === j.meuOferecido)?.nome
    : null;
  const hasFoto = !!j.foto;
  const st = j.statusId != null ? STATUS_LABEL[j.statusId] : null;
  const interessado = !!minhaChave && j.interessados.includes(minhaChave);
  const podeInteressar = !!minhaChave && !j.donoChave && !aoVivo;
  const podeOfertar = !!minhaChave && !!j.donoChave &&
    j.donoChave !== minhaChave && !aoVivo;
  const ultima = j.pontosUltima != null
    ? j.pontosUltima.toFixed(1).replace(".", ",")
    : "—";
  const media = j.mediaPontos != null
    ? j.mediaPontos.toFixed(1).replace(".", ",")
    : "—";
  return (
    <article
      class={`bf-merc-card bf-merc-card--${
        j.posicao.toLowerCase()
      } ${hasFoto ? "bf-merc-card--cutout" : "bf-merc-card--jersey"}`}
    >
      <div class="bf-merc-card__foto">
        {hasFoto
          ? <img src={j.foto!} alt="" loading="lazy" />
          : <JerseySvg cores={j.cores} class="bf-merc-card__jersey" />}
      </div>
      <div class="bf-merc-card__top">
        <span class="bf-merc-card__pos">{j.posicao}</span>
        {st && (
          <span
            class="bf-merc-card__status"
            style={{ "--st-color": st.cor } as Record<string, string>}
            title={st.txt}
            aria-label={st.txt}
          >
            {st.sym}
          </span>
        )}
        <button
          type="button"
          class="bf-merc-card__info"
          onClick={(e) => {
            e.stopPropagation();
            onDetalhes(j);
          }}
          aria-label="Ver detalhes"
          title="Ver detalhes"
        >
          ⓘ
        </button>
      </div>
      <div class="bf-merc-card__nome">{j.nome}</div>
      <div class="bf-merc-card__clube">
        {escudoUrl(j.clubeNome) && (
          <img
            class="bf-merc-card__escudo"
            src={escudoUrl(j.clubeNome)!}
            alt=""
            aria-hidden="true"
          />
        )}
        <span>{j.clubeNome}</span>
      </div>
      <div class="bf-merc-card__pts">
        <div class="bf-merc-card__pts-cel">
          <span class="bf-label-micro">Última</span>
          <span class="bf-merc-card__pts-val">{ultima}</span>
        </div>
        <div class="bf-merc-card__pts-cel">
          <span class="bf-label-micro">Média</span>
          <span class="bf-merc-card__pts-val">{media}</span>
        </div>
      </div>
      {j.donoChave
        ? podeOfertar
          ? (
            <button
              type="button"
              class="bf-merc-card__venda bf-merc-card__venda--btn"
              onClick={() => onOfertar?.(j)}
            >
              À venda · {j.donoTime ?? j.donoChave}
            </button>
          )
          : (
            <div class="bf-merc-card__venda">
              À venda · {j.donoTime ?? j.donoChave}
            </div>
          )
        : (
          <button
            type="button"
            class={`bf-merc-card__free ${
              interessado ? "bf-merc-card__free--on" : ""
            }`}
            onClick={() => podeInteressar && onInteresse(j)}
            disabled={!podeInteressar || pendendo}
            title={interessado
              ? `Ofereceu: ${nomeOferecido ?? "?"} — clique pra desistir`
              : "Oferecer jogador em troca dele"}
          >
            {interessado
              ? (
                <>
                  Ofereceu <strong>{nomeOferecido ?? "?"}</strong>
                </>
              )
              : "Tenho interesse"}
            {j.interessados.length > 0 && (
              <span class="bf-merc-card__count">{j.interessados.length}</span>
            )}
          </button>
        )}
    </article>
  );
}

function CardMeu(
  { j, onToggleVenda, onDetalhes, pendendo, aoVivo }: {
    j: AtletaMeuTime;
    onToggleVenda: (j: AtletaMeuTime) => void;
    onDetalhes: (j: AtletaMercado) => void;
    pendendo: boolean;
    aoVivo: boolean;
  },
) {
  const hasFoto = !!j.foto;
  const st = j.statusId != null ? STATUS_LABEL[j.statusId] : null;
  const ultima = j.pontosUltima != null
    ? j.pontosUltima.toFixed(1).replace(".", ",")
    : "—";
  const media = j.mediaPontos != null
    ? j.mediaPontos.toFixed(1).replace(".", ",")
    : "—";
  return (
    <article
      class={`bf-merc-card bf-merc-card--${
        j.posicao.toLowerCase()
      } ${hasFoto ? "bf-merc-card--cutout" : "bf-merc-card--jersey"}`}
    >
      <div class="bf-merc-card__foto">
        {hasFoto
          ? <img src={j.foto!} alt="" loading="lazy" />
          : <JerseySvg cores={j.cores} class="bf-merc-card__jersey" />}
      </div>
      <div class="bf-merc-card__top">
        <span class="bf-merc-card__pos">{j.posicao}</span>
        {st && (
          <span
            class="bf-merc-card__status"
            style={{ "--st-color": st.cor } as Record<string, string>}
            title={st.txt}
            aria-label={st.txt}
          >
            {st.sym}
          </span>
        )}
        <button
          type="button"
          class="bf-merc-card__info"
          onClick={(e) => {
            e.stopPropagation();
            onDetalhes(j);
          }}
          aria-label="Ver detalhes"
          title="Ver detalhes"
        >
          ⓘ
        </button>
      </div>
      <div class="bf-merc-card__nome">{j.nome}</div>
      <div class="bf-merc-card__clube">
        {escudoUrl(j.clubeNome) && (
          <img
            class="bf-merc-card__escudo"
            src={escudoUrl(j.clubeNome)!}
            alt=""
            aria-hidden="true"
          />
        )}
        <span>{j.clubeNome}</span>
      </div>
      <div class="bf-merc-card__pts">
        <div class="bf-merc-card__pts-cel">
          <span class="bf-label-micro">Última</span>
          <span class="bf-merc-card__pts-val">{ultima}</span>
        </div>
        <div class="bf-merc-card__pts-cel">
          <span class="bf-label-micro">Média</span>
          <span class="bf-merc-card__pts-val">{media}</span>
        </div>
      </div>
      <button
        type="button"
        class={`bf-merc-card__venda-btn ${
          j.aVenda ? "bf-merc-card__venda-btn--on" : ""
        }`}
        onClick={() => onToggleVenda(j)}
        disabled={pendendo || aoVivo}
        title={aoVivo
          ? "Mercado fechado"
          : j.aVenda
          ? "Tornar exclusivo"
          : "Tornar negociável"}
      >
        {j.aVenda ? "Negociável ✓" : "Tornar negociável"}
      </button>
    </article>
  );
}

function ModalDraft(
  { ordem, minhaChave, meta, onClose }: {
    ordem: DraftEntry[];
    minhaChave: string | null;
    meta: DraftMetaProp | null;
    onClose: () => void;
  },
) {
  return (
    <div class="bf-modal" onClick={onClose}>
      <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="bf-modal__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
        <h3 class="bf-modal__titulo">Draft</h3>
        <div class="bf-modal__body">
          {meta && (
            <div class="bf-draft__meta">
              <div class="bf-draft__meta-cel">
                <span class="bf-label-micro">Ciclo</span>
                <span class="bf-draft__meta-val">{meta.ciclo}</span>
              </div>
              <div class="bf-draft__meta-cel">
                <span class="bf-label-micro">Rodada do ciclo</span>
                <span class="bf-draft__meta-val">{meta.rodadaCiclo}/5</span>
              </div>
            </div>
          )}
          <ol class="bf-draft__lista">
            {ordem.map((d, i) => (
              <li
                key={d.chave}
                class={d.chave === minhaChave
                  ? "bf-draft__item bf-draft__item--meu"
                  : "bf-draft__item"}
              >
                <span class="bf-draft__pos">{i + 1}º</span>
                <span class="bf-draft__nome">{d.nome}</span>
              </li>
            ))}
          </ol>
          <details class="bf-regras">
            <summary>Como funciona</summary>
            <div class="bf-regras__body">
              <p>
                Ordem inicial = inverso da classificação. Quem não usa o pick
                sobe; quem usa vai pro fim da fila.
              </p>
              <p>
                A cada <strong>5 rodadas</strong>{" "}
                (ciclo completo) a ordem reseta pro inverso da classificação
                atual.
              </p>
              <p>
                Empate no interesse por free agent → quem está mais alto na
                lista leva.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function ModalInteresses(
  { itens, onClose, onMover, onPedirRemover }: {
    itens: MeuInteresse[];
    onClose: () => void;
    onMover: (atletaId: number, dir: -1 | 1) => void;
    onPedirRemover: (m: MeuInteresse) => void;
  },
) {
  return (
    <div class="bf-modal" onClick={onClose}>
      <div class="bf-modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="bf-modal__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
        <h3 class="bf-modal__titulo">Meus interesses</h3>
        <div class="bf-modal__body">
          <p class="bf-modal__txt">
            Ordene por prioridade. Vence o do topo que ainda estiver livre
            quando chegar sua vez.
          </p>
          {itens.length === 0
            ? (
              <div class="bf-empty-state" style="margin:8px 4px">
                Você não tem interesses ativos. Demonstre interesse num free
                agent pra empilhar.
              </div>
            )
            : (
              <ol class="bf-int__lista">
                {itens.map((m, i) => (
                  <li class="bf-int__item" key={m.atleta_id}>
                    <span class="bf-int__pos">{i + 1}º</span>
                    <div class="bf-int__foto">
                      {m.foto
                        ? <img src={m.foto} alt="" loading="lazy" />
                        : (
                          <JerseySvg
                            cores={m.cores}
                            class="bf-int__foto-jersey"
                          />
                        )}
                    </div>
                    <div class="bf-int__txt">
                      <div class="bf-int__nome">
                        {m.nome}
                        <span class="bf-int__poschip">
                          {m.posicao}
                        </span>
                      </div>
                      <div class="bf-int__sub">
                        {m.clubeNome} · ofereceu{" "}
                        <strong>{m.oferecidoNome}</strong>
                      </div>
                      {m.totalInteressados > 1 && (
                        <div class="bf-int__sub bf-int__sub--alerta">
                          Disputado por {m.totalInteressados} times
                        </div>
                      )}
                    </div>
                    <div class="bf-int__acoes">
                      <button
                        type="button"
                        class="bf-int__btn"
                        onClick={() => onMover(m.atleta_id, -1)}
                        disabled={i === 0}
                        aria-label="Subir"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="bf-int__btn"
                        onClick={() => onMover(m.atleta_id, 1)}
                        disabled={i === itens.length - 1}
                        aria-label="Descer"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        class="bf-int__btn bf-int__btn--del"
                        onClick={() => onPedirRemover(m)}
                        aria-label="Remover"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          <details class="bf-regras">
            <summary>Como funciona</summary>
            <div class="bf-regras__body">
              <p>
                Conflitos com outros times resolvem por{" "}
                <strong>posição do draft</strong>: quem está mais alto leva
                primeiro.
              </p>
              <p>
                Seus empates internos resolvem por <strong>essa ordem</strong>
                {" "}
                (do topo pra baixo).
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Modal de detalhes do atleta — fetch lazy de /api/atleta/:id/info
// ============================================================

interface DetalheRes {
  ok: boolean;
  atleta?: {
    atleta_id: number;
    apelido: string;
    nome_completo: string | null;
    posicao_id: number;
    clube_nome: string;
    status_id: number | null;
    jogos: number;
    ultima: number | null;
    media: number | null;
    scout: Record<string, number>;
  };
  donoChave?: string | null;
  donoNome?: string | null;
  negociavel?: boolean;
  interesses?: Array<{ chave: string; oferecido: number }>;
  erro?: string;
}

// Labels dos códigos de scout — keep self-contained no island pra
// não importar /lib/scout.ts que tem icon emoji.
// Validado contra /atletas/pontuados em 2026-05 — Cartola adicionou DE
// e V depois da migração do scout antigo. DD/PI/PE ainda existem na
// estrutura, mas raramente aparecem em rodadas recentes.
const SCOUT_LABEL: Record<string, string> = {
  // Linha de campo — ofensivo
  G: "Gols",
  A: "Assistências",
  FT: "Finalização na trave",
  FD: "Finalização defendida",
  FF: "Finalização fora",
  FS: "Faltas sofridas",
  PS: "Pênaltis sofridos",
  // Linha de campo — defensivo (positivo)
  DS: "Desarmes",
  // Linha de campo — defensivo (negativo)
  FC: "Faltas cometidas",
  I: "Impedimentos",
  PI: "Passes incompletos",
  PE: "Passes errados",
  GC: "Gols contra",
  PP: "Pênaltis perdidos",
  PC: "Pênaltis cometidos",
  CA: "Cartões amarelos",
  CV: "Cartões vermelhos",
  // Goleiro
  DE: "Defesas",
  DD: "Defesas difíceis",
  DP: "Defesa de pênalti",
  SG: "Sem sofrer gols",
  GS: "Gols sofridos",
  // Técnico
  V: "Vitória",
};

// Scouts que somam pontos no Cartola — separados pra colorir lime
// vs red no modal. Valores oficiais (validados via cálculo nas rodadas
// reais — alguns mudaram em relação ao Cartola antigo):
//   G +8 · A +5 · FT +3 · FD +1.2 · FF +0.7 · FS +0.5 · PS +1 ·
//   DS +1.2 · DE +1.3 · DD +3 · DP +7 · SG +5 · V +5 (técnico)
//   FC -0.5 · I -0.1 · GC -3 · PP -4 · PC -1 · CA -2 · CV -5 · GS -1
const SCOUT_POSITIVO = new Set([
  // Linha de campo
  "G",
  "A",
  "FT",
  "FD",
  "FF",
  "FS",
  "DS",
  "PS",
  // Goleiro
  "DE",
  "DD",
  "DP",
  "SG",
  // Técnico
  "V",
]);

interface HistoricoRodadaEntry {
  pontos: number;
  scout: Record<string, number>;
}
interface HistoricoRes {
  ok: boolean;
  historico?: Record<string, HistoricoRodadaEntry>;
  rodadaAtual?: number;
}

function ModalAtletaDetalhes(
  { base, onClose }: {
    base: AtletaMercado;
    onClose: () => void;
  },
) {
  const [data, setData] = useState<DetalheRes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [historico, setHistorico] = useState<HistoricoRes | null>(null);
  const [rodadaSel, setRodadaSel] = useState<number | null>(null);

  useEffect(() => {
    let cancel = false;
    // info (scout, dono na liga, etc.) e historico (pontos/rodada) em paralelo
    (async () => {
      try {
        const r = await fetch(`/api/atleta/${base.atleta_id}/info`);
        const d = await r.json();
        if (!cancel) setData(d);
      } catch (e) {
        if (!cancel) setData({ ok: false, erro: String(e) });
      } finally {
        if (!cancel) setCarregando(false);
      }
    })();
    (async () => {
      try {
        const r = await fetch(`/api/atleta/${base.atleta_id}/historico`);
        const d = await r.json() as HistoricoRes;
        if (!cancel) setHistorico(d);
      } catch {
        // histórico opcional — não bloqueia modal
      }
    })();
    return () => {
      cancel = true;
    };
  }, [base.atleta_id]);

  // ESC pra fechar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const a = data?.atleta;
  const hasFoto = !!base.foto;
  const st = base.statusId != null ? STATUS_LABEL[base.statusId] : null;

  const scoutEntries = a
    ? Object.entries(a.scout).sort((x, y) => y[1] - x[1])
    : [];
  const positivos = scoutEntries.filter(([k]) => SCOUT_POSITIVO.has(k));
  const negativos = scoutEntries.filter(([k]) => !SCOUT_POSITIVO.has(k));

  return (
    <div class="bf-modal" onClick={onClose}>
      <div class="bf-modal__card bf-modal__card--atleta" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="bf-modal__close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>

        <div class="bf-atleta-detalhes">
          {/* Header com foto + identidade */}
          <header class="bf-atleta-detalhes__head">
            <div
              class={`bf-atleta-detalhes__foto ${
                hasFoto ? "bf-atleta-detalhes__foto--cutout" : ""
              }`}
            >
              {hasFoto
                ? <img src={base.foto!} alt="" />
                : (
                  <JerseySvg
                    cores={base.cores}
                    class="bf-atleta-detalhes__jersey"
                  />
                )}
            </div>
            <div class="bf-atleta-detalhes__meta">
              <div class="bf-atleta-detalhes__nome">{base.nome}</div>
              {a?.nome_completo && a.nome_completo !== base.nome && (
                <div class="bf-atleta-detalhes__nome-full">
                  {a.nome_completo}
                </div>
              )}
              <div class="bf-atleta-detalhes__sub">
                <span class="bf-atleta-detalhes__pos">
                  {base.posicao}
                </span>
                <span class="bf-atleta-detalhes__clube">
                  {escudoUrl(base.clubeNome) && (
                    <img
                      class="bf-atleta-detalhes__clube-escudo"
                      src={escudoUrl(base.clubeNome)!}
                      alt=""
                      aria-hidden="true"
                    />
                  )}
                  {base.clubeNome}
                </span>
                {st && (
                  <span
                    class="bf-atleta-detalhes__status"
                    style={{ "--st-color": st.cor } as Record<string, string>}
                  >
                    {st.sym} {st.txt}
                  </span>
                )}
              </div>
            </div>
          </header>

          {/* Stats grid */}
          <div class="bf-atleta-detalhes__stats">
            <div class="bf-atleta-detalhes__stat">
              <span class="bf-label-micro">Última</span>
              <span class="bf-atleta-detalhes__stat-val">
                {base.pontosUltima != null
                  ? base.pontosUltima.toFixed(1).replace(".", ",")
                  : "—"}
              </span>
            </div>
            <div class="bf-atleta-detalhes__stat">
              <span class="bf-label-micro">Média</span>
              <span class="bf-atleta-detalhes__stat-val">
                {base.mediaPontos != null
                  ? base.mediaPontos.toFixed(1).replace(".", ",")
                  : "—"}
              </span>
            </div>
            {a && (
              <div class="bf-atleta-detalhes__stat">
                <span class="bf-label-micro">Jogos</span>
                <span class="bf-atleta-detalhes__stat-val">{a.jogos}</span>
              </div>
            )}
          </div>

          {/* Chart de pontos por rodada (lazy — chega depois do info) */}
          {historico?.ok && historico.historico && (
            <>
              <AtletaPontosChart
                historico={historico.historico}
                maxRodada={historico.rodadaAtual}
                selectedRodada={rodadaSel}
                onSelectRodada={setRodadaSel}
              />
              {rodadaSel != null && historico.historico[String(rodadaSel)] &&
                (() => {
                  const ent = historico.historico![String(rodadaSel)];
                  const entries = Object.entries(ent.scout).filter(([, v]) =>
                    v > 0
                  ).sort((x, y) => y[1] - x[1]);
                  const pos = entries.filter(([k]) => SCOUT_POSITIVO.has(k));
                  const neg = entries.filter(([k]) => !SCOUT_POSITIVO.has(k));
                  return (
                    <div class="bf-atleta-detalhes__rodada-scout">
                      <div class="bf-atleta-detalhes__rodada-scout-head">
                        <span class="bf-atleta-detalhes__rodada-scout-titulo">
                          Rodada {rodadaSel}
                        </span>
                        <span class="bf-atleta-detalhes__rodada-scout-pts">
                          {ent.pontos.toFixed(1).replace(".", ",")} pts
                        </span>
                        <button
                          type="button"
                          class="bf-atleta-detalhes__rodada-scout-close"
                          onClick={() => setRodadaSel(null)}
                          aria-label="Fechar detalhe da rodada"
                        >
                          ×
                        </button>
                      </div>
                      {entries.length === 0 && (
                        <div class="bf-atleta-detalhes__rodada-scout-vazio">
                          Sem scout registrado nesta rodada
                        </div>
                      )}
                      {pos.length > 0 && (
                        <div class="bf-atleta-detalhes__scout-grupo bf-atleta-detalhes__scout-grupo--pos">
                          {pos.map(([k, v]) => (
                            <div
                              class="bf-atleta-detalhes__scout-item"
                              key={k}
                            >
                              <span class="bf-atleta-detalhes__scout-qtd">
                                {v}
                              </span>
                              <span class="bf-atleta-detalhes__scout-lbl">
                                {SCOUT_LABEL[k] ?? k}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {neg.length > 0 && (
                        <div class="bf-atleta-detalhes__scout-grupo bf-atleta-detalhes__scout-grupo--neg">
                          {neg.map(([k, v]) => (
                            <div
                              class="bf-atleta-detalhes__scout-item"
                              key={k}
                            >
                              <span class="bf-atleta-detalhes__scout-qtd">
                                {v}
                              </span>
                              <span class="bf-atleta-detalhes__scout-lbl">
                                {SCOUT_LABEL[k] ?? k}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </>
          )}

          {/* Status na liga: dono ou free agent */}
          {!carregando && data?.ok && (
            <div class="bf-atleta-detalhes__liga">
              {data.donoChave
                ? (
                  <>
                    <span class="bf-label-micro">Time na liga</span>
                    <a
                      href={`/liga#time-${data.donoChave}`}
                      class="bf-atleta-detalhes__liga-link"
                    >
                      {data.donoNome ?? data.donoChave}
                    </a>
                    {data.negociavel && (
                      <span class="bf-atleta-detalhes__liga-tag">
                        negociável
                      </span>
                    )}
                  </>
                )
                : (
                  <>
                    <span class="bf-label-micro">Liga</span>
                    <span class="bf-atleta-detalhes__liga-free">
                      Free agent
                    </span>
                    {data.interesses && data.interesses.length > 0 && (
                      <span class="bf-atleta-detalhes__liga-tag">
                        {data.interesses.length} interessado
                        {data.interesses.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                )}
            </div>
          )}

          {/* Scout da temporada */}
          {carregando && (
            <div class="bf-atleta-detalhes__loading">
              Carregando scout da temporada…
            </div>
          )}
          {!carregando && a && scoutEntries.length > 0 && (
            <div class="bf-atleta-detalhes__scout">
              <div class="bf-atleta-detalhes__scout-titulo">
                Scout da temporada
              </div>
              {positivos.length > 0 && (
                <div class="bf-atleta-detalhes__scout-grupo bf-atleta-detalhes__scout-grupo--pos">
                  {positivos.map(([k, v]) => (
                    <div class="bf-atleta-detalhes__scout-item" key={k}>
                      <span class="bf-atleta-detalhes__scout-qtd">{v}</span>
                      <span class="bf-atleta-detalhes__scout-lbl">
                        {SCOUT_LABEL[k] ?? k}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {negativos.length > 0 && (
                <div class="bf-atleta-detalhes__scout-grupo bf-atleta-detalhes__scout-grupo--neg">
                  {negativos.map(([k, v]) => (
                    <div class="bf-atleta-detalhes__scout-item" key={k}>
                      <span class="bf-atleta-detalhes__scout-qtd">{v}</span>
                      <span class="bf-atleta-detalhes__scout-lbl">
                        {SCOUT_LABEL[k] ?? k}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!carregando && a && scoutEntries.length === 0 && (
            <div class="bf-atleta-detalhes__loading">
              Sem scout registrado nesta temporada
            </div>
          )}
          {!carregando && data && !data.ok && (
            <div class="bf-modal__erro">
              {data.erro ?? "Erro ao carregar detalhes"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
