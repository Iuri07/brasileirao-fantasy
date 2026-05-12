import { useEffect, useRef, useState } from "preact/hooks";
import { CampoFutebol } from "../components/CampoFutebol.tsx";

function BolaPNG({ size, corTime }: { size: number; corTime: string }) {
  return (
    <span
      style={`display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;background:${corTime}`}
    >
      <img
        src="https://cdn.jsdelivr.net/gh/Ian-costermani/brasileirao-fantasy@master/static/bola.png"
        alt=""
        style="width:100%;height:100%;object-fit:cover;mix-blend-mode:multiply;display:block;"
      />
    </span>
  );
}

interface Jogador {
  atleta_id: number;
  nome: string;
  posicao: string;
  pontuacao: number;
  escalacao: "Sim" | "Banco" | "Não";
  escalacao_elenco: "Sim" | "Banco" | "Não";
  status_id: number | null;
  clube: string;
  substituido: boolean;
  entrou_em_campo: boolean | null;
  clube_casa: string | null;
  clube_fora: string | null;
}

interface Time {
  nome: string;
  dono: string;
  chave: string;
  pontuacao: number;
  jogadores: Jogador[];
}

interface RodadaDados {
  rodada: number;
  atualizadoEm: string;
  status: "aguardando" | "aguardando_inicio" | "ao_vivo";
  fechamento?: { dia: string; hora: string };
  times: Time[];
}

type Aba = "elenco" | "ao_vivo";

function statusInfo(id: number | null): { sym: string; cor: string } | null {
  switch (id) {
    case 7:
      return { sym: "✓", cor: "#00e676" };
    case 2:
      return { sym: "?", cor: "#ef4444" };
    case 3:
      return { sym: "✕", cor: "#ef4444" };
    case 5:
      return { sym: "✚", cor: "#ef4444" };
    case 6:
      return { sym: "−", cor: "#9ca3af" };
    default:
      return null;
  }
}

const POSICAO_ORDEM: Record<string, number> = {
  "Goleiro": 0,
  "Zagueiro": 1,
  "Lateral": 2,
  "Meia": 3,
  "Atacante": 4,
  "Técnico": 5,
};

const POSICAO_CSS: Record<string, string> = {
  "Goleiro": "gol",
  "Zagueiro": "zag",
  "Lateral": "lat",
  "Meia": "mei",
  "Atacante": "atk",
  "Técnico": "tec",
};

const POSICAO_ABREV: Record<string, string> = {
  "Goleiro": "GOL",
  "Zagueiro": "ZAG",
  "Lateral": "LAT",
  "Meia": "MEI",
  "Atacante": "ATK",
  "Técnico": "TEC",
};

const CORES_TIMES: Record<string, string> = {
  "FILHOS DE KIEZA": "#FF1032",
  "BOTAFOFO FR": "#FF6A00",
  "MALVADINHOS FC": "#FF8C00",
  "CHUTOCA FC": "#FFD400",
  "BENDERMEM 23": "#7CFF00",
  "888 PARTNERS": "#00A2FF",
  "TODOS COM BOLSONARO": "#0066FF",
  "PIRATAS DO CARILLE": "#C000FF",
  "DORIVAL JUNIORS": "#FF007A",
};

const ORDEM_ELENCO: Record<string, number> = {
  "FILHOS DE KIEZA": 0,
  "BOTAFOFO FR": 1,
  "MALVADINHOS FC": 2,
  "CHUTOCA FC": 3,
  "BENDERMEM 23": 4,
  "888 PARTNERS": 5,
  "TODOS COM BOLSONARO": 6,
  "PIRATAS DO CARILLE": 7,
  "DORIVAL JUNIORS": 8,
};

const NOMES_ELENCO: Record<string, string> = {
  "MALVADINHOS FC": "Ilha de Paquetá",
  "CHUTOCA FC": "Crefilho da Gama",
  "TODOS COM BOLSONARO": "Moleicester City",
  "PIRATAS DO CARILLE": "Papai Chegou FC",
  "DORIVAL JUNIORS": "Pedro Álvares Pardal",
};

const CDN_TIMES =
  "https://cdn.jsdelivr.net/gh/Ian-costermani/brasileirao-fantasy@master/static/times_escudos";
const ESCUDOS_TIMES: Record<string, string> = {
  "FILHOS DE KIEZA": `${CDN_TIMES}/filhos-de-kieza.png`,
  "BOTAFOFO FR": `${CDN_TIMES}/botafofo.png`,
  "MALVADINHOS FC": `${CDN_TIMES}/ilha-de-paqueta.png`,
  "CHUTOCA FC": `${CDN_TIMES}/crefilho-da-gama.png`,
  "BENDERMEM 23": `${CDN_TIMES}/bendermem.png`,
  "888 PARTNERS": `${CDN_TIMES}/888-partners.png`,
  "TODOS COM BOLSONARO": `${CDN_TIMES}/moleicester-city.png`,
  "PIRATAS DO CARILLE": `${CDN_TIMES}/papai-chegou.png`,
  "DORIVAL JUNIORS": `${CDN_TIMES}/pedro-alvares-pardal.png`,
};

const INTERVALO_POLLING = 2 * 60 * 1000;

interface BuscaResultado {
  atleta_id: number;
  apelido: string;
  clube: string;
  posicao: string;
}

function PainelGerenciamento(
  { jogadores, chave, onAtualizar, onEscalacao }: {
    jogadores: Jogador[];
    chave: string;
    onAtualizar: () => void;
    onEscalacao: (atletaId: number, escalacao: "Sim" | "Banco" | "Não") => void;
  },
) {
  const [trocando, setTrocando] = useState<
    {
      atletaId: number;
      posicao: string;
      escalacaoAtual: "Sim" | "Banco" | "Não";
    } | null
  >(null);
  const [buscaQ, setBuscaQ] = useState("");
  const [resultados, setResultados] = useState<BuscaResultado[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!buscaQ.trim() || !trocando) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(
          `/api/atletas/buscar?q=${encodeURIComponent(buscaQ)}&posicao=${
            encodeURIComponent(trocando.posicao)
          }`,
        );
        setResultados(await r.json());
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [buscaQ, trocando]);

  const trocarJogador = async (novoAtletaId: number) => {
    if (!trocando) return;
    const resp = await fetch(`/api/elenco/${chave}/jogador/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        atleta_id_sai: trocando.atletaId,
        atleta_id_entra: novoAtletaId,
        escalacao: trocando.escalacaoAtual,
      }),
    });
    const json = await resp.json();
    if (!json.ok) {
      alert(json.erro);
      return;
    }
    setTrocando(null);
    setBuscaQ("");
    setResultados([]);
    onAtualizar();
  };

  const fecharTroca = () => {
    setTrocando(null);
    setBuscaQ("");
    setResultados([]);
  };

  const ordenados = [...jogadores].sort(
    (a, b) => (POSICAO_ORDEM[a.posicao] ?? 6) - (POSICAO_ORDEM[b.posicao] ?? 6),
  );

  const grupos: { posicao: string; jogadores: Jogador[] }[] = [];
  for (const j of ordenados) {
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.posicao !== j.posicao) {
      grupos.push({ posicao: j.posicao, jogadores: [j] });
    } else ultimo.jogadores.push(j);
  }

  return (
    <div class="elenco-mgmt" onClick={(e) => e.stopPropagation()}>
      <div class="elenco-mgmt-titulo">Gerenciar Elenco</div>
      {grupos.map(({ posicao, jogadores: jogs }, gi) => (
        <div key={posicao} class="mgmt-posicao-grupo">
          <div class={`mgmt-posicao-sep${gi === 0 ? " primeiro" : ""}`}>
            {posicao}
          </div>
          {jogs.map((j) => (
            <div key={j.atleta_id}>
              <div class="mgmt-jogador">
                <div class="mgmt-jogador-info">
                  <span class="mgmt-jogador-nome">{j.nome}</span>
                  {(() => {
                    const si = statusInfo(j.status_id);
                    return si && (
                      <span class="mgmt-status-sym" style={`color:${si.cor}`}>
                        {si.sym}
                      </span>
                    );
                  })()}
                  {j.clube_casa && j.clube_fora && (
                    <span class="mgmt-partida">
                      {j.clube_casa} X {j.clube_fora}
                    </span>
                  )}
                </div>
                <div class="mgmt-esc-btns">
                  {(["Sim", "Banco", "Não"] as const).map((esc) => (
                    <button
                      key={esc}
                      class={`mgmt-esc-btn${
                        j.escalacao === esc
                          ? ` ativo-${
                            esc === "Não" ? "nao" : esc.toLowerCase()
                          }`
                          : ""
                      }`}
                      onClick={() => onEscalacao(j.atleta_id, esc)}
                    >
                      {esc === "Sim" ? "S" : esc === "Banco" ? "B" : "N"}
                    </button>
                  ))}
                </div>
                <button
                  class="mgmt-trocar-btn"
                  onClick={() => {
                    setTrocando({
                      atletaId: j.atleta_id,
                      posicao: j.posicao,
                      escalacaoAtual: j.escalacao,
                    });
                    setBuscaQ("");
                    setResultados([]);
                  }}
                >
                  Trocar
                </button>
              </div>
              {trocando?.atletaId === j.atleta_id && (
                <div class="swap-panel">
                  <input
                    class="swap-search"
                    type="text"
                    placeholder={`Buscar ${j.posicao.toLowerCase()}...`}
                    value={buscaQ}
                    // deno-lint-ignore no-explicit-any
                    onInput={(e) => setBuscaQ((e.target as any).value)}
                    autoFocus
                  />
                  {buscando && <div class="swap-buscando">Buscando...</div>}
                  {resultados.map((r) => (
                    <div
                      key={r.atleta_id}
                      class="swap-resultado"
                      onClick={() => trocarJogador(r.atleta_id)}
                    >
                      <span>{r.apelido}</span>
                      <span class="swap-resultado-clube">{r.clube}</span>
                    </div>
                  ))}
                  <button class="swap-cancel-btn" onClick={fecharTroca}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Ranking() {
  const [dados, setDados] = useState<RodadaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("elenco");
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [ultimaVerificacao, setUltimaVerificacao] = useState<Date | null>(null);
  const [minutosAtras, setMinutosAtras] = useState(0);
  const abaInicializada = useRef(false);

  const buscarDados = async () => {
    try {
      const resposta = await fetch("/api/ranking");
      const json: RodadaDados | null = await resposta.json();
      if (json) {
        json.times = json.times.map((t) => ({ ...t, nome: t.nome.trim() }));
        setDados(json);
        if (!abaInicializada.current) {
          setAba(json.status !== "ao_vivo" ? "elenco" : "ao_vivo");
          abaInicializada.current = true;
        }
      }
      setUltimaVerificacao(new Date());
    } catch (erro) {
      console.error("Erro ao buscar ranking:", erro);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    buscarDados();
    const intervalo = setInterval(buscarDados, INTERVALO_POLLING);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    const calcular = () => {
      if (!ultimaVerificacao) return;
      setMinutosAtras(
        Math.floor((Date.now() - ultimaVerificacao.getTime()) / 60_000),
      );
    };
    calcular();
    const timer = setInterval(calcular, 30_000);
    return () => clearInterval(timer);
  }, [ultimaVerificacao]);

  const mudarEscalacaoTime = (
    chave: string,
    atletaId: number,
    escalacao: "Sim" | "Banco" | "Não",
  ) => {
    setDados((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        times: prev.times.map((t) =>
          t.chave !== chave ? t : {
            ...t,
            jogadores: t.jogadores.map((j) =>
              j.atleta_id !== atletaId
                ? j
                : { ...j, escalacao, escalacao_elenco: escalacao }
            ),
          }
        ),
      };
    });
    fetch(`/api/elenco/${chave}/escalacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atleta_id: atletaId, escalacao }),
    }).catch(console.error);
  };

  const toggleExpandir = (index: number) => {
    setExpandidos((prev) => {
      const novo = new Set(prev);
      novo.has(index) ? novo.delete(index) : novo.add(index);
      return novo;
    });
  };

  const textoAtualizacao = () => {
    if (!ultimaVerificacao) return "";
    if (minutosAtras === 0) return "Verificado agora";
    if (minutosAtras === 1) return "Verificado há 1 min";
    return `Verificado há ${minutosAtras} min`;
  };

  if (carregando) {
    return (
      <div class="loading">
        <div class="loading-spinner" />
        <p>Carregando dados da rodada...</p>
      </div>
    );
  }

  const tabBar = (
    <div class="tab-bar">
      <button
        class={`tab-btn${aba === "elenco" ? " tab-ativa" : ""}`}
        onClick={() => {
          setAba("elenco");
          setExpandidos(new Set());
        }}
      >
        <BolaPNG size={13} corTime="#00FF88" />
        Elenco
      </button>
      <button
        class={`tab-btn${aba === "ao_vivo" ? " tab-ativa" : ""}`}
        onClick={() => {
          setAba("ao_vivo");
          setExpandidos(new Set());
        }}
      >
        <span class="tab-dot-ao-vivo" />
        Ao Vivo
      </button>
    </div>
  );

  if (!dados) {
    return (
      <div class="ranking-container">
        {tabBar}
        <div class="sem-dados">
          <BolaPNG size={52} corTime="#00FF88" />
          <h2>Aguardando início da rodada...</h2>
          <p>Os dados aparecerão aqui assim que a rodada começar.</p>
          <button class="btn-atualizar" onClick={buscarDados}>
            Verificar agora
          </button>
        </div>
      </div>
    );
  }

  const preRodada = dados.status !== "ao_vivo";
  const modoElenco = aba === "elenco";

  const timesSorted = [...dados.times].sort((a, b) =>
    modoElenco
      ? (ORDEM_ELENCO[a.nome] ?? 99) - (ORDEM_ELENCO[b.nome] ?? 99)
      : b.pontuacao - a.pontuacao
  );

  const aoVivoSemRodada = aba === "ao_vivo" && preRodada;

  const rodadaBadge = modoElenco
    ? <span class="rodada-badge rodada-badge-pre">Elenco</span>
    : dados.status === "ao_vivo"
    ? <span class="rodada-badge">Rodada {dados.rodada}</span>
    : dados.fechamento
    ? (
      <span class="rodada-badge rodada-badge-pre">
        Fecha {dados.fechamento.dia} {dados.fechamento.hora}
      </span>
    )
    : <span class="rodada-badge rodada-badge-pre">Aguardando</span>;

  return (
    <div class="ranking-container">
      {tabBar}

      <div class="rodada-info">
        {rodadaBadge}
        <span class="atualizacao-info">{textoAtualizacao()}</span>
      </div>

      {aoVivoSemRodada && (
        <div class="sem-dados">
          <BolaPNG size={52} corTime="#00FF88" />
          <h2>Rodada ainda não começou</h2>
          {dados.fechamento
            ? (
              <p>
                Fechamento: {dados.fechamento.dia} às {dados.fechamento.hora}
              </p>
            )
            : <p>O ranking aparecerá aqui assim que os jogos começarem.</p>}
        </div>
      )}

      {!aoVivoSemRodada && (
        <div class="times-lista">
          {timesSorted.map((time, index) => (
            <div
              key={`${time.nome}-${index}`}
              class={`time-card${
                !modoElenco && index === 0 ? " primeiro-lugar" : ""
              }${expandidos.has(index) ? " expandido" : ""}`}
              style={`--cor-time: ${CORES_TIMES[time.nome] ?? "#10b981"}`}
            >
              <div
                class="time-header"
                onClick={() => toggleExpandir(index)}
                role="button"
                tabIndex={0}
                aria-expanded={expandidos.has(index)}
              >
                <div class="posicao-wrapper">
                  <span class="posicao">
                    {modoElenco
                      ? (
                        <img
                          src={ESCUDOS_TIMES[time.nome]}
                          alt=""
                          class="posicao-escudo"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style
                              .display = "none";
                          }}
                        />
                      )
                      : index === 0
                      ? "🏆"
                      : `#${index + 1}`}
                  </span>
                </div>

                <div class="time-info">
                  <span class="time-nome">
                    {NOMES_ELENCO[time.nome] ?? time.nome}
                    {!modoElenco && ESCUDOS_TIMES[time.nome] && (
                      <img
                        src={ESCUDOS_TIMES[time.nome]}
                        alt=""
                        class="time-nome-escudo"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    )}
                  </span>
                  <span class="time-dono">{time.dono}</span>
                </div>

                {!modoElenco && (
                  <div class="pontuacao-wrapper">
                    <span class="pontuacao">{time.pontuacao.toFixed(2)}</span>
                    <span class="pontuacao-label">pts</span>
                  </div>
                )}

                <span class="expandir-icone" aria-hidden>
                  {expandidos.has(index) ? "▲" : "▼"}
                </span>
              </div>

              {expandidos.has(index) && (
                <>
                  <CampoFutebol
                    jogadores={modoElenco
                      ? time.jogadores.map((j) => ({
                        ...j,
                        escalacao: j.escalacao_elenco,
                      }))
                      : time.jogadores}
                    modoAoVivo={aba === "ao_vivo"}
                    corTime={CORES_TIMES[time.nome]}
                    escudo={ESCUDOS_TIMES[time.nome]}
                  />
                  {modoElenco && (
                    <PainelGerenciamento
                      jogadores={time.jogadores.map((j) => ({
                        ...j,
                        escalacao: j.escalacao_elenco,
                      }))}
                      chave={time.chave}
                      onAtualizar={buscarDados}
                      onEscalacao={(atletaId, escalacao) =>
                        mudarEscalacaoTime(time.chave, atletaId, escalacao)}
                    />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
