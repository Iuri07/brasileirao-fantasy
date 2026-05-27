import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import Field, {
  type BancoPino,
  type Escalacao,
  type Pino,
  statusInfo,
} from "../components/Field.tsx";
import { coresClube } from "../lib/cores.ts";
import { escudoUrl } from "../lib/escudos.ts";
import ReservasRow from "../components/ReservasRow.tsx";

/** Atleta do elenco — abrange as 3 categorias do roster fixo de ~26. */
export interface AtletaElenco {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: "Goleiro" | "Lateral" | "Zagueiro" | "Meia" | "Atacante";
  /** Sim = titular, Banco = reserva ativa, Não = reserva inativa (pool) */
  escalacao: "Sim" | "Banco" | "Não";
  pontos: number | null;
  foto: string | null;
  statusId: number | null;
  /** Live: jogador entrou em campo via auto-sub (bench → escala). */
  subEntrou?: boolean;
  /** Live: era titular, foi rebaixado pelo auto-sub (escala → bench). */
  subSaiu?: boolean;
  /** Live: jogador está atualmente em campo (Cartola entrou_em_campo). */
  emCampo?: boolean;
}

interface Props {
  chave: string;
  /** Todos os atletas do elenco (escalados + banco) */
  atletas: AtletaElenco[];
  /** Cor accent do clube do dono (passa pro Field) */
  accent: string;
  /** True se rodada está ao vivo (mostra contador de subs) */
  aoVivo: boolean;
  /** Quantas substituições já foram usadas nesta rodada (manuais via swap) */
  subsUsadasInicial: number;
  /** Quantas substituições automáticas foram aplicadas pelo algoritmo */
  subsAuto?: number;
  /** Limite de substituições */
  subsMax: number;
  /** Mostrar pontos parciais nos pinos */
  showPoints: boolean;
  /** Começa em modo edição? Default false. */
  editandoInicial?: boolean;
  /** Edição desabilitada (mercado fechado) */
  edicaoBloqueada?: boolean;
  /** "2d 3h 12min" — countdown até o mercado fechar (null se fechado/erro) */
  fechamentoTexto?: string | null;
  /** atleta_ids do meu elenco atualmente marcados "à venda" */
  aVendaIds?: number[];
}

const POS_ABREV: Record<string, string> = {
  Goleiro: "GOL",
  Lateral: "LAT",
  Zagueiro: "ZAG",
  Meia: "MEI",
  Atacante: "ATK",
};

function compativel(a: AtletaElenco, b: AtletaElenco): boolean {
  // Posição exata: zagueiro só troca com zagueiro, lateral só com lateral
  return a.posicao === b.posicao;
}

export default function MeuTimeEditor(
  {
    chave,
    atletas: atletasIniciais,
    accent,
    aoVivo,
    subsUsadasInicial,
    subsAuto = 0,
    subsMax,
    showPoints,
    editandoInicial = false,
    edicaoBloqueada = false,
    fechamentoTexto = null,
    aVendaIds = [],
  }: Props,
) {
  const [aVendaSet, setAVendaSet] = useState<Set<number>>(new Set(aVendaIds));
  async function toggleAVenda(atletaId: number) {
    const prev = new Set(aVendaSet);
    const novo = new Set(aVendaSet);
    if (novo.has(atletaId)) novo.delete(atletaId);
    else novo.add(atletaId);
    setAVendaSet(novo);
    try {
      const r = await fetch(`/api/elenco/${chave}/a-venda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atleta_id: atletaId }),
      });
      const d = await r.json();
      if (!d.ok) {
        setAVendaSet(prev);
        setErro(d.erro ?? "Erro ao alterar negociável");
      }
    } catch (e) {
      setAVendaSet(prev);
      setErro(String(e));
    }
  }
  const [atletas, setAtletas] = useState<AtletaElenco[]>(atletasIniciais);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [subsUsadas, setSubsUsadas] = useState(subsUsadasInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendendo, setPendendo] = useState(false);
  const [editando, setEditando] = useState(editandoInicial);
  // FLIP: snapshot da posição dos pins envolvidos no último swap
  const pendingFlip = useRef<
    { ids: [number, number]; rects: Map<number, DOMRect> } | null
  >(
    null,
  );

  // Antes do reflow, aplica o transform invertido pros 2 pins envolvidos
  // no swap aparecerem na posição ANTIGA. Depois cancela o transform com
  // transition, deixando o browser animar até a posição NOVA.
  useLayoutEffect(() => {
    const pending = pendingFlip.current;
    if (!pending) return;
    pendingFlip.current = null;
    const [a, b] = pending.ids;
    for (const id of [a, b]) {
      const oldRect = pending.rects.get(id);
      if (!oldRect) continue;
      const el = document.querySelector<HTMLElement>(
        `[data-atleta-id="${id}"]`,
      );
      if (!el) continue;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (dx === 0 && dy === 0) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.zIndex = "10";
      // Force reflow antes de aplicar a transição
      void el.offsetWidth;
      el.style.transition = "transform 420ms cubic-bezier(0.34, 1.2, 0.64, 1)";
      el.style.transform = "";
      const cleanup = () => {
        el.style.transition = "";
        el.style.zIndex = "";
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
    }
  }, [atletas]);

  function toggleEdicao() {
    if (edicaoBloqueada && !editando) return;
    if (editando) setSelecionado(null);
    setErro(null);
    setEditando(!editando);
  }

  function selecionar(atletaId: number) {
    if (!editando) return;
    if (pendendo) return;
    // Tira o foco do elemento clicado — se o foco continuar num botão que
    // muda de posição depois do swap, o browser auto-scrolla pra mantê-lo
    // visível ("salto" da tela durante a animação)
    (document.activeElement as HTMLElement | null)?.blur?.();
    setErro(null);
    if (selecionado === atletaId) {
      setSelecionado(null);
      return;
    }
    if (selecionado === null) {
      setSelecionado(atletaId);
      return;
    }
    // Segundo clique: tenta swap
    const a = atletas.find((x) => x.atleta_id === selecionado);
    const b = atletas.find((x) => x.atleta_id === atletaId);
    if (!a || !b) return;
    if (!compativel(a, b)) {
      setErro(
        `Posições incompatíveis: ${POS_ABREV[a.posicao]} ↔ ${
          POS_ABREV[b.posicao]
        }`,
      );
      setSelecionado(atletaId);
      return;
    }
    if (a.escalacao === b.escalacao) {
      // Mesmo grupo + mesma posição: só reordena visualmente (sem backend)
      reorderLocal(a, b);
      return;
    }
    void swapEscala(a, b);
  }

  /** Reorder local entre dois atletas do mesmo grupo+posição — apenas
      troca a ordem no array atual (não persiste no KV). */
  function reorderLocal(a: AtletaElenco, b: AtletaElenco) {
    // FLIP: snapshot da posição visual atual
    const rects = new Map<number, DOMRect>();
    for (const id of [a.atleta_id, b.atleta_id]) {
      const el = document.querySelector<HTMLElement>(
        `[data-atleta-id="${id}"]`,
      );
      if (el) rects.set(id, el.getBoundingClientRect());
    }
    pendingFlip.current = { ids: [a.atleta_id, b.atleta_id], rects };
    const ia = atletas.findIndex((x) => x.atleta_id === a.atleta_id);
    const ib = atletas.findIndex((x) => x.atleta_id === b.atleta_id);
    if (ia < 0 || ib < 0) return;
    const next = [...atletas];
    [next[ia], next[ib]] = [next[ib], next[ia]];
    setAtletas(next);
    setSelecionado(null);
  }

  async function swapEscala(a: AtletaElenco, b: AtletaElenco) {
    // Limite de subs só conta quando a troca afeta a escala (Sim envolvido)
    const afetaEscala = a.escalacao === "Sim" || b.escalacao === "Sim";
    if (aoVivo && afetaEscala && subsUsadas >= subsMax) {
      setErro(`Limite de ${subsMax} substituições atingido nesta rodada`);
      return;
    }
    setPendendo(true);
    setErro(null);
    // FLIP: captura posições ANTES de mudar o state
    const rects = new Map<number, DOMRect>();
    for (const id of [a.atleta_id, b.atleta_id]) {
      const el = document.querySelector<HTMLElement>(
        `[data-atleta-id="${id}"]`,
      );
      if (el) rects.set(id, el.getBoundingClientRect());
    }
    pendingFlip.current = {
      ids: [a.atleta_id, b.atleta_id],
      rects,
    };
    // Otimista: a e b trocam de categoria E de posição no array. Trocar a
    // posição é essencial pra preservar a ordem visual da row (o reserva
    // entra na mesma posição visual do titular que saiu, em vez de pegar
    // a posição original dele no array).
    const ia = atletas.findIndex((x) => x.atleta_id === a.atleta_id);
    const ib = atletas.findIndex((x) => x.atleta_id === b.atleta_id);
    const novoEstado = atletas.map((x): AtletaElenco => {
      if (x.atleta_id === a.atleta_id) return { ...x, escalacao: b.escalacao };
      if (x.atleta_id === b.atleta_id) return { ...x, escalacao: a.escalacao };
      return x;
    });
    if (ia >= 0 && ib >= 0) {
      [novoEstado[ia], novoEstado[ib]] = [novoEstado[ib], novoEstado[ia]];
    }
    setAtletas(novoEstado);
    setSelecionado(null);

    try {
      const r = await fetch(`/api/elenco/${chave}/swap-escalacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atleta_id_sai: a.atleta_id,
          atleta_id_entra: b.atleta_id,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setAtletas(atletas);
        setErro(data.erro ?? "Erro na troca");
      } else if (data.aoVivo && afetaEscala) {
        setSubsUsadas(data.subsUsadas);
      }
    } catch (e) {
      setAtletas(atletas);
      setErro(String(e));
    } finally {
      setPendendo(false);
    }
  }

  // Constrói escalação + banco + não-escalados a partir do estado atual
  const { escalacao, banco, naoEscalados, bancoView, naoEscaladosView } =
    useMemo(() => {
      const pino = (j: AtletaElenco): Pino => ({
        atletaId: j.atleta_id,
        nome: j.apelido,
        pts: j.pontos,
        escudo: escudoUrl(j.clube),
        cores: coresClube(j.clube),
        pos: POS_ABREV[j.posicao],
        statusId: j.statusId,
        foto: j.foto,
        subEntrou: j.subEntrou,
        subSaiu: j.subSaiu,
        emCampo: j.emCampo,
      });
      const sims = atletas.filter((j) => j.escalacao === "Sim");
      const gk = sims.find((j) => j.posicao === "Goleiro");
      const def = sims.filter((j) =>
        j.posicao === "Zagueiro" || j.posicao === "Lateral"
      );
      const mid = sims.filter((j) => j.posicao === "Meia");
      const ata = sims.filter((j) => j.posicao === "Atacante");
      const escalacao: Escalacao = {
        gk: gk ? pino(gk) : {},
        def: def.map(pino),
        mid: mid.map(pino),
        ata: ata.map(pino),
      };
      const banco: BancoPino[] = atletas
        .filter((j) => j.escalacao === "Banco")
        .map((j) => ({ ...pino(j), posicao: j.posicao }));
      const naoEscalados = atletas.filter((j) => j.escalacao === "Não");
      // View mode: Banco e Reservas em rows separadas (Banco = pode entrar
      // via auto-sub, Reservas = resto do elenco). Sort por posição igual
      // ao NaoSection do edit mode pra consistência.
      const ordemPos: Record<AtletaElenco["posicao"], number> = {
        Goleiro: 0,
        Lateral: 1,
        Zagueiro: 2,
        Meia: 3,
        Atacante: 4,
      };
      const sortPos = (a: AtletaElenco, b: AtletaElenco) =>
        ordemPos[a.posicao] - ordemPos[b.posicao] ||
        a.apelido.localeCompare(b.apelido, "pt-BR");
      const bancoView: BancoPino[] = [...banco].sort((a, b) => {
        const ja = atletas.find((x) => x.atleta_id === a.atletaId);
        const jb = atletas.find((x) => x.atleta_id === b.atletaId);
        return ja && jb ? sortPos(ja, jb) : 0;
      });
      const naoEscaladosView: BancoPino[] = [...naoEscalados]
        .sort(sortPos)
        .map((j) => ({ ...pino(j), posicao: j.posicao }));
      return { escalacao, banco, naoEscalados, bancoView, naoEscaladosView };
    }, [atletas]);

  return (
    <div
      class={`bf-meu-time ${editando ? "bf-meu-time--editando" : ""} ${
        selecionado != null ? "bf-meu-time--selecting" : ""
      } ${pendendo ? "bf-meu-time--pendendo" : ""}`}
      data-selecionado={selecionado ?? undefined}
    >
      <div class="bf-meu-time__bar">
        <span class="bf-meu-time__titulo">Escalacao</span>
        {!aoVivo && fechamentoTexto && (
          <span class="bf-meu-time__market">
            <span class="bf-meu-time__market-dot" aria-hidden="true"></span>
            Mercado fecha em <strong>{fechamentoTexto}</strong>
          </span>
        )}
        {aoVivo && (
          <span
            class={`bf-pill bf-pill--timing-${
              subsAuto >= subsMax ? "danger" : "normal"
            }`}
            title="Substituições automáticas aplicadas"
          >
            <span class="bf-pill__lbl">Subs</span>
            <span class="bf-pill__val">{subsAuto}/{subsMax}</span>
          </span>
        )}
        {editando && selecionado != null && (
          <button
            type="button"
            class={`bf-meu-time__btn bf-meu-time__btn--icon ${
              aVendaSet.has(selecionado)
                ? "bf-meu-time__btn--venda-on"
                : "bf-meu-time__btn--venda"
            }`}
            onClick={() => toggleAVenda(selecionado)}
            aria-label={aVendaSet.has(selecionado)
              ? "Tornar exclusivo"
              : "Tornar negociável"}
            title={aVendaSet.has(selecionado)
              ? "Tornar exclusivo"
              : "Tornar negociável"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </button>
        )}
        {editando
          ? (
            <button
              type="button"
              class="bf-meu-time__btn bf-meu-time__btn--icon bf-meu-time__btn--done"
              onClick={toggleEdicao}
              aria-label="Concluir edição"
              title="Concluir"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )
          : (
            <button
              type="button"
              class="bf-meu-time__btn bf-meu-time__btn--icon"
              onClick={toggleEdicao}
              disabled={edicaoBloqueada}
              aria-label={edicaoBloqueada
                ? "Edição bloqueada — mercado fechado"
                : "Editar escalação"}
              title={edicaoBloqueada
                ? "Edição bloqueada — mercado fechado"
                : "Editar escalação"}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                {edicaoBloqueada
                  ? (
                    <>
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </>
                  )
                  : (
                    <>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </>
                  )}
              </svg>
            </button>
          )}
      </div>

      <div class="bf-meu-time__msg" aria-live="polite">
        {erro
          ? <span class="bf-meu-time__erro">{erro}</span>
          : pendendo
          ? <span class="bf-meu-time__hint">salvando…</span>
          : editando && selecionado != null
          ? (
            <span class="bf-meu-time__hint">
              Toque em outro jogador de mesma posição
            </span>
          )
          : null}
      </div>

      <Field
        jogadores={escalacao}
        showPoints={showPoints}
        liveMode={aoVivo}
        accent={accent}
        /* Banco inline no field SÓ no modo de edição (precisa pra drag/swap).
           Fora do edit, os reservas aparecem na ReservasRow abaixo. */
        banco={editando ? banco : undefined}
        onSelect={editando ? selecionar : undefined}
        selecionado={selecionado ?? undefined}
        compativelCom={!editando ? undefined : (p) => {
          if (selecionado == null || p.atletaId == null) return false;
          if (p.atletaId === selecionado) return false;
          const sel = atletas.find((x) => x.atleta_id === selecionado);
          const target = atletas.find((x) => x.atleta_id === p.atletaId);
          if (!sel || !target) return false;
          // Compatível = mesma posição. Mesmo grupo (Sim↔Sim, etc.) é
          // reorder visual; grupos diferentes é troca real via API.
          return compativel(sel, target);
        }}
      />

      {editando
        ? (
          naoEscalados.length > 0 && (
            <NaoSection
              atletas={naoEscalados}
              selecionado={selecionado ?? undefined}
              posicaoFiltro={selecionado != null
                ? atletas.find((x) => x.atleta_id === selecionado)?.posicao ??
                  null
                : null}
              onSelect={selecionar}
            />
          )
        )
        : (
          /* View mode: Banco e Reservas em rows separadas, igual
             /liga e /ao-vivo. */
          <>
            <ReservasRow
              label="Banco"
              jogadores={bancoView}
              showPoints={showPoints}
              showStatus={!aoVivo}
              liveMode={aoVivo}
            />
            <ReservasRow
              label="Não escalados"
              jogadores={naoEscaladosView}
              showPoints={showPoints}
              showStatus={!aoVivo}
              liveMode={aoVivo}
            />
          </>
        )}
    </div>
  );
}

function NaoSection(
  { atletas, selecionado, posicaoFiltro, onSelect }: {
    atletas: AtletaElenco[];
    selecionado?: number;
    posicaoFiltro: AtletaElenco["posicao"] | null;
    onSelect: (id: number) => void;
  },
) {
  // Ordena por posição (mesma ordem de cima pra baixo do campo) e nome
  const ordemPos: Record<AtletaElenco["posicao"], number> = {
    Goleiro: 0,
    Lateral: 1,
    Zagueiro: 2,
    Meia: 3,
    Atacante: 4,
  };
  const sorted = [...atletas].sort((a, b) =>
    ordemPos[a.posicao] - ordemPos[b.posicao] ||
    a.apelido.localeCompare(b.apelido, "pt-BR")
  );
  return (
    <div class="bf-pool">
      <div class="bf-pool__label">
        Reservas do elenco{" "}
        <span class="bf-pool__grupo-qtd">{atletas.length}</span>
      </div>
      <div class="bf-pool__row">
        {sorted.map((p) => {
          const desbotado = posicaoFiltro != null &&
            p.posicao !== posicaoFiltro;
          const hasCutout = !!p.foto &&
            (p.foto.includes("thesportsdb") || p.foto.includes("/atletas/"));
          const escudo = escudoUrl(p.clube);
          const status = statusInfo(p.statusId);
          return (
            <button
              type="button"
              class={`bf-pool__item bf-pool__item--${
                POS_ABREV[p.posicao].toLowerCase()
              } ${p.atleta_id === selecionado ? "bf-pool__item--sel" : ""} ${
                desbotado ? "bf-pool__item--desbotado" : ""
              }`}
              key={p.atleta_id}
              onClick={() => onSelect(p.atleta_id)}
              data-atleta-id={p.atleta_id}
            >
              {escudo && (
                <img
                  class="bf-pool__badge bf-pool__badge--escudo"
                  src={escudo}
                  alt=""
                />
              )}
              {status && (
                <span
                  class="bf-pool__badge bf-pool__badge--status"
                  style={{ "--st-color": status.cor } as Record<string, string>}
                  title={status.title}
                  aria-label={status.title}
                >
                  {status.sym}
                </span>
              )}
              {hasCutout
                ? (
                  <img
                    class="bf-pool__face"
                    src={p.foto!}
                    alt=""
                    loading="lazy"
                  />
                )
                : (
                  <div class="bf-pool__face bf-pool__face--placeholder">
                    <span class="bf-pool__face-initial">
                      {p.apelido.charAt(0)}
                    </span>
                  </div>
                )}
              <span class="bf-pool__pos">{POS_ABREV[p.posicao]}</span>
              <span class="bf-pool__name">{p.apelido}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
