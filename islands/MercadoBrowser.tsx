import { useMemo, useState } from "preact/hooks";

export interface AtletaMercado {
  atleta_id: number;
  nome: string;
  posicao: "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante";
  clubeNome: string;
  clubeId: number;
  statusId: number | null;
  foto: string | null;
  pontosUltima: number | null;
  mediaPontos: number | null;
  /** Se está marcado à venda, qual o time dono. Null se free agent. */
  donoChave: string | null;
  donoTime: string | null;
  /** Times que demonstraram interesse (chaves) — só pra free agents */
  interessados: string[];
  /** atleta_id que EU empenhei (se já marquei interesse). null caso contrário. */
  meuOferecido?: number | null;
}

export interface AtletaMeuTime extends AtletaMercado {
  aVenda: boolean;
}

export interface DraftEntry {
  chave: string;
  nome: string;
}

interface Props {
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
}

const POS_ABREV: Record<string, string> = {
  Goleiro: "GOL",
  Lateral: "LAT",
  Zagueiro: "ZAG",
  Meia: "MEI",
  Atacante: "ATK",
};

const STATUS_LABEL: Record<number, { sym: string; cor: string; txt: string }> =
  {
    7: { sym: "✓", cor: "var(--bf-lime)", txt: "Provável" },
    2: { sym: "?", cor: "var(--bf-yellow)", txt: "Dúvida" },
    3: { sym: "✕", cor: "var(--bf-red)", txt: "Suspenso" },
    5: { sym: "+", cor: "var(--bf-red)", txt: "Contundido" },
    6: { sym: "–", cor: "var(--bf-fg-3)", txt: "Nulo" },
  };

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function MercadoBrowser(
  {
    jogadores: inicial,
    minhaChave = null,
    meuElenco = [],
    qtdAVenda = 0,
    posicaoDraft = null,
    draftOrdem = [],
  }: Props,
) {
  const [jogadores, setJogadores] = useState<AtletaMercado[]>(inicial);
  const [meu, setMeu] = useState<AtletaMeuTime[]>(meuElenco);
  const [busca, setBusca] = useState("");
  const [posicao, setPosicao] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [clube, setClube] = useState<string>("");
  const [tipo, setTipo] = useState<
    "todos" | "free" | "venda" | "meu"
  >("todos");
  const [pendendo, setPendendo] = useState<number | null>(null);
  const [draftAberto, setDraftAberto] = useState(false);

  // Modal único — distingue por modo:
  // - "oferta": trade entre times (precisa enviar pra dono)
  // - "interesse": empenhar jogador pelo free agent
  const [modal, setModal] = useState<
    | { modo: "oferta"; pedido: AtletaMercado }
    | { modo: "interesse"; pedido: AtletaMercado }
    | null
  >(null);

  async function enviarOferta(
    pedido: AtletaMercado,
    oferecido: AtletaMeuTime,
  ): Promise<{ ok: boolean; erro?: string }> {
    try {
      const r = await fetch("/api/ofertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atleta_pedido: pedido.atleta_id,
          atleta_oferecido: oferecido.atleta_id,
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
      }
      return d;
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  }

  async function removerInteresse(j: AtletaMercado) {
    if (!minhaChave) return;
    setPendendo(j.atleta_id);
    const prevInter = j.interessados;
    const prevOf = j.meuOferecido;
    setJogadores((arr) =>
      arr.map((x) =>
        x.atleta_id === j.atleta_id
          ? {
            ...x,
            interessados: x.interessados.filter((c) => c !== minhaChave),
            meuOferecido: null,
          }
          : x
      )
    );
    try {
      const r = await fetch(`/api/atleta/${j.atleta_id}/interesse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remover: true }),
      });
      const d = await r.json();
      if (!d.ok) {
        setJogadores((arr) =>
          arr.map((x) =>
            x.atleta_id === j.atleta_id
              ? { ...x, interessados: prevInter, meuOferecido: prevOf }
              : x
          )
        );
      }
    } catch {
      setJogadores((arr) =>
        arr.map((x) =>
          x.atleta_id === j.atleta_id
            ? { ...x, interessados: prevInter, meuOferecido: prevOf }
            : x
        )
      );
    } finally {
      setPendendo(null);
    }
  }

  async function toggleAVenda(j: AtletaMeuTime) {
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
    if (!minhaChave || j.donoChave) return;
    if (j.interessados.includes(minhaChave)) {
      // já interessado → confirma remoção em vez de abrir modal de troca
      if (confirm("Remover interesse e liberar o jogador empenhado?")) {
        removerInteresse(j);
      }
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
    const src = tipo === "meu" ? meu : jogadores;
    return src.filter((j) => {
      if (posicao && j.posicao !== posicao) return false;
      if (status && String(j.statusId) !== status) return false;
      if (clube && j.clubeNome !== clube) return false;
      if (tipo === "free" && j.donoChave) return false;
      if (tipo === "venda" && !j.donoChave) return false;
      if (buscaNorm && !norm(j.nome).includes(buscaNorm)) return false;
      return true;
    }).sort((a, b) => (b.mediaPontos ?? 0) - (a.mediaPontos ?? 0));
  }, [jogadores, meu, busca, posicao, status, clube, tipo]);

  return (
    <div class="bf-mercado">
      {minhaChave && (
        <div class="bf-mercado__stats">
          <div class="bf-mercado__stat">
            <span class="bf-mercado__stat-val">{qtdAVenda}</span>
            <span class="bf-mercado__stat-lbl">à venda</span>
          </div>
          <div class="bf-mercado__stat-div" />
          <button
            type="button"
            class="bf-mercado__stat bf-mercado__stat--btn"
            onClick={() => setDraftAberto((v) => !v)}
            disabled={draftOrdem.length === 0}
            title="Ver ordem do draft"
          >
            <span class="bf-mercado__stat-val">
              {posicaoDraft ? `${posicaoDraft}º` : "—"}
            </span>
            <span class="bf-mercado__stat-lbl">no draft</span>
          </button>
        </div>
      )}

      {draftAberto && draftOrdem.length > 0 && (
        <div class="bf-mercado__draft">
          <div class="bf-mercado__draft-titulo">Ordem do draft</div>
          <ol class="bf-mercado__draft-lista">
            {draftOrdem.map((d, i) => (
              <li
                key={d.chave}
                class={d.chave === minhaChave
                  ? "bf-mercado__draft-item bf-mercado__draft-item--meu"
                  : "bf-mercado__draft-item"}
              >
                <span class="bf-mercado__draft-pos">{i + 1}º</span>
                <span class="bf-mercado__draft-nome">{d.nome}</span>
              </li>
            ))}
          </ol>
          <div class="bf-mercado__draft-foot">
            Empate no interesse por free agent → quem está mais alto na lista
            leva.
          </div>
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
            À venda
          </Chip>
          {minhaChave && meuElenco.length > 0 && (
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
        <span>{filtrados.length}</span> jogadores
      </div>

      <div class="bf-mercado__grid">
        {filtrados.map((j) =>
          tipo === "meu"
            ? (
              <CardMeu
                key={j.atleta_id}
                j={j as AtletaMeuTime}
                onToggleVenda={toggleAVenda}
                pendendo={pendendo === j.atleta_id}
              />
            )
            : (
              <CardJogador
                key={j.atleta_id}
                j={j}
                minhaChave={minhaChave}
                meuElenco={meu}
                onInteresse={abrirInteresse}
                onOfertar={(jj) => setModal({ modo: "oferta", pedido: jj })}
                pendendo={pendendo === j.atleta_id}
              />
            )
        )}
        {filtrados.length === 0 && (
          <div class="bf-empty-state">Nenhum jogador encontrado</div>
        )}
      </div>

      {modal && (
        <ModalOferta
          modo={modal.modo}
          pedido={modal.pedido}
          meuElenco={meu}
          onClose={() => setModal(null)}
          onEnviar={modal.modo === "interesse"
            ? registrarInteresse
            : enviarOferta}
        />
      )}
    </div>
  );
}

function ModalOferta(
  { modo, pedido, meuElenco, onClose, onEnviar }: {
    modo: "oferta" | "interesse";
    pedido: AtletaMercado;
    meuElenco: AtletaMeuTime[];
    onClose: () => void;
    onEnviar: (
      pedido: AtletaMercado,
      oferecido: AtletaMeuTime,
    ) => Promise<{ ok: boolean; erro?: string }>;
  },
) {
  const [oferecido, setOferecido] = useState<AtletaMeuTime | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<"ok" | string | null>(null);

  // Só mesma posição — trocas requerem compatibilidade posicional
  const lista = useMemo(() => {
    return meuElenco
      .filter((j) => j.posicao === pedido.posicao)
      .sort((a, b) => (b.mediaPontos ?? 0) - (a.mediaPontos ?? 0));
  }, [meuElenco, pedido]);

  async function submit() {
    if (!oferecido) return;
    setEnviando(true);
    const r = await onEnviar(pedido, oferecido);
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
                  Você empenhou um jogador por{" "}
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
        <button class="bf-modal__close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
        <h3 class="bf-modal__titulo">
          {modo === "interesse" ? "Tenho interesse em " : "Oferecer troca por "}
          <span style="color:var(--bf-lime)">{pedido.nome}</span>
        </h3>
        <p class="bf-modal__txt">
          {modo === "interesse"
            ? `Empenhe um jogador da mesma posição (${
              POS_ABREV[pedido.posicao]
            }). Se você ganhar o draft, ele entra no seu time e o empenhado vira free agent.`
            : `Escolha um jogador do seu time da mesma posição (${
              POS_ABREV[pedido.posicao]
            }).`}
        </p>
        <div class="bf-modal__lista">
          {lista.length === 0 && (
            <div class="bf-empty-state" style="margin:8px 4px">
              Você não tem nenhum {POS_ABREV[pedido.posicao]} no elenco
            </div>
          )}
          {lista.map((j) => (
            <button
              type="button"
              key={j.atleta_id}
              class={`bf-modal__opt ${
                oferecido?.atleta_id === j.atleta_id ? "bf-modal__opt--sel" : ""
              }`}
              onClick={() => setOferecido(j)}
            >
              <span class="bf-modal__opt-pos">{POS_ABREV[j.posicao]}</span>
              <span class="bf-modal__opt-nome">{j.nome}</span>
              <span class="bf-modal__opt-clube">{j.clubeNome}</span>
              <span class="bf-modal__opt-media">
                {j.mediaPontos != null
                  ? j.mediaPontos.toFixed(1).replace(".", ",")
                  : "—"}
              </span>
            </button>
          ))}
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
            disabled={!oferecido || enviando}
          >
            {enviando
              ? "Enviando…"
              : modo === "interesse"
              ? "Confirmar interesse"
              : "Enviar oferta"}
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
  { j, minhaChave, meuElenco, onInteresse, onOfertar, pendendo }: {
    j: AtletaMercado;
    minhaChave: string | null;
    meuElenco: AtletaMeuTime[];
    onInteresse: (j: AtletaMercado) => void;
    onOfertar?: (j: AtletaMercado) => void;
    pendendo: boolean;
  },
) {
  const nomeOferecido = j.meuOferecido
    ? meuElenco.find((m) => m.atleta_id === j.meuOferecido)?.nome
    : null;
  const hasFoto = !!j.foto;
  const isCutout = hasFoto &&
    (j.foto!.includes("thesportsdb") || j.foto!.startsWith("/atletas/"));
  const st = j.statusId != null ? STATUS_LABEL[j.statusId] : null;
  const interessado = !!minhaChave && j.interessados.includes(minhaChave);
  const podeInteressar = !!minhaChave && !j.donoChave;
  const podeOfertar = !!minhaChave && !!j.donoChave &&
    j.donoChave !== minhaChave;
  const ultima = j.pontosUltima != null
    ? j.pontosUltima.toFixed(1).replace(".", ",")
    : "—";
  const media = j.mediaPontos != null
    ? j.mediaPontos.toFixed(1).replace(".", ",")
    : "—";
  return (
    <article
      class={`bf-merc-card bf-merc-card--${
        POS_ABREV[j.posicao].toLowerCase()
      } ${isCutout ? "bf-merc-card--cutout" : ""}`}
    >
      <div class="bf-merc-card__foto">
        {hasFoto
          ? <img src={j.foto!} alt="" loading="lazy" />
          : (
            <div class="bf-merc-card__foto-placeholder">
              {j.nome.charAt(0)}
            </div>
          )}
      </div>
      <div class="bf-merc-card__top">
        <span class="bf-merc-card__pos">{POS_ABREV[j.posicao]}</span>
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
      </div>
      <div class="bf-merc-card__nome">{j.nome}</div>
      <div class="bf-merc-card__clube">{j.clubeNome}</div>
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
              ? `Empenhou: ${nomeOferecido ?? "?"} — clique pra desistir`
              : "Empenhar jogador em troca dele"}
          >
            {interessado
              ? (
                <>
                  Empenhou <strong>{nomeOferecido ?? "?"}</strong>
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
  { j, onToggleVenda, pendendo }: {
    j: AtletaMeuTime;
    onToggleVenda: (j: AtletaMeuTime) => void;
    pendendo: boolean;
  },
) {
  const hasFoto = !!j.foto;
  const isCutout = hasFoto &&
    (j.foto!.includes("thesportsdb") || j.foto!.startsWith("/atletas/"));
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
        POS_ABREV[j.posicao].toLowerCase()
      } ${isCutout ? "bf-merc-card--cutout" : ""}`}
    >
      <div class="bf-merc-card__foto">
        {hasFoto
          ? <img src={j.foto!} alt="" loading="lazy" />
          : (
            <div class="bf-merc-card__foto-placeholder">
              {j.nome.charAt(0)}
            </div>
          )}
      </div>
      <div class="bf-merc-card__top">
        <span class="bf-merc-card__pos">{POS_ABREV[j.posicao]}</span>
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
      </div>
      <div class="bf-merc-card__nome">{j.nome}</div>
      <div class="bf-merc-card__clube">{j.clubeNome}</div>
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
        disabled={pendendo}
        title={j.aVenda ? "Tirar da venda" : "Pôr à venda"}
      >
        {j.aVenda ? "À venda ✓" : "Pôr à venda"}
      </button>
    </article>
  );
}
