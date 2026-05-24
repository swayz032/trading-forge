/**
 * Payout Audit Packet Generator — Wave 25 Gap 10
 *
 * CLI: tsx scripts/generate-payout-audit-packet.ts \
 *        --account-id <id> \
 *        --start <ISO> \
 *        --end <ISO> \
 *        [--output <dir>]
 *
 * PURPOSE: Real Reddit cases — OFP Funding denied payout at 1.02% drawdown
 * (Case 2818, 2026-02-07), Lucid Trading "fraud" banned cross-user copy trading
 * (2026-05-14). Operators lost payouts because they couldn't produce structured
 * evidence fast enough. This script bundles all Trading Forge evidence into a
 * tamper-evident tar.gz packet.
 *
 * See also: docs/payout-dispute-runbook.md
 */

import "dotenv/config";
import * as path from "node:path";

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(): {
  accountId: string;
  start: Date;
  end: Date;
  outputDir: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  const accountId = get("--account-id");
  const startStr = get("--start");
  const endStr = get("--end");
  const outputDir = get("--output") ?? path.join(process.cwd(), "reports", "payout-audits");

  const errors: string[] = [];
  if (!accountId) errors.push("--account-id is required");
  if (!startStr) errors.push("--start is required (ISO-8601, e.g. 2026-02-01T00:00:00Z)");
  if (!endStr) errors.push("--end is required (ISO-8601, e.g. 2026-02-28T23:59:59Z)");

  if (errors.length > 0) {
    console.error("Payout Audit Packet Generator\n");
    console.error("Usage:");
    console.error(
      "  tsx scripts/generate-payout-audit-packet.ts \\",
    );
    console.error("    --account-id <id> \\");
    console.error("    --start <ISO> \\");
    console.error("    --end <ISO> \\");
    console.error("    [--output <dir>]\n");
    for (const e of errors) console.error(`  ERROR: ${e}`);
    process.exit(1);
  }

  const start = new Date(startStr!);
  const end = new Date(endStr!);

  if (isNaN(start.getTime())) {
    console.error(`ERROR: --start value "${startStr}" is not a valid ISO-8601 date`);
    process.exit(1);
  }
  if (isNaN(end.getTime())) {
    console.error(`ERROR: --end value "${endStr}" is not a valid ISO-8601 date`);
    process.exit(1);
  }
  if (end <= start) {
    console.error("ERROR: --end must be after --start");
    process.exit(1);
  }

  return { accountId: accountId!, start, end, outputDir };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { accountId, start, end, outputDir } = parseArgs();

  console.log("\nPayout Audit Packet Generator — Wave 25 Gap 10");
  console.log("================================================");
  console.log(`Account ID : ${accountId}`);
  console.log(`Start      : ${start.toISOString()}`);
  console.log(`End        : ${end.toISOString()}`);
  console.log(`Output     : ${outputDir}`);
  console.log("");

  const { generatePayoutAuditPacket } = await import(
    "../src/server/lib/payout-audit-packet.js"
  );

  console.log("Gathering data from database…");
  const summary = await generatePayoutAuditPacket({
    accountId,
    start,
    end,
    outputDir,
  });

  console.log("\nPacket written successfully.");
  console.log(`  Directory  : ${summary.packetDir}`);
  console.log(`  Archive    : ${summary.zipPath}`);
  console.log(`  SHA-256    : ${summary.manifestSha256}`);
  console.log(`  Trades     : ${summary.manifest.files.find((f) => f.file === "trades.jsonl")?.rows ?? 0}`);
  console.log(`  Audit rows : ${summary.manifest.files.find((f) => f.file === "audit-log.jsonl")?.rows ?? 0}`);
  console.log(`  Strategies : ${summary.manifest.files.find((f) => f.file === "strategy-dsls.json")?.rows ?? 0}`);
  console.log("\nFiles in packet:");
  for (const f of summary.manifest.files) {
    console.log(`  ${f.sha256.slice(0, 16)}…  ${f.file} (${f.rows} rows)`);
  }
  console.log(
    "\nSend the .tar.gz archive to the prop firm. Include the SHA-256 checksum",
  );
  console.log(
    "so they can verify tamper-evidence: sha256sum of manifest.json must match",
  );
  console.log("manifest.sha256.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
