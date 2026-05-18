import { Handlers } from "$fresh/server.ts";
import {
  getElenco,
  getRodadaStatus,
  getSubsUsadas,
  incrementSubsUsadas,
  isRodadaEmAndamento,
  MAX_SUBS_AO_VIVO,
  setElenco,
  TODAS_CHAVES,
} from "../../../../lib/kv.ts";
import type { State } from "../../../_middleware.ts";

const H = { "Content-Type": "application/json" };

interface Body {
  /** Primeiro atleta da troca */
  atleta_id_sai: number;
  /** Segundo atleta — assume a escalação do primeiro */
  atleta_id_entra: number;
}

/**
 * Troca a categoria de escalação (Sim/Banco/Não) entre 2 atletas do mesmo
 * elenco. Os dois trocam de categoria entre si (rearranjo dentro dos 26 fixos).
 *
 * Restrições:
 * - Ambos devem pertencer ao elenco
 * - Categorias devem ser diferentes
 * - Mesma posição (Goleiro com Goleiro, Lateral com Lateral, etc.)
 * - Se bola_rolando (ao vivo): limite de 3 substituições/rodada quando a
 *   troca envolve a escala (Sim ↔ Banco)
 */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    const chave = ctx.params.dono.toLowerCase();
    if (!TODAS_CHAVES.includes(chave)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Time não encontrado" }),
        { status: 404, headers: H },
      );
    }
    // Só dono ou admin
    const session = ctx.state.session;
    const isAdmin = session?.role === "admin";
    const isDono = session?.chave === chave;
    if (!isAdmin && !isDono) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Só o dono do time (ou admin)" }),
        { status: 403, headers: H },
      );
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: H },
      );
    }

    if (!body.atleta_id_sai || !body.atleta_id_entra) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "atleta_id_sai e atleta_id_entra obrigatórios",
        }),
        { status: 400, headers: H },
      );
    }

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const elenco = await getElenco(kv, chave);
    if (!elenco) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Elenco não encontrado" }),
        { status: 404, headers: H },
      );
    }

    const idSai = String(body.atleta_id_sai);
    const idEntra = String(body.atleta_id_entra);
    const sai = elenco.jogadores[idSai];
    const entra = elenco.jogadores[idEntra];

    if (!sai || !entra) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Atletas devem estar no elenco",
        }),
        { status: 400, headers: H },
      );
    }
    if (sai.escalacao === entra.escalacao) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro:
            "Atletas precisam estar em categorias diferentes (Sim/Banco/Não)",
        }),
        { status: 400, headers: H },
      );
    }

    // Compatibilidade posicional: exata (Goleiro/Lateral/Zagueiro/Meia/Atacante)
    if (sai.posicao !== entra.posicao) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: `Posições incompatíveis: ${sai.posicao} ↔ ${entra.posicao}`,
        }),
        { status: 400, headers: H },
      );
    }

    // Modo ao vivo: limita substituições somente quando a troca afeta a
    // escala (alguém entra ou sai do "Sim"). Usa o KV (rodadaStatus) em
    // vez do Cartola direto — assim a simulação do admin também trava.
    const afetaEscala = sai.escalacao === "Sim" || entra.escalacao === "Sim";
    const rodadaStatus = await getRodadaStatus(kv);
    const aoVivo = isRodadaEmAndamento(rodadaStatus?.status);
    const rodadaAtual = rodadaStatus?.rodada ?? 0;
    let subsUsadas = 0;
    if (aoVivo && afetaEscala) {
      subsUsadas = await getSubsUsadas(kv, rodadaAtual, chave);
      if (subsUsadas >= MAX_SUBS_AO_VIVO) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro:
              `Limite de ${MAX_SUBS_AO_VIVO} substituições atingido nesta rodada`,
            subsUsadas,
            subsMax: MAX_SUBS_AO_VIVO,
          }),
          { status: 400, headers: H },
        );
      }
    }

    // Aplica a troca: trocam de categoria entre si
    elenco.jogadores[idSai] = { ...sai, escalacao: entra.escalacao };
    elenco.jogadores[idEntra] = { ...entra, escalacao: sai.escalacao };
    await setElenco(kv, chave, elenco);

    if (aoVivo && afetaEscala) {
      subsUsadas = await incrementSubsUsadas(kv, rodadaAtual, chave);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        aoVivo,
        subsUsadas,
        subsMax: MAX_SUBS_AO_VIVO,
        subsRestantes: aoVivo ? MAX_SUBS_AO_VIVO - subsUsadas : null,
      }),
      { headers: H },
    );
  },
};
