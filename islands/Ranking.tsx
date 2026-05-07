import { useEffect, useRef, useState } from "preact/hooks";
import { CampoFutebol } from "../components/CampoFutebol.tsx";

function BolaPNG({ size, corTime }: { size: number; corTime: string }) {
  return (
    <span style={`display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;background:${corTime}`}>
      <img src="/bola.png" alt="" style="width:100%;height:100%;object-fit:cover;mix-blend-mode:multiply;display:block;" />
    </span>
  );
}

interface Jogador {
  nome: string;
  posicao: string;
  pontuacao: number;
  escalacao: "Sim" | "Banco" | "Não";
  status?: string;
  clube?: string;
}

interface Time {
  nome: string;
  dono: string;
  pontuacao: number;
  jogadores: Jogador[];
}

interface RodadaDados {
  rodada: number;
  atualizadoEm: string;
  status?: string;
  times: Time[];
}

type Aba = "elenco" | "ao_vivo";

const POSICAO_CSS: Record<string, string> = {
  "Goleiro": "gol", "Zagueiro": "zag", "Lateral": "lat",
  "Meia": "mei", "Atacante": "atk", "Técnico": "tec",
};

const POSICAO_ABREV: Record<string, string> = {
  "Goleiro": "GOL", "Zagueiro": "ZAG", "Lateral": "LAT",
  "Meia": "MEI", "Atacante": "ATK", "Técnico": "TEC",
};


const CORES_TIMES: Record<string, string> = {
  "FILHOS DE KIEZA":     "#FF1032",
  "BOTAFOFO FR":         "#FF6A00",
  "MALVADINHOS FC":      "#FF8C00",
  "CHUTOCA FC":          "#FFD400",
  "BENDERMEM 23":        "#7CFF00",
  "888 PARTNERS":        "#00A2FF",
  "TODOS COM BOLSONARO": "#0066FF",
  "PIRATAS DO CARILLE":  "#C000FF",
  "DORIVAL JUNIORS":     "#FF007A",
};

const ORDEM_ELENCO: Record<string, number> = {
  "FILHOS DE KIEZA": 0, "BOTAFOFO FR": 1, "MALVADINHOS FC": 2,
  "CHUTOCA FC": 3, "BENDERMEM 23": 4, "888 PARTNERS": 5,
  "TODOS COM BOLSONARO": 6, "PIRATAS DO CARILLE": 7, "DORIVAL JUNIORS": 8,
};

const NOMES_ELENCO: Record<string, string> = {
  "MALVADINHOS FC":      "Ilha de Paquetá",
  "CHUTOCA FC":          "Crefilho da Gama",
  "TODOS COM BOLSONARO": "Moleicester City",
  "PIRATAS DO CARILLE":  "Papai Chegou FC",
  "DORIVAL JUNIORS":     "Pedro Álvares Pardal",
};

const INTERVALO_POLLING = 2 * 60 * 1000;

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
        // Define aba padrão apenas na primeira carga
        if (!abaInicializada.current) {
          setAba(json.status === "pre_rodada" ? "elenco" : "ao_vivo");
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
      setMinutosAtras(Math.floor((Date.now() - ultimaVerificacao.getTime()) / 60_000));
    };
    calcular();
    const timer = setInterval(calcular, 30_000);
    return () => clearInterval(timer);
  }, [ultimaVerificacao]);

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

  const classeEscalacao = (esc: string) => {
    if (esc === "Banco") return "esc-banco";
    if (esc === "Não") return "esc-nao";
    return "";
  };

  if (carregando) {
    return (
      <div class="loading">
        <div class="loading-spinner" />
        <p>Carregando dados da rodada...</p>
      </div>
    );
  }

  // Abas sempre visíveis — mesmo sem dados
  const tabBar = (
    <div class="tab-bar">
      <button
        class={`tab-btn${aba === "elenco" ? " tab-ativa" : ""}`}
        onClick={() => { setAba("elenco"); setExpandidos(new Set()); }}
      >
        <BolaPNG size={13} corTime="#00FF88" />
        Elenco
      </button>
      <button
        class={`tab-btn${aba === "ao_vivo" ? " tab-ativa" : ""}`}
        onClick={() => { setAba("ao_vivo"); setExpandidos(new Set()); }}
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
          <button class="btn-atualizar" onClick={buscarDados}>Verificar agora</button>
        </div>
      </div>
    );
  }

  const preRodada = dados.status === "pre_rodada";
  const modoElenco = aba === "elenco";

  // Ordena conforme a aba ativa
  const timesSorted = [...dados.times].sort((a, b) =>
    modoElenco
      ? (ORDEM_ELENCO[a.nome] ?? 99) - (ORDEM_ELENCO[b.nome] ?? 99)
      : b.pontuacao - a.pontuacao
  );

  // Aba "Ao Vivo" ainda sem dados de rodada
  const aoVivoSemRodada = aba === "ao_vivo" && preRodada;

  return (
    <div class="ranking-container">
      {tabBar}

      {/* Indicador de rodada / atualização */}
      <div class="rodada-info">
        {modoElenco
          ? <span class="rodada-badge rodada-badge-pre">Elenco</span>
          : preRodada
            ? <span class="rodada-badge rodada-badge-pre">Aguardando</span>
            : <span class="rodada-badge">Rodada {dados.rodada}</span>}
        <span class="atualizacao-info">{textoAtualizacao()}</span>
      </div>

      {/* Aba Ao Vivo sem rodada em andamento */}
      {aoVivoSemRodada && (
        <div class="sem-dados">
          <BolaPNG size={52} corTime="#00FF88" />
          <h2>Rodada ainda não começou</h2>
          <p>O ranking aparecerá aqui assim que os jogos começarem.</p>
        </div>
      )}

      {/* Lista de times */}
      {!aoVivoSemRodada && (
        <div class="times-lista">
          {timesSorted.map((time, index) => (
            <div
              key={`${time.nome}-${index}`}
              class={`time-card${!modoElenco && index === 0 ? " primeiro-lugar" : ""}${
                expandidos.has(index) ? " expandido" : ""
              }`}
              style={`--cor-time: ${CORES_TIMES[time.nome] ?? "#10b981"}`}
              onClick={() => toggleExpandir(index)}
              role="button"
              aria-expanded={expandidos.has(index)}
            >
              <div class="time-header">
                <div class="posicao-wrapper">
                  <span class="posicao">
                    {modoElenco
                      ? <BolaPNG size={18} corTime={CORES_TIMES[time.nome] ?? "#00FF88"} />
                      : index === 0 ? "🏆" : `#${index + 1}`}
                  </span>
                </div>

                <div class="time-info">
                  <span class="time-nome">
                    {!modoElenco && (
                      <BolaPNG size={10} corTime={CORES_TIMES[time.nome] ?? "#00FF88"} />
                    )}
                    {modoElenco
                      ? (NOMES_ELENCO[time.nome] ?? time.nome)
                      : time.nome}
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
                <CampoFutebol
                  jogadores={time.jogadores}
                  modoAoVivo={aba === "ao_vivo"}
                  corTime={CORES_TIMES[time.nome]}
                                  />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
