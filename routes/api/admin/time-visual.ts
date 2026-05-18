import { Handlers } from "$fresh/server.ts";
import { TODAS_CHAVES } from "../../../lib/kv.ts";
import {
  deleteTimeVisual,
  getTimeVisualResolved,
  setNomeOverride,
  setTimeVisual,
} from "../../../lib/time-visual.ts";
import { setVisualOverride, clearVisualOverride } from "../../../lib/times-liga.ts";
import { invalidateVisualCache } from "../../_middleware.ts";
import type { State } from "../../_middleware.ts";

const H = { "Content-Type": "application/json" };
const UPLOADS_BASE = Deno.env.get("UPLOADS_PATH") || "/data/uploads";
const TIMES_DIR = `${UPLOADS_BASE}/times_escudos`;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function exigirAdmin(ctx: { state: State }): boolean {
  return ctx.state.session?.role === "admin";
}

function jsonErr(status: number, erro: string): Response {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: H });
}

async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "bin";
  }
}

/**
 * POST /api/admin/time-visual?chave=<chave>
 *
 * Aceita dois formatos:
 *   - JSON: { nome_time?, displayName?, logo? }  → atualiza só os campos enviados
 *   - multipart/form-data: campo `logo` (File) + opcionalmente `nome_time`, `displayName`
 *     → salva o arquivo em /data/uploads/times_escudos/<chave>.<ext>
 *       e seta logo = "/uploads/times_escudos/<chave>.<ext>?t=<unix>"
 *
 * DELETE /api/admin/time-visual?chave=<chave>  → remove o override (volta ao default)
 */
export const handler: Handlers<unknown, State> = {
  async POST(req, ctx) {
    if (!exigirAdmin(ctx)) return jsonErr(403, "Apenas admin");
    const chave = new URL(req.url).searchParams.get("chave")?.toLowerCase() ?? "";
    if (!TODAS_CHAVES.includes(chave)) return jsonErr(400, "chave inválida");

    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    const ctype = req.headers.get("content-type") ?? "";

    try {
      if (ctype.includes("multipart/form-data")) {
        const form = await req.formData();
        const patch: { nome_time?: string; displayName?: string; logo?: string } = {};

        const nome = form.get("nome_time");
        if (typeof nome === "string" && nome.trim()) patch.nome_time = nome.trim();
        const dn = form.get("displayName");
        if (typeof dn === "string" && dn.trim()) patch.displayName = dn.trim();

        // logo via URL externa (text field) OU upload (File)
        const logoUrl = form.get("logoUrl");
        if (typeof logoUrl === "string" && logoUrl.trim()) {
          patch.logo = logoUrl.trim();
        }
        const file = form.get("logo");
        if (file instanceof File && file.size > 0) {
          if (file.size > MAX_LOGO_BYTES) {
            return jsonErr(413, `Arquivo > ${MAX_LOGO_BYTES / 1024 / 1024} MB`);
          }
          if (!ALLOWED_MIME.has(file.type)) {
            return jsonErr(415, `MIME não suportado: ${file.type}`);
          }
          await ensureDir(TIMES_DIR);
          const ext = extFromMime(file.type);
          const filename = `${chave}.${ext}`;
          const fullPath = `${TIMES_DIR}/${filename}`;
          const bytes = new Uint8Array(await file.arrayBuffer());
          await Deno.writeFile(fullPath, bytes);
          // Cache-bust via timestamp; browsers cacheam paths sem query
          patch.logo = `/uploads/times_escudos/${filename}?t=${Date.now()}`;
        }

        if (Object.keys(patch).length === 0) {
          return jsonErr(400, "Nada pra atualizar");
        }
        await setTimeVisual(kv, chave, patch);
      } else {
        // JSON
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") return jsonErr(400, "JSON inválido");
        const patch: { nome_time?: string; displayName?: string; logo?: string } = {};
        if (typeof body.nome_time === "string") patch.nome_time = body.nome_time.trim();
        if (typeof body.displayName === "string") patch.displayName = body.displayName.trim();
        if (typeof body.logo === "string") patch.logo = body.logo.trim();
        if (Object.keys(patch).length === 0) {
          return jsonErr(400, "Nada pra atualizar");
        }
        await setTimeVisual(kv, chave, patch);
      }

      const resolved = await getTimeVisualResolved(kv, chave);
      // Hidrata o cache em memória — mais barato que invalidar e refazer load
      setVisualOverride(chave, {
        logo: resolved.logo ?? undefined,
        displayName: resolved.displayName,
      });
      setNomeOverride(chave, resolved.nomeTime);
      invalidateVisualCache(); // próxima request também recarrega tudo, por garantia
      return new Response(JSON.stringify({ ok: true, visual: resolved }), { headers: H });
    } catch (e) {
      return jsonErr(500, String(e));
    }
  },

  async DELETE(req, ctx) {
    if (!exigirAdmin(ctx)) return jsonErr(403, "Apenas admin");
    const chave = new URL(req.url).searchParams.get("chave")?.toLowerCase() ?? "";
    if (!TODAS_CHAVES.includes(chave)) return jsonErr(400, "chave inválida");
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    await deleteTimeVisual(kv, chave);
    clearVisualOverride(chave);
    setNomeOverride(chave, undefined);
    invalidateVisualCache();
    const resolved = await getTimeVisualResolved(kv, chave);
    return new Response(JSON.stringify({ ok: true, visual: resolved }), { headers: H });
  },
};
