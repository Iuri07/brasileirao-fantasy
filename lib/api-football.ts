// API-Football (api-sports.io) — fotos reais de jogadores.
// Free tier: 100 requests/dia. Brasileirão Série A = league_id 71.
//
// Auth: header x-apisports-key (subscription direta) ou x-rapidapi-key
// (via marketplace RapidAPI). Tentamos a chave nos dois headers — uma
// das duas vai funcionar dependendo de onde o user assinou.
//
// Estratégia de sync: 1 request por time (max 20) busca squad inteiro
// com URL da foto por jogador. Bem mais barato que searchplayers
// individualmente.

const BASE = "https://v3.football.api-sports.io";

function headers(): HeadersInit {
  const key = Deno.env.get("API_FOOTBALL_KEY") ?? "";
  return {
    "x-apisports-key": key,
    "x-rapidapi-key": key,
    "x-rapidapi-host": "v3.football.api-sports.io",
  };
}

export interface AFTeam {
  id: number;
  name: string;
  logo: string;
}

export interface AFSquadPlayer {
  id: number;
  name: string;
  photo: string;
  number?: number;
  position?: string;
}

// Free tier do api-football só permite até 2024. Pra temporadas
// posteriores precisa do plano pago. 2024 ainda cobre a maioria dos
// jogadores do Brasileirão atual (transferências recentes não).
export async function fetchTeams(
  league = 71,
  season = 2024,
): Promise<AFTeam[]> {
  const r = await fetch(
    `${BASE}/teams?league=${league}&season=${season}`,
    { headers: headers() },
  );
  if (!r.ok) throw new Error(`api-football teams → ${r.status}`);
  const data = await r.json() as { response: Array<{ team: AFTeam }> };
  return (data.response ?? []).map((x) => x.team);
}

export async function fetchSquad(teamId: number): Promise<AFSquadPlayer[]> {
  const r = await fetch(`${BASE}/players/squads?team=${teamId}`, {
    headers: headers(),
  });
  if (!r.ok) throw new Error(`api-football squad ${teamId} → ${r.status}`);
  const data = await r.json() as {
    response: Array<{ players: AFSquadPlayer[] }>;
  };
  return data.response?.[0]?.players ?? [];
}

export function hasKey(): boolean {
  return !!Deno.env.get("API_FOOTBALL_KEY");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
