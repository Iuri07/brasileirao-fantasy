import { Handlers } from "$fresh/server.ts";
import { getAtletasCache, POSICAO_CHAVES_CACHE } from "../../../lib/kv.ts";
import { POSICAO_NOME_CHAVE } from "../../../lib/cartola.ts";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const handler: Handlers = {
  async GET(req) {
    const url = new URL(req.url);
    const q       = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const posicao = url.searchParams.get("posicao") ?? "";

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const chaves = posicao && POSICAO_NOME_CHAVE[posicao]
      ? [POSICAO_NOME_CHAVE[posicao]]
      : POSICAO_CHAVES_CACHE;

    const resultados: Array<{ atleta_id: number; apelido: string; clube: string; posicao: string }> = [];

    for (const posChave of chaves) {
      const cache = await getAtletasCache(kv, posChave);
      if (!cache) continue;
      for (const [id, a] of Object.entries(cache.atletas)) {
        if (!q || a.apelido.toLowerCase().includes(q) || a.clube.toLowerCase().includes(q)) {
          resultados.push({ atleta_id: Number(id), apelido: a.apelido, clube: a.clube, posicao: a.posicao });
        }
      }
    }

    return new Response(JSON.stringify(resultados.slice(0, 50)), { headers: H });
  },
};
