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

export interface TimeVisualOverride {
  nome_time?: string;
  displayName?: string;
  logo?: string;
  updatedAt?: string;
}

export async function getTimeVisual(
  kv: Deno.Kv,
  chave: string,
): Promise<TimeVisualOverride | null> {
  const r = await kv.get<TimeVisualOverride>(["time_visual", chave]);
  return r.value;
}

export async function setTimeVisual(
  kv: Deno.Kv,
  chave: string,
  patch: TimeVisualOverride,
): Promise<TimeVisualOverride> {
  const current = (await getTimeVisual(kv, chave)) ?? {};
  const next: TimeVisualOverride = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await kv.set(["time_visual", chave], next);
  return next;
}

export async function deleteTimeVisual(
  kv: Deno.Kv,
  chave: string,
): Promise<void> {
  await kv.delete(["time_visual", chave]);
}

export async function getAllTimeVisuais(
  kv: Deno.Kv,
): Promise<Record<string, TimeVisualOverride>> {
  const out: Record<string, TimeVisualOverride> = {};
  for await (const e of kv.list<TimeVisualOverride>({ prefix: ["time_visual"] })) {
    const chave = String(e.key[1]);
    out[chave] = e.value;
  }
  return out;
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
  const displayName =
    override?.displayName ?? base?.displayName ?? nomeTime;
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

/** Versão async que lê KV e resolve. Útil em handlers que precisam
 *  do visual final pra renderizar SSR. */
export async function getTimeVisualResolved(
  kv: Deno.Kv,
  chave: string,
): Promise<TimeVisualResolved> {
  const override = await getTimeVisual(kv, chave);
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
