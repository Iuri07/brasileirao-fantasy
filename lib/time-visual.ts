// Overrides editáveis pelo admin pra identidade visual dos times.
// Defaults em `lib/times-liga.ts` (hardcoded). KV armazena overrides
// opcionais que têm prioridade na hora de renderizar.
//
// Estrutura:
//   ["time_visual", chave] = { nome_time?, displayName?, logo?, updatedAt }
//
// `nome_time` afeta TopBar/cards/ranking. `displayName` é o nome curto
// usado em pílulas e listas (ex: "Pedro Álvares Pardal" vs "PEDRO ÁLVARES").
// `logo` pode ser path absoluto (/uploads/...) ou URL externa.

import type { TimeLigaInfo } from "./times-liga.ts";
import { timeLigaInfo } from "./times-liga.ts";
import { CHAVES_TIMES } from "./kv.ts";
import { getDb } from "./db.ts";

export interface TimeVisualOverride {
  nome_time?: string;
  displayName?: string;
  logo?: string;
  updatedAt?: string;
}

interface VisualRow {
  chave: string;
  nome_time: string | null;
  display_name: string | null;
  logo: string | null;
  updated_at: string | null;
}

function rowToOverride(r: VisualRow): TimeVisualOverride {
  const out: TimeVisualOverride = {};
  if (r.nome_time) out.nome_time = r.nome_time;
  if (r.display_name) out.displayName = r.display_name;
  if (r.logo) out.logo = r.logo;
  if (r.updated_at) out.updatedAt = r.updated_at;
  return out;
}

export function getTimeVisual(
  chave: string,
): Promise<TimeVisualOverride | null> {
  const r = getDb().prepare(
    "SELECT chave, nome_time, display_name, logo, updated_at FROM time_visual WHERE chave=?",
  ).get<VisualRow>(chave);
  return Promise.resolve(r ? rowToOverride(r) : null);
}

export async function setTimeVisual(
  chave: string,
  patch: TimeVisualOverride,
): Promise<TimeVisualOverride> {
  const current = (await getTimeVisual(chave)) ?? {};
  const next: TimeVisualOverride = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  getDb().prepare(
    "INSERT INTO time_visual (chave, nome_time, display_name, logo, updated_at) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (chave) DO UPDATE SET " +
      "  nome_time=excluded.nome_time, display_name=excluded.display_name, " +
      "  logo=excluded.logo, updated_at=excluded.updated_at",
  ).run(
    chave,
    next.nome_time ?? null,
    next.displayName ?? null,
    next.logo ?? null,
    next.updatedAt ?? null,
  );
  return next;
}

export function deleteTimeVisual(chave: string): Promise<void> {
  getDb().prepare("DELETE FROM time_visual WHERE chave=?").run(chave);
  return Promise.resolve();
}

export function getAllTimeVisuais(): Promise<
  Record<string, TimeVisualOverride>
> {
  const rows = getDb().prepare(
    "SELECT chave, nome_time, display_name, logo, updated_at FROM time_visual",
  ).all<VisualRow>();
  const out: Record<string, TimeVisualOverride> = {};
  for (const r of rows) out[r.chave] = rowToOverride(r);
  return Promise.resolve(out);
}

/** Resolve a identidade visual final pra um time: merge dos defaults
 *  hardcoded em times-liga.ts com o override em KV. Retorna objeto
 *  consistente que componentes podem usar. */
export interface TimeVisualResolved {
  chave: string;
  /** Nome completo (ex: "BENDERMEM 23") usado no TopBar e cards. */
  nomeTime: string;
  /** Nome curto/canônico pra UI compacta. Cai pra nomeTime se não houver. */
  displayName: string;
  /** Path absoluto ou URL. null se sem logo. */
  logo: string | null;
  /** Sigla curta (3-4 letras) — sempre vem do hardcoded. */
  sigla: string;
  /** Cor accent — sempre do hardcoded. */
  accent: string;
  /** Indica se o admin já mexeu em algum campo (pra UI mostrar "editado"). */
  customizado: boolean;
}

export function resolveTimeVisual(
  chave: string,
  override: TimeVisualOverride | null,
  baseInfo?: TimeLigaInfo | null,
): TimeVisualResolved {
  const base = baseInfo ?? timeLigaInfo(chave);
  const meta = CHAVES_TIMES[chave];
  const nomeTime = override?.nome_time ?? meta?.nome_time ?? chave;
  const displayName = override?.displayName ?? base?.displayName ?? nomeTime;
  const logo = override?.logo ?? base?.logo ?? null;
  return {
    chave,
    nomeTime,
    displayName,
    logo,
    sigla: base?.sigla ?? chave.slice(0, 3).toUpperCase(),
    accent: base?.accent ?? "#888",
    customizado: !!(
      override?.nome_time ||
      override?.displayName ||
      override?.logo
    ),
  };
}

/** Versão async que lê DB e resolve. Útil em handlers que precisam
 *  do visual final pra renderizar SSR. */
export async function getTimeVisualResolved(
  chave: string,
): Promise<TimeVisualResolved> {
  const override = await getTimeVisual(chave);
  return resolveTimeVisual(chave, override);
}

// ============================================================
// Cache em memória de nome_time overrides (sync access)
// ============================================================
// Usado pra TopBar e qualquer componente que renderiza o nome do time
// sem ter acesso ao KV. Hidratado pelo middleware na primeira request.

const NOME_OVERRIDES: Map<string, string> = new Map();

export function applyNomeOverrides(
  overrides: Record<string, TimeVisualOverride>,
): void {
  NOME_OVERRIDES.clear();
  for (const [chave, o] of Object.entries(overrides)) {
    if (o?.nome_time) NOME_OVERRIDES.set(chave, o.nome_time);
  }
}

export function setNomeOverride(chave: string, nome?: string): void {
  if (nome) NOME_OVERRIDES.set(chave, nome);
  else NOME_OVERRIDES.delete(chave);
}

export function clearNomeOverride(chave: string): void {
  NOME_OVERRIDES.delete(chave);
}

/** Retorna o nome customizado se houver, senão null. Consumidores
 *  caem no `CHAVES_TIMES[chave].nome_time` ou `elenco.nome_time`. */
export function getNomeOverrideSync(chave: string): string | null {
  return NOME_OVERRIDES.get(chave) ?? null;
}

/** Resolve o nome final pra exibição: override KV → fallback (passado pelo
 *  caller, ex: `elenco.nome_time`) → CHAVES_TIMES → chave. Usar isso em
 *  TODO lugar que renderiza nome do time, pra refletir edição do admin. */
export function getNomeTimeDisplay(
  chave: string,
  fallback?: string | null,
): string {
  const override = NOME_OVERRIDES.get(chave);
  if (override) return override;
  if (fallback) return fallback;
  return CHAVES_TIMES[chave]?.nome_time ?? chave;
}
