// Manifesto de fotos de jogadores em /static/players/.
// Slug do arquivo (sem extensão) bate com slugify(apelido) na maioria dos casos.
// Casos ambíguos (Gabriel, Pedro etc) ficam sem foto até termos atleta_id no
// match — pode ser melhorado depois com mapping atleta_id → file.

const PLAYERS_DIR = "static/players";

function loadManifest(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (const entry of Deno.readDirSync(PLAYERS_DIR)) {
      if (!entry.isFile) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      m.set(entry.name.slice(0, dot), entry.name);
    }
  } catch {
    // Diretório não existe — segue sem fotos.
  }
  return m;
}

const MANIFEST = loadManifest();

export function slugifyApelido(apelido: string): string {
  return apelido
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function fotoUrl(apelido: string | null | undefined): string | null {
  if (!apelido) return null;
  const file = MANIFEST.get(slugifyApelido(apelido));
  return file ? `/players/${file}` : null;
}
