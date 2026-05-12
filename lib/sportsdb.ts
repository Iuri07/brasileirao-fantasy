// TheSportsDB lookup pra fotos REAIS de jogadores (a Cartola só serve
// silhuetas atualmente). Free tier sem chave (key "3").
//
// API: https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p={nome}
// Rate-limit conservador (~30 req/min na free), por isso o caller deve
// throttling com sleep entre chamadas.

const BASE = "https://www.thesportsdb.com/api/v1/json/3";

interface SportsDBPlayer {
  strPlayer: string;
  strTeam: string;
  strThumb: string | null;
  strCutout: string | null;
}

/**
 * Busca foto de um jogador. Tenta filtrar por time pra desambiguar
 * "Gabriel" / "Pedro" / "Hulk" etc. Retorna a melhor URL disponível
 * ou null se não encontrou.
 *
 * Preference: strCutout (transparente, recortado) > strThumb (com bg).
 */
export async function fetchPlayerPhoto(
  apelido: string,
  clube: string,
): Promise<string | null> {
  try {
    const url = `${BASE}/searchplayers.php?p=${encodeURIComponent(apelido)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 BFFantasy/1.0" },
    });
    if (!r.ok) return null;
    const data = await r.json() as { player?: SportsDBPlayer[] };
    const players = data.player ?? [];
    if (!players.length) return null;

    // Tenta dar match por time (normalizado), senão pega o primeiro
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const target = norm(clube);
    const matched = players.find((p) =>
      target && norm(p.strTeam ?? "").includes(target.split(" ")[0])
    );
    const chosen = matched ?? players[0];
    return chosen.strCutout || chosen.strThumb || null;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
