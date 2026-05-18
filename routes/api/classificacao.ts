import { Handlers } from "$fresh/server.ts";

function parseSeguro(valor: unknown): unknown {
  // Corrige double-encoding: n8n às vezes envia o array já serializado como string
  if (typeof valor === "string") {
    // Remove prefixo "\t=" que alguns nós n8n adicionam
    const limpo = valor.replace(/^\s*=?\s*/, "").trim();
    try { return JSON.parse(limpo); } catch { return valor; }
  }
  return valor;
}

export const handler: Handlers = {
  async GET() {
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const resultado = await kv.get(["classificacao"]);
    const valor = parseSeguro(resultado.value);
    return new Response(JSON.stringify(valor ?? null), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },

  async POST(req) {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ ok: false, erro: "Content-Type deve ser application/json" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    let dados: unknown;
    try { dados = await req.json(); }
    catch {
      return new Response(JSON.stringify({ ok: false, erro: "JSON inválido" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    // Normaliza se vier como string
    dados = parseSeguro(dados);
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    await kv.set(["classificacao"], dados);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  },
};
