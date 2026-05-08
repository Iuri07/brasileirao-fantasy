export interface JogadorKV {
  // Estáticos (seed)
  atleta_id: number;
  apelido_api: string;
  clube: string;
  clube_id: number;
  posicao: string;
  posicao_id: number;
  escalacao: "Sim" | "Banco" | "Não";
  // Dinâmicos – cron de status
  status_id: number | null;
  provavel: boolean | null;
  lesionado: boolean | null;
  suspenso: boolean | null;
  nulo: boolean | null;
  entrou_em_campo: boolean | null;
  clube_casa: string | null;
  clube_fora: string | null;
  // Dinâmico – cron ao vivo
  pontos: number | null;
}

export interface ElencoKV {
  nome_time: string;
  dono: string;
  chave: string;
  jogadores: Record<string, JogadorKV>;
}

export interface AtletaCacheEntry {
  apelido: string;
  clube: string;
  clube_id: number;
  posicao: string;
  posicao_id: number;
}

export interface AtletaCacheKV {
  atualizadoEm: string;
  atletas: Record<string, AtletaCacheEntry>;
}

export interface RodadaStatus {
  status: "aguardando" | "aguardando_inicio" | "ao_vivo";
  rodada: number;
  atualizadoEm?: string;
  fechamento?: { dia: string; hora: string };
}

// Cartola API
export interface CartolaMercadoStatus {
  status_mercado: number; // 1 = fechado, 2 = aberto
  rodada_atual: number;
  fechamento: { dia: string; hora: string };
}

export interface CartolaAtleta {
  atleta_id: number;
  apelido: string;
  clube_id: number;
  posicao_id: number;
  status_id: number | null;
  pontos_num: number;
  entrou_em_campo: boolean;
}

export interface CartolaPontuadoAtleta {
  atleta_id: number;
  pontuacao: number;
  entrou_em_campo: boolean;
}
