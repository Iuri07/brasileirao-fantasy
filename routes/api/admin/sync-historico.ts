import { Handlers } from "$fresh/server.ts";
import { fetchHistoricoFromSheet } from "../../../lib/sheets-sync.ts";

const H = { "Content-Type": "application/json" };

export const handler: Handlers = {
  /**
   * Sincroniza histórico de pontuação por rodada a partir da planilha
   * Google Sheets do Ian (n8n alimenta semanalmente). Sobrescreve
   * ["historico", chave] no KV pra cada dono mapeado.
   */
  async POST() {
    try {
      const { historico, donosNaoMapeados } = await fetchHistoricoFromSheet();
      const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
      let timesAtualizados = 0;
      let totalRodadas = 0;
      for (const [chave, rodadas] of Object.entries(historico)) {
        await kv.set(["historico", chave], rodadas);
        timesAtualizados++;
        totalRodadas += Object.keys(rodadas).length;
      }
      return new Response(
        JSON.stringify({
          ok: true,
          timesAtualizados,
          totalRodadas,
          donosNaoMapeados,
        }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
        status: 500,
        headers: H,
      });
    }
  },
};
