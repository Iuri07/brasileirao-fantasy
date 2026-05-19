import { Handlers } from "$fresh/server.ts";
import { appStateGet, appStateSet } from "../../lib/app-state.ts";

function parseSeguro(valor: unknown): unknown {
  if (typeof valor === "string") {
    const limpo = valor.replace(/^\s*=?\s*/, "").trim();
    try {
      return JSON.parse(limpo);
    } catch {
      return valor;
    }
  }
  return valor;
}

export const handler: Handlers = {
  GET() {
    const valor = appStateGet("classificacao");
    return new Response(JSON.stringify(parseSeguro(valor)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  },

  async POST(req) {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({
          ok: false,
          erro: "Content-Type deve ser application/json",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    let dados: unknown;
    try {
      dados = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    appStateSet("classificacao", parseSeguro(dados));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
