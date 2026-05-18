#!/usr/bin/env -S deno run -A --unstable-kv

import type { ElencoKV, JogadorKV } from "../lib/types.ts";
import { DONOS_CHAVES } from "../lib/kv.ts";

// posicao_id correto conforme a API do Cartola (de_para_jogadores pode ter erros)
const POSICAO_ID: Record<string, number> = {
  "Goleiro":  1,
  "Lateral":  2,
  "Zagueiro": 3,
  "Meia":     4,
  "Atacante": 5,
  "Técnico":  6,
};

const arquivo = new URL("../static/de_para_jogadores.json", import.meta.url);
const raw = await Deno.readTextFile(arquivo);
const dados = JSON.parse(raw) as {
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

const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);

for (const time of dados.times) {
  const chave = DONOS_CHAVES[time.dono];
  if (!chave) {
    console.warn(`Dono não mapeado: ${time.dono}`);
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
  console.log(`✓ ${time.nome_time} (${chave}) — ${Object.keys(jogadores).length} jogadores`);
}

kv.close();
console.log("Seed concluído.");
