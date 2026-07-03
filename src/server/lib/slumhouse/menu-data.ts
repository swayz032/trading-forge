/**
 * Menu category assemblers — power the four Slumhouse menu pages.
 *
 * Read-only. Every query fails-soft to an empty list per the Slumhouse contract.
 * Each assembler reads the `strategies` table, maps rows to the shape the
 * premium-name / family helpers expect, then applies premium names + variant
 * families.
 *
 *   assembleNowServing()          → champions of DEPLOYED/DECLINING families ($ merged)
 *   assembleDeployReady()         → champions of DEPLOY_READY families
 *   assembleKitchenMenu(symbol)   → full families cooking for a symbol (cook-off view)
 *   assembleGraveyardMenu()       → full families of tossed strategies (+ killReason)
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { groupIntoFamilies, type FamilyRow, type Family, type Variant } from "./strategy-families.js";
import { assembleTodaysMenu } from "./kitchen-data.js";
import { coarseJourneyForStage, type Gate } from "./gate-journey.js";

// Raw DB shape returned by db.execute over the strategies table.
interface StrategyRow {
  id: string;
  name: string;
  symbols: string[] | null;
  timeframe: string;
  lifecycle_state: string;
  forge_score: number | string | null;
  config: Record<string, unknown> | null;
}

// ── Return interfaces ────────────────────────────────────────────────
export interface MenuChampion {
  id: string;
  premiumName: string;
  variantTag: string;
  symbol: string;
  lifecycleState: string;
  variantCount: number;
  /** Monthly $ from the paper journal — only merged for now-serving; null elsewhere. */
  monthMade: string | null;
}

/** Variant plus its cheap stage-derived gate journey (kitchen cook-off mini-line). */
export interface KitchenVariant extends Variant {
  gateJourney: Gate[];
}

/** Full family for the kitchen cook-off view. */
export interface KitchenMenuFamily {
  familyKey: string;
  premiumName: string;
  champion: KitchenVariant;
  variants: KitchenVariant[];
}

export interface GraveyardVariant extends Variant {
  killReason: string | null;
}

export interface GraveyardFamily {
  familyKey: string;
  premiumName: string;
  champion: GraveyardVariant;
  variants: GraveyardVariant[];
}

// ── Helpers ──────────────────────────────────────────────────────────
function toFamilyRow(r: StrategyRow): FamilyRow {
  return {
    id: String(r.id),
    name: r.name,
    symbols: Array.isArray(r.symbols) ? r.symbols : [],
    timeframe: r.timeframe,
    lifecycleState: r.lifecycle_state,
    forgeScore: r.forge_score != null ? Number(r.forge_score) : null,
    config: r.config ?? null,
  };
}

function killReasonFor(r: StrategyRow): string | null {
  const cfg = r.config ?? {};
  const cand = cfg["kill_reason"] ?? cfg["graveyard_reason"] ?? cfg["retire_reason"];
  return typeof cand === "string" && cand.length > 0 ? cand : null;
}

async function fetchStrategyRows(whereSql: ReturnType<typeof sql>): Promise<StrategyRow[]> {
  return (await db.execute(sql`
    SELECT id::text AS id, name, symbols, timeframe, lifecycle_state, forge_score, config
    FROM strategies
    WHERE ${whereSql}
  `).catch(() => [] as unknown[])) as StrategyRow[];
}

function championsFrom(families: Family[]): Omit<MenuChampion, "monthMade">[] {
  return families.map((f) => ({
    id: f.champion.id,
    premiumName: f.champion.premiumName,
    variantTag: f.champion.variantTag,
    symbol: f.champion.symbol,
    lifecycleState: f.champion.lifecycleState,
    variantCount: f.variants.length,
  }));
}

// ── assembleNowServing ───────────────────────────────────────────────
export async function assembleNowServing(): Promise<MenuChampion[]> {
  const rows = await fetchStrategyRows(sql`lifecycle_state IN ('DEPLOYED', 'DECLINING')`);
  const families = groupIntoFamilies(rows.map(toFamilyRow));
  const bare = championsFrom(families);

  // Merge monthly $ from the canonical paper journal (assembleTodaysMenu covers
  // the exact same DEPLOYED/DECLINING population). Fails-soft to null per-id.
  const dishes = await assembleTodaysMenu();
  const madeById = new Map(dishes.map((d) => [d.id, d.monthMade]));

  return bare.map((c) => ({ ...c, monthMade: madeById.get(c.id) ?? null }));
}

// ── assembleDeployReady ──────────────────────────────────────────────
export async function assembleDeployReady(): Promise<MenuChampion[]> {
  const rows = await fetchStrategyRows(sql`lifecycle_state = 'DEPLOY_READY'`);
  const families = groupIntoFamilies(rows.map(toFamilyRow));
  return championsFrom(families).map((c) => ({ ...c, monthMade: null }));
}

// ── assembleKitchenMenu ──────────────────────────────────────────────
export async function assembleKitchenMenu(symbol: string): Promise<KitchenMenuFamily[]> {
  const sym = symbol || "MES";
  const rows = await fetchStrategyRows(sql`
    lifecycle_state IN ('CANDIDATE', 'TESTING', 'SHADOW', 'PAPER')
    AND ${sym} = ANY(symbols)
  `);
  const families = groupIntoFamilies(rows.map(toFamilyRow));
  const withJourney = (v: Variant): KitchenVariant => ({ ...v, gateJourney: coarseJourneyForStage(v.lifecycleState) });
  return families.map((f) => ({
    familyKey: f.familyKey,
    premiumName: f.premiumName,
    champion: withJourney(f.champion),
    variants: f.variants.map(withJourney),
  }));
}

// ── assembleGraveyardMenu ────────────────────────────────────────────
export async function assembleGraveyardMenu(): Promise<GraveyardFamily[]> {
  const rows = await fetchStrategyRows(sql`lifecycle_state = 'GRAVEYARD'`);
  const killById = new Map(rows.map((r) => [String(r.id), killReasonFor(r)]));
  const families = groupIntoFamilies(rows.map(toFamilyRow));

  const withKill = (v: Variant): GraveyardVariant => ({ ...v, killReason: killById.get(v.id) ?? null });

  return families.map((f) => ({
    familyKey: f.familyKey,
    premiumName: f.premiumName,
    champion: withKill(f.champion),
    variants: f.variants.map(withKill),
  }));
}
