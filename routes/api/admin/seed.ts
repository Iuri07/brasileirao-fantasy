import { Handlers } from "$fresh/server.ts";
import type { ElencoKV, JogadorKV } from "../../../lib/types.ts";
import { DONOS_CHAVES } from "../../../lib/kv.ts";
import dados from "../../../static/de_para_jogadores.json" with { type: "json" };

const H = { "Content-Type": "application/json" };

const POSICAO_ID: Record<string, number> = {
  "Goleiro":  1,
  "Lateral":  2,
  "Zagueiro": 3,
  "Meia":     4,
  "Atacante": 5,
  "Técnico":  6,
};

type DadosJSON = {
  times: Array<{
    dono: string;
    nome_time: string;
    jogadores: Array<{
      atleta_id: number;
      apelido_api: string;
      clube: string;
      clube_id: number;
      posicao: string;
      posicao_id: number;
      escalacao: "Sim" | "Banco" | "Não";
    }>;
  }>;
};

export const handler: Handlers = {
  async POST() {
    try {
      const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
      const resultados: string[] = [];
      const typed = dados as DadosJSON;

      for (const time of typed.times) {
        const chave = DONOS_CHAVES[time.dono];
        if (!chave) {
          resultados.push(`SKIP: dono não mapeado — ${time.dono}`);
          continue;
        }

        const jogadores: Record<string, JogadorKV> = {};
        for (const j of time.jogadores) {
          jogadores[String(j.atleta_id)] = {
            atleta_id:       j.atleta_id,
            apelido_api:     j.apelido_api,
            clube:           j.clube,
            clube_id:        j.clube_id,
            posicao:         j.posicao,
            posicao_id:      POSICAO_ID[j.posicao] ?? j.posicao_id,
            escalacao:       j.escalacao,
            status_id:       null,
            provavel:        null,
            lesionado:       null,
            suspenso:        null,
            nulo:            null,
            entrou_em_campo: null,
            clube_casa:      null,
            clube_fora:      null,
            pontos:          null,
          };
        }

        const elenco: ElencoKV = {
          nome_time: time.nome_time,
          dono:      time.dono,
          chave,
          jogadores,
        };

        await kv.set(["elenco", chave], elenco);
        resultados.push(`OK: ${time.nome_time} (${chave}) — ${Object.keys(jogadores).length} jogadores`);
      }

      return new Response(
        JSON.stringify({ ok: true, resultados }),
        { headers: H },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: H });
    }
  },
};
