import { Handlers } from "$fresh/server.ts";
import {
  getAllElencos,
  getAtletasCache,
  POSICAO_CHAVES_CACHE,
} from "../../../lib/kv.ts";
import { fetchAtletasMercado } from "../../../lib/cartola.ts";
import type { AtletaCacheEntry, AtletaCacheKV } from "../../../lib/types.ts";
import {
  downloadOgolPhoto,
  fetchOgolPhoto,
  fetchOgolRoster,
  normName,
  OGOL_TEAM_SLUGS,
  type OgolPlayer,
  pngHasTransparency,
  rembg,
  sleep,
} from "../../../lib/ogol.ts";

const H = { "Content-Type": "application/json" };
const RATE_DELAY_MS = 1500; // throttle anti-ban
const STATIC_DIR = "static/atletas";

/** Override manual de Cartola atleta_id → "slug/ogolId" — usado quando o
    apelido Cartola é genérico e o matching automático erra. */
const OGOL_OVERRIDE: Record<number, string> = {
  83257: "gabriel-barbosa/75171", // Gabigol (Santos) — não "Gabriel Bontempo/Menino/Brazão"
};

/**
 * Busca fotos no ogol pra atletas escalados/banco que ainda não têm cutout
 * do TheSportsDB. Salva PNG em /static/atletas/{atleta_id}.png e atualiza
 * o AtletaCacheEntry.foto pro path local.
 *
 * Re-rodar é seguro: pula quem já tem cutout TheSportsDB ou foto local.
 */
export const handler: Handlers = {
  async POST(req) {
    try {
      const url = new URL(req.url);
      const dryRun = url.searchParams.get("dry") === "1";
      const onlyClube = url.searchParams.get("clube") ?? null;
      const limit = Number(url.searchParams.get("limit") ?? "0");
      const force = url.searchParams.get("force") === "1";
      // forceAll=1 → re-sincroniza TODOS, mesmo quem já tem /atletas/
      const forceAll = url.searchParams.get("forceAll") === "1";
      // escopo=mercado → inclui TODOS atletas ativos do Cartola (free agents
      // inclusos). escopo=elenco (default) → só os 26 fixos dos elencos.
      const escopo = url.searchParams.get("escopo") ?? "elenco";

      const kv = await Deno.openKv();

      // 1. Coleta atleta_ids alvo
      const elencos = await getAllElencos(kv);
      const idsAlvo = new Set<number>();
      for (const elenco of Object.values(elencos)) {
        for (const j of Object.values(elenco.jogadores)) {
          if (
            j.escalacao === "Sim" || j.escalacao === "Banco" ||
            j.escalacao === "Não"
          ) {
            idsAlvo.add(j.atleta_id);
          }
        }
      }
      if (escopo === "mercado") {
        // Adiciona free agents + qualquer atleta ativo (não nulo, status != 6)
        const mercado = await fetchAtletasMercado().catch(() => null);
        for (const a of mercado?.atletas ?? []) {
          if (a.status_id !== 6) idsAlvo.add(a.atleta_id);
        }
      }

      // 2. Lê cache atual por posição
      const caches = new Map<string, AtletaCacheKV>();
      const entryByAtleta = new Map<
        number,
        { posChave: string; entry: AtletaCacheEntry }
      >();
      for (const pos of POSICAO_CHAVES_CACHE) {
        const c = await getAtletasCache(kv, pos);
        if (!c) continue;
        caches.set(pos, c);
        for (const [id, entry] of Object.entries(c.atletas)) {
          entryByAtleta.set(Number(id), { posChave: pos, entry });
        }
      }

      // 3. Agrupa quem precisa de foto por clube
      interface AlvoEntry {
        atleta_id: number;
        apelido: string;
        clube: string;
      }
      const porClube = new Map<string, AlvoEntry[]>();
      for (const id of idsAlvo) {
        const ref = entryByAtleta.get(id);
        if (!ref) continue;
        const foto = ref.entry.foto ?? "";
        const jaTemOgol = foto.startsWith("/atletas/");
        const jaTemSportsDB = foto.includes("thesportsdb.com");
        // forceAll: re-processa todo mundo (refazer rembg com lógica nova)
        // force: pula só quem já é ogol (preserva versão atual ogol)
        // padrão: pula quem tem qualquer cutout (ogol ou TheSportsDB)
        if (!forceAll) {
          if (!force && (jaTemOgol || jaTemSportsDB)) continue;
          if (force && jaTemOgol) continue;
        }
        const clube = ref.entry.clube;
        if (onlyClube && clube !== onlyClube) continue;
        if (!OGOL_TEAM_SLUGS[clube]) continue;
        const arr = porClube.get(clube) ?? [];
        arr.push({ atleta_id: id, apelido: ref.entry.apelido, clube });
        porClube.set(clube, arr);
      }

      const candidatos = [...porClube.values()].flat().length;

      // 4. Pra cada clube: 1 fetch do roster, depois fetch foto por atleta
      const tocadosPorPos = new Set<string>();
      const resultados: Array<
        { atleta_id: number; clube: string; apelido: string; status: string }
      > = [];
      let achados = 0;
      let buscas = 0;

      outer:
      for (const [clube, entries] of porClube) {
        const teamSlug = OGOL_TEAM_SLUGS[clube];
        let roster: OgolPlayer[];
        try {
          roster = await fetchOgolRoster(teamSlug);
        } catch (e) {
          resultados.push({
            atleta_id: 0,
            clube,
            apelido: "(roster)",
            status: `erro: ${String(e)}`,
          });
          continue;
        }
        await sleep(RATE_DELAY_MS);

        for (const entry of entries) {
          if (limit > 0 && buscas >= limit) break outer;
          buscas++;
          // Override manual: Cartola usa apelidos curtos pra alguns jogadores
          // famosos, que casariam ambiguamente com outros no ogol
          const override = OGOL_OVERRIDE[entry.atleta_id];
          const apelidoNorm = normName(entry.apelido);
          let match: OgolPlayer | undefined;
          if (override) {
            const [slug, ogolIdStr] = override.split("/");
            match = { slug, ogolId: Number(ogolIdStr) };
          } else {
            // 1. Match exato (slug sem hifens === apelido normalizado)
            match = roster.find((p) =>
              normName(p.slug.replace(/-/g, "")) === apelidoNorm
            );
            // 2. Primeira palavra do slug === apelido (ex: "gabriel-barbosa" → "gabriel")
            if (!match) {
              match = roster.find((p) =>
                normName(p.slug.split("-")[0]) === apelidoNorm
              );
            }
            // 3. Substring (fallback)
            if (!match) {
              match = roster.find((p) => {
                const sn = normName(p.slug.replace(/-/g, ""));
                return sn.includes(apelidoNorm) || apelidoNorm.includes(sn);
              });
            }
          }
          if (!match) {
            resultados.push({
              atleta_id: entry.atleta_id,
              clube,
              apelido: entry.apelido,
              status: "sem match no roster",
            });
            continue;
          }

          try {
            const photo = await fetchOgolPhoto(match);
            if (!photo) {
              resultados.push({
                atleta_id: entry.atleta_id,
                clube,
                apelido: entry.apelido,
                status: `match ${match.slug}/${match.ogolId} sem foto`,
              });
              await sleep(RATE_DELAY_MS);
              continue;
            }

            if (dryRun) {
              resultados.push({
                atleta_id: entry.atleta_id,
                clube,
                apelido: entry.apelido,
                status: `OK (dry) [${photo.format}] ${photo.url}`,
              });
              achados++;
            } else {
              let bytes = await downloadOgolPhoto(photo.url);
              let processed = `png direto`;
              if (photo.format === "jpg") {
                bytes = await rembg(bytes);
                processed = `jpg → rembg`;
              } else if (!(await pngHasTransparency(bytes))) {
                // PNG sem alpha real — fundo opaco baked-in. Roda rembg.
                bytes = await rembg(bytes);
                processed = `png-opaco → rembg`;
              }
              const path = `${STATIC_DIR}/${entry.atleta_id}.png`;
              await Deno.writeFile(path, bytes);
              const ref = entryByAtleta.get(entry.atleta_id)!;
              ref.entry.foto = `/atletas/${entry.atleta_id}.png`;
              tocadosPorPos.add(ref.posChave);
              achados++;
              resultados.push({
                atleta_id: entry.atleta_id,
                clube,
                apelido: entry.apelido,
                status: `OK ${bytes.byteLength}b (${processed})`,
              });
            }
          } catch (e) {
            resultados.push({
              atleta_id: entry.atleta_id,
              clube,
              apelido: entry.apelido,
              status: `erro: ${String(e)}`,
            });
          }
          await sleep(RATE_DELAY_MS);
        }
      }

      // 5. Persiste caches alterados
      if (!dryRun) {
        for (const pos of tocadosPorPos) {
          const c = caches.get(pos);
          if (c) {
            c.atualizadoEm = new Date().toISOString();
            await kv.set(["atletas_cache", pos], c);
          }
        }
      }

      return new Response(
        JSON.stringify(
          {
            ok: true,
            dryRun,
            candidatos,
            buscas,
            achados,
            clubesProcessados: porClube.size,
            tempoEstimadoMin:
              Math.round((buscas * RATE_DELAY_MS) / 60000 * 10) / 10,
            resultados,
          },
          null,
          2,
        ),
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
