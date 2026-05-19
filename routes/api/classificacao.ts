import { Handlers } from "$fresh/server.ts";
import { getDb } from "../../lib/db.ts";

function parseSeguro(valor: unknown): unknown {
  // Corrige double-encoding: n8n às vezes envia o array já serializado como string
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
    const r = getDb().prepare("SELECT data_json FROM classificacao WHERE id=1")
      .get<{ data_json: string }>();
    const valor = r ? parseSeguro(JSON.parse(r.data_json)) : null;
    return new Response(JSON.stringify(valor), {
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
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    let dados: unknown;
    try {
      dados = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, erro: "JSON inválido" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    dados = parseSeguro(dados);
    getDb().prepare(
      "INSERT INTO classificacao (id, data_json) VALUES (1, ?) " +
        "ON CONFLICT (id) DO UPDATE SET data_json=excluded.data_json",
    ).run(JSON.stringify(dados));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
