import { Handlers } from "$fresh/server.ts";

// Servidor de arquivos do volume Docker /data/uploads.
// Esses não ficam no repo de assets — são uploads dinâmicos (ex: logos
// editados pelo admin). Path no KV é `/uploads/...`; cdn.ts deixa passar
// direto pro mesmo host (não jsDelivr).
//
// Defesa contra path traversal: bloqueia ".." e qualquer path absoluto.

const BASE = Deno.env.get("UPLOADS_PATH") || "/data/uploads";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export const handler: Handlers = {
  async GET(_req, ctx) {
    const raw = ctx.params.path ?? "";
    // path traversal: rejeita componentes ".." e barras absolutas
    if (raw.includes("..") || raw.startsWith("/")) {
      return new Response("Bad request", { status: 400 });
    }
    const full = `${BASE}/${raw}`;
    try {
      const stat = await Deno.stat(full);
      if (!stat.isFile) return new Response("Not found", { status: 404 });
      const data = await Deno.readFile(full);
      const ext = raw.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: {
          "Content-Type": mime,
          // Cache 1h no edge — admin pode trocar logo e o path muda via ?t=
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Server error", { status: 500 });
    }
  },
};
