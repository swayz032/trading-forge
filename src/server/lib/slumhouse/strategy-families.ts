import { resolvePremiumName, familyKeyFor, type NamedStrategyRow } from "./premium-names.js";

export const LIFECYCLE_ORDER: Record<string, number> = {
  GRAVEYARD: -2, DECLINING: -1, CANDIDATE: 0, TESTING: 1, SHADOW: 2, PAPER: 3, DEPLOY_READY: 4, PILOT: 5, DEPLOYED: 6,
};

export interface FamilyRow extends NamedStrategyRow { id: string; lifecycleState: string; forgeScore?: number | null; }
export interface Variant { id: string; premiumName: string; displayName: string; variantTag: string; lifecycleState: string; forgeScore: number; symbol: string; timeframe: string; }
export interface Family { familyKey: string; premiumName: string; variants: Variant[]; champion: Variant; }

export function groupIntoFamilies(rows: FamilyRow[]): Family[] {
  const byKey = new Map<string, FamilyRow[]>();
  for (const r of rows) { const k = familyKeyFor(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(r); }
  const families: Family[] = [];
  for (const [familyKey, group] of byKey) {
    const rawVariants: Variant[] = group.map((r) => {
      const n = resolvePremiumName(r);
      return { id: r.id, premiumName: n.premiumName, displayName: n.displayName, variantTag: n.variantTag, lifecycleState: r.lifecycleState, forgeScore: Number(r.forgeScore ?? 0), symbol: r.symbols?.[0] ?? "MES", timeframe: r.timeframe };
    });
    const uniqueByDisplay = new Map<string, Variant>();
    for (const variant of rawVariants.sort((a, b) => {
      const lifecycle = (LIFECYCLE_ORDER[b.lifecycleState] ?? 0) - (LIFECYCLE_ORDER[a.lifecycleState] ?? 0);
      return lifecycle || b.forgeScore - a.forgeScore || a.id.localeCompare(b.id);
    })) {
      if (!uniqueByDisplay.has(variant.displayName)) uniqueByDisplay.set(variant.displayName, variant);
    }
    const variants = [...uniqueByDisplay.values()];
    const champion = [...variants].sort((a, b) => {
      const la = LIFECYCLE_ORDER[a.lifecycleState] ?? 0, lb = LIFECYCLE_ORDER[b.lifecycleState] ?? 0;
      return lb - la || b.forgeScore - a.forgeScore;
    })[0];
    families.push({ familyKey, premiumName: variants[0].premiumName, variants, champion });
  }
  return families;
}
