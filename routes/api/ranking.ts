import { Handlers } from "$fresh/server.ts";
import { getAllElencos, getRodadaStatus } from "../../lib/kv.ts";
import { calcularMelhorTime } from "../../lib/substituicao.ts";

const H = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

export const handler: Handlers = {
  async GET() {
    try {
      const kv = await Deno.openKv();
      const [elencos, rodada] = await Promise.all([
        getAllElencos(kv),
        getRodadaStatus(kv),
      ]);

      if (Object.keys(elencos).length === 0) {
        return new Response(JSON.stringify(null), { headers: H });
      }

      const times = Object.values(elencos).map((elenco) => {
        const todos = Object.values(elenco.jogadores);
        const comSub = calcularMelhorTime(todos);

        const jogadores = comSub.map((j) => ({
          atleta_id:       j.atleta_id,
          nome:            j.apelido_api,
          posicao:         j.posicao,
          pontuacao:       j.pontos ?? 0,
          escalacao:       j.escalacao,
          status_id:       j.status_id,
          clube:           j.clube,
          substituido:     j.substituido,
          entrou_em_campo: j.entrou_em_campo,
          clube_casa:      j.clube_casa,
          clube_fora:      j.clube_fora,
        }));

        const pontuacao = Math.round(
          jogadores
            .filter((j) => j.escalacao === "Sim")
            .reduce((s, j) => s + j.pontuacao, 0) * 100,
        ) / 100;

        return {
          nome:      elenco.nome_time,
          dono:      elenco.dono,
          chave:     elenco.chave,
          pontuacao,
          jogadores,
        };
      });

      return new Response(
        JSON.stringify({
          rodada:      rodada?.rodada ?? 0,
          atualizadoEm: rodada?.atualizadoEm ?? new Date().toISOString(),
          status:      rodada?.status ?? "aguardando",
          fechamento:  rodada?.fechamento,
          times,
        }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ erro: String(e) }), { status: 500, headers: H });
    }
  },
};
