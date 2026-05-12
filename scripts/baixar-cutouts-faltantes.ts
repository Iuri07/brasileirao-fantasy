// Baixa cutouts do ogol pra TODOS os atletas ativos da Cartola que ainda
// não têm PNG em static/atletas/. Roda local (precisa rembg instalado).
//
// Uso:
//   deno run --allow-net --allow-read --allow-write --allow-run --allow-env \
//     scripts/baixar-cutouts-faltantes.ts
//
// Após terminar, rode ./scripts/gerar-cutouts-manifest.sh pra regerar o
// manifesto, e depois commit + push.

import { fetchAtletasMercado } from "../lib/cartola.ts";
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
} from "../lib/ogol.ts";
import { CUTOUTS_DISPONIVEIS } from "../lib/cutouts-manifest.ts";

const RATE_DELAY_MS = 1500;
const STATIC_DIR = "static/atletas";

const mercado = await fetchAtletasMercado();
const clubeNome: Record<number, string> = {};
for (const [id, c] of Object.entries(mercado.clubes)) {
  clubeNome[Number(id)] = c.nome_fantasia ?? c.nome ?? id;
}

interface Alvo {
  atleta_id: number;
  apelido: string;
  clube: string;
}
const porClube = new Map<string, Alvo[]>();
let totalAtivos = 0;
let jaTinhamCutout = 0;
let clubeNaoMapeado = 0;
const clubesNaoMapeados = new Set<string>();
for (const a of mercado.atletas) {
  if (a.status_id === 6) continue; // nulo
  totalAtivos++;
  if (CUTOUTS_DISPONIVEIS.has(String(a.atleta_id))) {
    jaTinhamCutout++;
    continue;
  }
  const clube = clubeNome[a.clube_id] ?? "";
  if (!OGOL_TEAM_SLUGS[clube]) {
    clubeNaoMapeado++;
    if (clube) clubesNaoMapeados.add(clube);
    continue;
  }
  const arr = porClube.get(clube) ?? [];
  arr.push({ atleta_id: a.atleta_id, apelido: a.apelido, clube });
  porClube.set(clube, arr);
}

const totalFaltando = [...porClube.values()].flat().length;
console.log(`[start] ${totalAtivos} atletas ativos`);
console.log(`        ${jaTinhamCutout} já têm cutout (manifesto)`);
console.log(`        ${clubeNaoMapeado} sem clube mapeado no ogol`);
console.log(`        ${totalFaltando} a buscar em ${porClube.size} clubes`);
if (clubesNaoMapeados.size > 0) {
  console.log(`        clubes ignorados: ${[...clubesNaoMapeados].join(", ")}`);
}

let achados = 0;
let semMatch = 0;
let erros = 0;
const inicio = Date.now();

for (const [clube, entries] of porClube) {
  console.log(`\n=== ${clube} (${entries.length}) ===`);
  let roster: OgolPlayer[];
  try {
    roster = await fetchOgolRoster(OGOL_TEAM_SLUGS[clube]);
  } catch (e) {
    console.log(`  ERRO roster: ${e}`);
    erros += entries.length;
    continue;
  }
  await sleep(RATE_DELAY_MS);

  for (const entry of entries) {
    const apelidoNorm = normName(entry.apelido);
    let match = roster.find((p) =>
      normName(p.slug.replace(/-/g, "")) === apelidoNorm
    );
    if (!match) {
      match = roster.find((p) =>
        normName(p.slug.split("-")[0]) === apelidoNorm
      );
    }
    if (!match) {
      match = roster.find((p) => {
        const sn = normName(p.slug.replace(/-/g, ""));
        return sn.includes(apelidoNorm) || apelidoNorm.includes(sn);
      });
    }
    if (!match) {
      console.log(`  ✗ ${entry.atleta_id} ${entry.apelido} — sem match`);
      semMatch++;
      continue;
    }

    try {
      const photo = await fetchOgolPhoto(match);
      if (!photo) {
        console.log(
          `  ✗ ${entry.atleta_id} ${entry.apelido} — sem foto (${match.slug})`,
        );
        semMatch++;
        await sleep(RATE_DELAY_MS);
        continue;
      }

      let bytes = await downloadOgolPhoto(photo.url);
      let how = "png direto";
      if (photo.format === "jpg") {
        bytes = await rembg(bytes);
        how = "jpg→rembg";
      } else if (!(await pngHasTransparency(bytes))) {
        bytes = await rembg(bytes);
        how = "png-opaco→rembg";
      }
      const path = `${STATIC_DIR}/${entry.atleta_id}.png`;
      await Deno.writeFile(path, bytes);
      achados++;
      console.log(
        `  ✓ ${entry.atleta_id} ${entry.apelido} (${how}, ${bytes.byteLength}b)`,
      );
    } catch (e) {
      erros++;
      console.log(`  ✗ ${entry.atleta_id} ${entry.apelido} — ${e}`);
    }
    await sleep(RATE_DELAY_MS);
  }
}

const segs = Math.round((Date.now() - inicio) / 1000);
console.log(`\n=== FIM ===`);
console.log(`Achados: ${achados}`);
console.log(`Sem match/foto: ${semMatch}`);
console.log(`Erros: ${erros}`);
console.log(`Tempo: ${Math.floor(segs / 60)}m${segs % 60}s`);
