// Reset manual de pontos+entrou_em_campo de todos os jogadores dos
// elencos. Usado quando a virada de rodada deixou dados stale por
// causa de bug/race no cron.

import { Handlers } from "$fresh/server.ts";
import { getAllElencos, setElenco } from "../../../lib/kv.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers<unknown, State> = {
  async POST(_req, ctx) {
    if (ctx.state.session?.role !== "admin") {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só admin" }),
        { status: 403, headers: H },
      );
    }
    const elencos = await getAllElencos();
    let atletasResetados = 0;
    for (const [chave, elenco] of Object.entries(elencos)) {
      let alterado = false;
      for (const [id, j] of Object.entries(elenco.jogadores)) {
        if (j.pontos === null && j.entrou_em_campo === null) continue;
        elenco.jogadores[id] = {
          ...j,
          pontos: null,
          entrou_em_campo: null,
        };
        alterado = true;
        atletasResetados++;
      }
      if (alterado) await setElenco(chave, elenco);
    }
    return new Response(
      JSON.stringify({ ok: true, atletasResetados }),
      { headers: H },
    );
  },
};
