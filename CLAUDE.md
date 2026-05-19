# Deploy

Roda em [fantasy.iuro07.com](https://fantasy.iuro07.com) no servidor Hetzner do
iuro07.

**⚠️ Fork:** o repo principal é `Ian-costermani/brasileirao-fantasy`. Você fez
fork pra `Iuri07/brasileirao-fantasy` pra ter os Secrets de deploy. Remotes:

- `origin` = `Iuri07/brasileirao-fantasy` (push aqui pra disparar deploy)
- `upstream` = `Ian-costermani/brasileirao-fantasy` (sync de mudanças do Ian via
  `git pull upstream master`)

## Pipeline

- **Push pra `master`** (branch principal) dispara
  `.github/workflows/deploy.yml`
- Build Dockerfile (Deno alpine + Fresh build → `_fresh/`)
- Imagem `ghcr.io/iuri07/brasileirao-fantasy:latest`, GH Actions SSH como
  `deploy@178.105.60.234` → `docker compose pull && up -d` em
  `/srv/brasileirao-fantasy/`
- Caddy: `fantasy.iuro07.com → brasileirao-fantasy:8080`

## Estado / secrets

- `.env`: `API_FOOTBALL_KEY`, `GOOGLE_CLIENT_ID/SECRET`,
  `GOOGLE_REDIRECT_URI=https://fantasy.iuro07.com/api/auth/google/callback`,
  `ADMIN_USER`, `ADMIN_PASS`, `DENO_KV_PATH=/data/kv.db`, `PORT=8080`
- **`HOST=0.0.0.0` é setado direto no `docker-compose.yml`** (NÃO no .env).
  Fresh default é localhost-only — sem isso Caddy não chega. Quando recriar
  compose, manter essa env.
- Volume `./data:/data` — Deno KV vive em `/data/kv.db`

## Detalhes do código

- Todos os `Deno.openKv()` foram patchados pra
  `Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined)` via sed — se aparecer
  arquivo novo abrindo KV, repete o patch
- Assets (imagens de atletas/escudos) NÃO ficam no container — servidos via
  jsDelivr do repo separado `Iuri07/brasileirao-fantasy-assets`. `lib/cdn.ts`
  detecta prod via hostname e troca path → URL CDN
- `lib/ogol.ts` chama `rembg` (Python) via subprocess — mas só em scripts admin
  locais (`scripts/baixar-cutouts-faltantes.ts`), NÃO em prod. Container não
  precisa de Python
- Multi-user com OAuth Google + login admin local. Antes rodava em Deno Deploy
