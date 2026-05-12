import type {
  CartolaAtleta,
  CartolaMercadoStatus,
  CartolaPontuadoAtleta,
} from "./types.ts";

const BASE = "https://api.cartola.globo.com";

export const POSICAO_ID_NOME: Record<number, string> = {
  1: "Goleiro",
  2: "Lateral",
  3: "Zagueiro",
  4: "Meia",
  5: "Atacante",
  6: "Técnico",
};

export const POSICAO_NOME_CHAVE: Record<string, string> = {
  "Goleiro": "GOL",
  "Lateral": "LAT",
  "Zagueiro": "ZAG",
  "Meia": "MEI",
  "Atacante": "ATA",
  "Técnico": "TEC",
};

async function fetchCartola<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 CartolaMiniApp/1.0" },
  });
  if (!r.ok) throw new Error(`Cartola ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export function fetchMercadoStatus(): Promise<CartolaMercadoStatus> {
  return fetchCartola("/mercado/status");
}

export function fetchAtletasMercado(): Promise<{
  atletas: CartolaAtleta[];
  clubes: Record<
    string,
    { nome: string; abreviacao: string; nome_fantasia?: string }
  >;
  posicoes: Record<string, { nome: string; abreviacao: string }>;
  rodada_atual: number;
}> {
  return fetchCartola("/atletas/mercado");
}

export function fetchAtletasPontuados(): Promise<{
  atletas: Record<string, CartolaPontuadoAtleta>;
  rodada_id: number;
}> {
  return fetchCartola("/atletas/pontuados");
}

export interface CartolaPartida {
  partida_id: number;
  clube_casa_id: number;
  clube_visitante_id: number;
  partida_data: string; // "YYYY-MM-DD HH:MM:SS"
  timestamp: number; // Unix seconds
  placar_oficial_mandante: number | null;
  placar_oficial_visitante: number | null;
  local: string;
  status_transmissao_tr: string; // "AGENDADA" | "EM ANDAMENTO" | "ENCERRADA" | ...
  valida: boolean;
}

export interface CartolaClube {
  abreviacao: string;
  nome?: string;
  nome_fantasia?: string;
  escudos?: Record<string, string>;
}

export function fetchPartidas(): Promise<{
  partidas: CartolaPartida[];
  clubes: Record<string, CartolaClube>;
  rodada?: number;
}> {
  return fetchCartola("/partidas");
}

export function fetchPartidasRodada(rodada: number) {
  return fetchCartola<{
    partidas: CartolaPartida[];
    clubes: Record<string, CartolaClube>;
    rodada?: number;
  }>(`/partidas/${rodada}`);
}
