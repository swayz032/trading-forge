/**
 * audit-strategy-source-urls.ts — smoke audit for strategy source URL resolver
 *
 * Pulls all active strategies, resolves source URLs using the four-path resolver,
 * and prints a report showing how many resolved via each path.
 *
 * CLI:
 *   npx tsx scripts/audit-strategy-source-urls.ts
 *   npx tsx scripts/audit-strategy-source-urls.ts --lifecycles CANDIDATE,TESTING,PAPER
 *   npx tsx scripts/audit-strategy-source-urls.ts --verbose
 *
 * The script is READ-ONLY — it never writes to any table.
 * Exit 0 always (unless DB connection fails).
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray, eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema.js";
import { stripMarketSuffix } from "../src/server/lib/strategy-source-resolver.js";

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const lifecyclesArg = args.find(a => a.startsWith("--lifecycles="))?.split("=")[1];

const DEFAULT_LIFECYCLES = [
  "CANDIDATE", "TESTING", "PAPER", "DEPLOY_READY",
  "PILOT", "DEPLOYED", "DECLINING",
] as const;

const targetLifecycles: string[] = lifecyclesArg
  ? lifecyclesArg.split(",").map(s => s.trim().toUpperCase())
  : [...DEFAULT_LIFECYCLES];

// ─── DB ───────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 3, ssl: "require" });
const db = drizzle(client, { schema });

// ─── Resolution logic (duplicates resolver paths inline — keeps script standalone) ─────

interface ResolvedEntry {
  name: string;
  urls: string[];
  path: "direct" | "variant_inheritance" | "audit_c" | "audit_d" | "unresolved";
}

async function resolveAll(): Promise<ResolvedEntry[]> {
  // 1. Load all active strategies
  const strategyRows = await db
    .select({ id: schema.strategies.id, name: schema.strategies.name })
    .from(schema.strategies)
    .where(inArray(schema.strategies.lifecycleState, targetLifecycles));

  console.log(`\nLoaded ${strategyRows.length} strategies (lifecycles: ${targetLifecycles.join(", ")})`);

  if (strategyRows.length === 0) {
    return [];
  }

  // 2. Build strategy IDs set for JS-side filtering
  const strategyIdSet = new Set(strategyRows.map(s => s.id));

  // 3. Load ALL bucket+mention pairs (full scan — typically < 500 rows)
  // and filter by graduated_strategy_id in JS to avoid ANY() array-type issues.
  const allDirectRows = await db
    .select({
      graduatedStrategyId: schema.strategyPendingBuckets.graduatedStrategyId,
      sourceUrl: schema.strategyPendingMentions.sourceUrl,
    })
    .from(schema.strategyPendingBuckets)
    .innerJoin(
      schema.strategyPendingMentions,
      eq(schema.strategyPendingMentions.bucketId, schema.strategyPendingBuckets.id),
    );

  // Build strategyId → URL[] map for path (a)
  const directUrlMap = new Map<string, string[]>();
  for (const row of allDirectRows) {
    if (!row.graduatedStrategyId) continue;
    if (!strategyIdSet.has(row.graduatedStrategyId)) continue;
    const existing = directUrlMap.get(row.graduatedStrategyId) ?? [];
    if (!existing.includes(row.sourceUrl)) existing.push(row.sourceUrl);
    directUrlMap.set(row.graduatedStrategyId, existing);
  }

  // 4. Load all buckets with concept_name for path (b)
  const allBuckets = await db
    .select({
      id: schema.strategyPendingBuckets.id,
      conceptName: schema.strategyPendingBuckets.conceptName,
      graduatedStrategyId: schema.strategyPendingBuckets.graduatedStrategyId,
    })
    .from(schema.strategyPendingBuckets);

  // Build conceptName → bucketId[] map
  const conceptToBuckets = new Map<string, string[]>();
  for (const bucket of allBuckets) {
    if (!bucket.conceptName) continue;
    const existing = conceptToBuckets.get(bucket.conceptName) ?? [];
    existing.push(bucket.id);
    conceptToBuckets.set(bucket.conceptName, existing);
  }

  // All mentions (for concept-strip path b)
  const allMentions = await db
    .select({
      bucketId: schema.strategyPendingMentions.bucketId,
      sourceUrl: schema.strategyPendingMentions.sourceUrl,
    })
    .from(schema.strategyPendingMentions);

  const bucketToUrls = new Map<string, string[]>();
  for (const m of allMentions) {
    const existing = bucketToUrls.get(m.bucketId) ?? [];
    if (!existing.includes(m.sourceUrl)) existing.push(m.sourceUrl);
    bucketToUrls.set(m.bucketId, existing);
  }

  // 5. Load audit_log rows for paths (c) and (d)
  const variantAuditRows = await db
    .select({ result: schema.auditLog.result })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, "graduation.market_variant_created"));

  // Map variant_name → leader_strategy_id
  const variantToLeader = new Map<string, string>();
  for (const row of variantAuditRows) {
    const res = row.result as Record<string, unknown> | null;
    if (res?.variant_name && typeof res.variant_name === "string" && res.leader_strategy_id && typeof res.leader_strategy_id === "string") {
      variantToLeader.set(res.variant_name, res.leader_strategy_id);
    }
  }

  const scoutAuditRows = await db
    .select({ input: schema.auditLog.input, result: schema.auditLog.result })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, "scout.operator_ingested"));

  // 6. Resolve each strategy
  const results: ResolvedEntry[] = [];

  for (const strategy of strategyRows) {
    const { id, name } = strategy;

    // Path (a): direct
    const directUrls = directUrlMap.get(id);
    if (directUrls && directUrls.length > 0) {
      results.push({ name, urls: directUrls, path: "direct" });
      continue;
    }

    // Path (b): concept-strip
    const conceptKey = stripMarketSuffix(name);
    if (conceptKey !== name) {
      const bucketIds = conceptToBuckets.get(conceptKey) ?? [];
      const variantUrls: string[] = [];
      for (const bid of bucketIds) {
        const mentionUrls = bucketToUrls.get(bid) ?? [];
        for (const u of mentionUrls) {
          if (!variantUrls.includes(u)) variantUrls.push(u);
        }
      }
      if (variantUrls.length > 0) {
        results.push({ name, urls: variantUrls, path: "variant_inheritance" });
        continue;
      }
    }

    // Path (c): audit_log graduation.market_variant_created
    const leaderId = variantToLeader.get(name);
    if (leaderId) {
      const leaderUrls = directUrlMap.get(leaderId) ?? [];
      if (leaderUrls.length > 0) {
        results.push({ name, urls: leaderUrls, path: "audit_c" });
        continue;
      }
    }

    // Path (d): scout.operator_ingested
    const conceptForScout = stripMarketSuffix(name).toLowerCase();
    const scoutUrls: string[] = [];
    for (const row of scoutAuditRows) {
      const inp = row.input as Record<string, unknown> | null;
      const res = row.result as Record<string, unknown> | null;
      const bodyText = JSON.stringify(inp) + JSON.stringify(res);
      if (bodyText.toLowerCase().includes(conceptForScout) && inp?.url && typeof inp.url === "string") {
        if (!scoutUrls.includes(inp.url)) scoutUrls.push(inp.url);
      }
    }
    if (scoutUrls.length > 0) {
      results.push({ name, urls: scoutUrls, path: "audit_d" });
      continue;
    }

    // Unresolved
    results.push({ name, urls: [], path: "unresolved" });
  }

  return results;
}

// ─── Output ───────────────────────────────────────────────────────────────────

async function main() {
  let results: ResolvedEntry[];
  try {
    results = await resolveAll();
  } catch (err) {
    console.error("ERROR during resolution:", err);
    await client.end();
    process.exit(1);
  }

  // Tally by path
  const tally = {
    direct: 0,
    variant_inheritance: 0,
    audit_c: 0,
    audit_d: 0,
    unresolved: 0,
  };
  for (const r of results) {
    tally[r.path]++;
  }

  const resolved = results.length - tally.unresolved;

  console.log("\n─── Strategy Source URL Audit ──────────────────────────────────");
  console.log(`Total strategies:           ${results.length}`);
  console.log(`Resolved (any path):        ${resolved} of ${results.length}`);
  console.log(`  (a) Direct bucket join:   ${tally.direct}`);
  console.log(`  (b) Variant inheritance:  ${tally.variant_inheritance}`);
  console.log(`  (c) Audit variant row:    ${tally.audit_c}`);
  console.log(`  (d) Scout audit row:      ${tally.audit_d}`);
  console.log(`Unresolved (orphan):        ${tally.unresolved}`);
  console.log("────────────────────────────────────────────────────────────────\n");

  if (verbose) {
    console.log("─── Per-strategy breakdown ──────────────────────────────────────");
    const colWidth = Math.max(...results.map(r => r.name.length), 10);
    console.log(
      "Strategy".padEnd(colWidth + 2) +
      "Path".padEnd(22) +
      "URL count"
    );
    console.log("─".repeat(colWidth + 2 + 22 + 10));
    for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
      const pathLabel = r.path === "unresolved" ? "UNRESOLVED" : r.path;
      console.log(
        r.name.padEnd(colWidth + 2) +
        pathLabel.padEnd(22) +
        r.urls.length.toString()
      );
      if (verbose && r.urls.length > 0) {
        for (const u of r.urls) {
          console.log("  " + u);
        }
      }
    }
    console.log("────────────────────────────────────────────────────────────────\n");
  }

  await client.end();
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
