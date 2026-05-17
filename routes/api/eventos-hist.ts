import { Handlers } from "$fresh/server.ts";
import { getRodadaStatus } from "../../lib/kv.ts";
import { listarEventos } from "../../lib/eventos-hist.ts";

const H = { "Content-Type": "application/json" };

/** Retorna histórico de eventos chave (gol, cartão, defesa, etc.)
 *  detectado pelo cron via diff de scout Cartola. Sobrevive reload
 *  e cobre desde o início da rodada (não só a sessão do usuário). */
export const handler: Handlers = {
  async GET(req) {
    const url = new URL(req.url);
    const rodadaParam = url.searchParams.get("rodada");
    const kv = await Deno.openKv();
    let rodada = rodadaParam ? Number(rodadaParam) : 0;
    if (!rodada) {
      const status = await getRodadaStatus(kv);
      rodada = status?.rodada ?? 0;
    }
    if (!rodada) {
      return new Response(
        JSON.stringify({ ok: true, rodada: 0, eventos: [] }),
        { headers: H },
      );
    }
    const eventos = await listarEventos(kv, rodada, 200);
    const resp = new Response(
      JSON.stringify({ ok: true, rodada, eventos }),
      { headers: H },
    );
    // Pode ser cacheado por 20s no cliente — cron roda a cada 5min
    // mas o usuário polla mais frequente; um pouco de cache reduz
    // duplicação sem perder fresh data.
    resp.headers.set("Cache-Control", "public, max-age=20");
    return resp;
  },
};
