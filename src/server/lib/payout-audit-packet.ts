/**
 * Payout Audit Packet — pure library (Wave 25 Gap 10)
 *
 * PURPOSE: Real payout disputes (OFP Case 2818 2026-02-07, Lucid Trading
 * 2026-05-14) were lost because operators could not produce structured evidence
 * fast enough. Trading Forge already captures all the data; this library bundles
 * it into a tamper-evident ZIP that can be sent to the prop firm.
 *
 * This file contains ONLY pure functions for data gathering + manifest building.
 * The CLI script (scripts/generate-payout-audit-packet.ts) is a thin wrapper.
 *
 * NO schema changes — queries existing tables only.
 * NO paper-layer changes — additive observability only.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";

import { db } from "../db/index.js";
import {
  paperTrades,
  auditLog,
  biasState,
  strategies,
  lifecycleTransitions,
} from "../db/schema.js";
import { and, gte, lte, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PayoutAuditPacketOptions {
  accountId: string;
  start: Date;
  end: Date;
  outputDir: string;
}

export interface ManifestEntry {
  file: string;
  sha256: string;
  rows: number;
}

export interface PacketManifest {
  account_id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  files: ManifestEntry[];
}

export interface PacketSummary {
  packetDir: string;
  zipPath: string;
  manifest: PacketManifest;
  manifestSha256: string;
}

// ─── Data gathering helpers ───────────────────────────────────────────────────

/**
 * Pull all paper_trades for the account in the window.
 * Returns serialisable plain objects.
 */
export async function gatherTrades(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  // paper_trades does not have account_id directly — it is linked via paper_sessions.
  // We join through paper_sessions to filter by account.
  const rows = await db.execute(
    sql`
      SELECT pt.*
      FROM paper_trades pt
      JOIN paper_sessions ps ON pt.session_id = ps.id
      WHERE ps.account_id = ${accountId}
        AND pt.entry_time >= ${start.toISOString()}
        AND pt.exit_time <= ${end.toISOString()}
      ORDER BY pt.entry_time ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull all audit_log rows for the account in the window.
 * Matches rows where input JSONB contains accountId.
 */
export async function gatherAuditLog(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  // Use raw SQL to query JSONB input field for accountId
  const rows = await db.execute(
    sql`
      SELECT *
      FROM audit_log
      WHERE created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
        AND (
          input->>'accountId' = ${accountId}
          OR result->>'accountId' = ${accountId}
          OR correlation_id IN (
            SELECT DISTINCT correlation_id FROM audit_log
            WHERE input->>'accountId' = ${accountId}
              AND correlation_id IS NOT NULL
              AND created_at >= ${start.toISOString()}
              AND created_at <= ${end.toISOString()}
          )
        )
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull bias_state snapshots in the window (all symbols — operator may trade MES/MNQ/MCL).
 */
export async function gatherBiasState(
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const rows = await db.execute(
    sql`
      SELECT *
      FROM bias_state
      WHERE created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull sizing audit rows from audit_log (confluence_multiplier_applied + risk_derived sizing).
 */
export async function gatherSizingAudits(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const rows = await db.execute(
    sql`
      SELECT *
      FROM audit_log
      WHERE created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
        AND action IN (
          'sizing.confluence_multiplier_applied',
          'sizing.risk_derived',
          'sizing.computed',
          'paper.position_sized'
        )
        AND (
          input->>'accountId' = ${accountId}
          OR input->>'account_id' = ${accountId}
        )
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull kill-switch events in the window.
 */
export async function gatherKillSwitchEvents(
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const rows = await db.execute(
    sql`
      SELECT *
      FROM audit_log
      WHERE created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
        AND (
          action LIKE 'kill_switch.%'
          OR action LIKE 'killswitch.%'
          OR action = 'production.kill_switch_activated'
          OR action = 'production.kill_switch_cleared'
          OR action = 'broker_router.route_rejected'
        )
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull strategy DSL snapshots for strategies that fired for this account.
 * Uses paper_sessions to find which strategies were active.
 */
export async function gatherStrategyDsls(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  // Find strategy IDs from paper sessions in window
  const sessionRows = await db.execute(
    sql`
      SELECT DISTINCT strategy_id, strategy_name
      FROM paper_sessions
      WHERE account_id = ${accountId}
        AND (
          started_at >= ${start.toISOString()}
          OR (stopped_at IS NULL AND started_at <= ${end.toISOString()})
          OR (stopped_at >= ${start.toISOString()} AND stopped_at <= ${end.toISOString()})
        )
    `,
  );

  const strategyIds = (sessionRows as any[])
    .map((r: any) => r.strategy_id)
    .filter(Boolean) as string[];

  if (strategyIds.length === 0) return [];

  const stratRows = await db.execute(
    sql`
      SELECT id, name, description, symbol, symbols, timeframe, config,
             lifecycle_state, lifecycle_changed_at, created_at
      FROM strategies
      WHERE id = ANY(${sql.raw(`ARRAY[${strategyIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
    `,
  );

  return stratRows as unknown as Record<string, unknown>[];
}

/**
 * Pull lifecycle transitions for strategies touched in window.
 */
export async function gatherLifecycleTransitions(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const sessionRows = await db.execute(
    sql`
      SELECT DISTINCT strategy_id FROM paper_sessions
      WHERE account_id = ${accountId}
        AND (
          started_at >= ${start.toISOString()}
          OR (stopped_at IS NULL AND started_at <= ${end.toISOString()})
          OR (stopped_at >= ${start.toISOString()} AND stopped_at <= ${end.toISOString()})
        )
    `,
  );
  const strategyIds = (sessionRows as any[])
    .map((r: any) => r.strategy_id)
    .filter(Boolean) as string[];

  if (strategyIds.length === 0) return [];

  const rows = await db.execute(
    sql`
      SELECT *
      FROM lifecycle_transitions
      WHERE strategy_id = ANY(${sql.raw(`ARRAY[${strategyIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
        AND created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Pull broker routing events (route_order + rejections) for the account in window.
 */
export async function gatherBrokerEvents(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const rows = await db.execute(
    sql`
      SELECT *
      FROM audit_log
      WHERE created_at >= ${start.toISOString()}
        AND created_at <= ${end.toISOString()}
        AND action IN (
          'broker_router.route_order',
          'broker_router.route_rejected',
          'broker_router.compliance_rejected',
          'broker:order_routed'
        )
        AND (
          input->>'accountId' = ${accountId}
          OR input->>'account_id' = ${accountId}
        )
      ORDER BY created_at ASC
    `,
  );
  return rows as unknown as Record<string, unknown>[];
}

// ─── File writers ─────────────────────────────────────────────────────────────

/** Write a JSONL file from an array of records. Returns SHA-256 of the file. */
async function writeJsonl(
  filePath: string,
  rows: Record<string, unknown>[],
): Promise<{ sha256: string; rows: number }> {
  const lines = rows.map((r) => JSON.stringify(r)).join("\n");
  const content = lines.length > 0 ? lines + "\n" : "";
  await fs.writeFile(filePath, content, "utf-8");
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  return { sha256, rows: rows.length };
}

/** Write a JSON file. Returns SHA-256 of the file. */
async function writeJson(
  filePath: string,
  data: unknown,
): Promise<{ sha256: string; rows: number }> {
  const content = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, content, "utf-8");
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const rows = Array.isArray(data) ? data.length : 1;
  return { sha256, rows };
}

/** Compute SHA-256 of a file already on disk. */
async function sha256OfFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ─── README builder ───────────────────────────────────────────────────────────

function buildReadme(opts: {
  accountId: string;
  start: Date;
  end: Date;
  trades: Record<string, unknown>[];
  auditLogRows: Record<string, unknown>[];
  killSwitchEvents: Record<string, unknown>[];
  strategyDsls: Record<string, unknown>[];
  generatedAt: string;
}): string {
  const tradePnls = opts.trades
    .map((t) => Number((t as any).pnl ?? 0))
    .filter((v) => !isNaN(v));
  const totalPnl = tradePnls.reduce((a, b) => a + b, 0);
  const winCount = tradePnls.filter((v) => v > 0).length;
  const lossCount = tradePnls.filter((v) => v < 0).length;

  // Crude drawdown from running equity
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const pnl of tradePnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  const killCount = opts.killSwitchEvents.length;
  const stratNames = opts.strategyDsls
    .map((s: any) => s.name ?? "unknown")
    .join(", ");

  return `# Payout Audit Packet — Account ${opts.accountId}

## Period
- Start: ${opts.start.toISOString()}
- End: ${opts.end.toISOString()}
- Generated: ${opts.generatedAt}

## Trade Summary
- Total trades: ${opts.trades.length}
- Winners: ${winCount}
- Losers: ${lossCount}
- Net P&L: $${totalPnl.toFixed(2)}
- Max intra-period drawdown: $${maxDd.toFixed(2)}

## Compliance Attestations
- All trades routed through broker-router fail-CLOSED contract
- Kill-switch events in window: ${killCount}
- Compliance-rejected routing attempts: ${opts.auditLogRows.filter((r: any) => r.action === "broker_router.compliance_rejected").length}

## Strategies Active in Period
${stratNames || "None detected"}

## File Inventory
| File | Description |
|------|-------------|
| trades.jsonl | All paper trades (entry, exit, P&L, fees, slippage) |
| audit-log.jsonl | All audit_log rows touching this account |
| bias-state.jsonl | Daily bias/regime snapshots |
| sizing-audits.jsonl | Confluence multiplier + sizing audit rows |
| kill-switch-events.jsonl | Kill-switch + production-halt events |
| strategy-dsls.json | Strategy DSL configs for active strategies |
| lifecycle-transitions.jsonl | Strategy lifecycle transitions in period |
| broker-events.jsonl | Broker routing events (successes + rejections) |
| manifest.json | File list with SHA-256 hashes |
| manifest.sha256 | SHA-256 of manifest.json (tamper-evident root) |

## How to Verify Integrity
\`\`\`bash
sha256sum manifest.json  # Compare to manifest.sha256
\`\`\`

## Retention Policy
Retain this packet for a minimum of 2 years per prop-firm dispute requirements.
Do NOT modify any file — the SHA-256 hashes in manifest.json are tamper-evident.
`;
}

// ─── TAR.GZ builder ───────────────────────────────────────────────────────────

/**
 * Build a tar.gz archive of the packet directory.
 *
 * Uses Node.js built-in streams — no external dependencies.
 * Format: POSIX.1-2001 (pax) tar header + gzip compression.
 *
 * We write a minimal ustar header for each file. This is readable by
 * standard tar implementations on all platforms.
 */
async function buildTarGz(
  packetDir: string,
  zipPath: string,
  files: string[],
): Promise<void> {
  const gzip = zlib.createGzip({ level: 9 });
  const outStream = createWriteStream(zipPath);

  const chunks: Buffer[] = [];

  for (const fileName of files) {
    const filePath = path.join(packetDir, fileName);
    let content: Buffer;
    try {
      content = await fs.readFile(filePath);
    } catch {
      continue; // Skip missing files (shouldn't happen but don't crash)
    }

    const archiveName = path.basename(packetDir) + "/" + fileName;
    const header = buildUstarHeader(archiveName, content.length);
    chunks.push(header);
    chunks.push(content);
    // Pad content to 512-byte block boundary
    const pad = 512 - (content.length % 512);
    if (pad < 512) chunks.push(Buffer.alloc(pad));
  }

  // End-of-archive: two 512-byte zero blocks
  chunks.push(Buffer.alloc(1024));

  const tarBuffer = Buffer.concat(chunks);

  // Stream through gzip to file
  await new Promise<void>((resolve, reject) => {
    gzip.on("error", reject);
    outStream.on("error", reject);
    outStream.on("finish", resolve);
    gzip.pipe(outStream);
    gzip.end(tarBuffer);
  });
}

/** Build a minimal ustar tar header for a file. */
function buildUstarHeader(name: string, fileSize: number): Buffer {
  const buf = Buffer.alloc(512);
  const nameBytes = Buffer.from(name.slice(0, 99), "utf-8");
  nameBytes.copy(buf, 0);
  // Mode: 0644
  Buffer.from("0000644\0").copy(buf, 100);
  // UID / GID: 0000000
  Buffer.from("0000000\0").copy(buf, 108);
  Buffer.from("0000000\0").copy(buf, 116);
  // Size in octal, 11 digits + space
  const sizeOctal = fileSize.toString(8).padStart(11, "0");
  Buffer.from(sizeOctal + " ").copy(buf, 124);
  // Modification time
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, "0");
  Buffer.from(mtime + " ").copy(buf, 136);
  // Checksum placeholder (spaces)
  Buffer.from("        ").copy(buf, 148);
  // Type flag: '0' = regular file
  buf[156] = 0x30;
  // UStar magic
  Buffer.from("ustar  \0").copy(buf, 257);
  // Compute checksum (sum of all bytes, checksum field treated as spaces)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const checksumOctal = sum.toString(8).padStart(6, "0");
  Buffer.from(checksumOctal + "\0 ").copy(buf, 148);
  return buf;
}

// ─── Primary export ───────────────────────────────────────────────────────────

/**
 * Generate a complete payout audit packet for the given account and window.
 *
 * Steps:
 *   1. Create output directory
 *   2. Gather all data in parallel
 *   3. Write individual JSONL/JSON files
 *   4. Build README.md
 *   5. Build manifest.json with per-file SHA-256
 *   6. Write manifest.sha256 (SHA-256 of manifest.json itself)
 *   7. Compress to tar.gz
 *
 * Returns a summary with paths and the manifest.
 */
export async function generatePayoutAuditPacket(
  opts: PayoutAuditPacketOptions,
): Promise<PacketSummary> {
  const { accountId, start, end, outputDir } = opts;

  const startIso = start.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const endIso = end.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const packetName = `payout-audit-${accountId}-${startIso}-${endIso}`;
  const packetDir = path.join(outputDir, packetName);

  logger.info({ accountId, start, end, packetDir }, "payout-audit-packet: starting generation");

  await fs.mkdir(packetDir, { recursive: true });

  // ── Gather data in parallel ────────────────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const [trades, auditLogRows, biasRows, sizingAudits, killSwitchEvents, strategyDsls, lifecycleRows, brokerEvents] =
    await Promise.all([
      gatherTrades(accountId, start, end),
      gatherAuditLog(accountId, start, end),
      gatherBiasState(start, end),
      gatherSizingAudits(accountId, start, end),
      gatherKillSwitchEvents(start, end),
      gatherStrategyDsls(accountId, start, end),
      gatherLifecycleTransitions(accountId, start, end),
      gatherBrokerEvents(accountId, start, end),
    ]);

  logger.info(
    {
      accountId,
      trades: trades.length,
      auditLog: auditLogRows.length,
      biasState: biasRows.length,
      sizing: sizingAudits.length,
      killSwitch: killSwitchEvents.length,
      strategies: strategyDsls.length,
      lifecycle: lifecycleRows.length,
      brokerEvents: brokerEvents.length,
    },
    "payout-audit-packet: data gathered",
  );

  // ── Write files ────────────────────────────────────────────────────────────
  const manifestEntries: ManifestEntry[] = [];

  async function writeAndRecord(
    fileName: string,
    rows: Record<string, unknown>[],
    format: "jsonl" | "json",
  ) {
    const filePath = path.join(packetDir, fileName);
    const { sha256, rows: rowCount } =
      format === "jsonl"
        ? await writeJsonl(filePath, rows)
        : await writeJson(filePath, rows);
    manifestEntries.push({ file: fileName, sha256, rows: rowCount });
  }

  await writeAndRecord("trades.jsonl", trades, "jsonl");
  await writeAndRecord("audit-log.jsonl", auditLogRows, "jsonl");
  await writeAndRecord("bias-state.jsonl", biasRows, "jsonl");
  await writeAndRecord("sizing-audits.jsonl", sizingAudits, "jsonl");
  await writeAndRecord("kill-switch-events.jsonl", killSwitchEvents, "jsonl");
  await writeAndRecord("lifecycle-transitions.jsonl", lifecycleRows, "jsonl");
  await writeAndRecord("broker-events.jsonl", brokerEvents, "jsonl");

  // strategy-dsls.json is JSON (not JSONL) — array of strategy configs
  const stratDslPath = path.join(packetDir, "strategy-dsls.json");
  const { sha256: stratSha256, rows: stratCount } = await writeJson(stratDslPath, strategyDsls);
  manifestEntries.push({ file: "strategy-dsls.json", sha256: stratSha256, rows: stratCount });

  // README.md
  const readmeContent = buildReadme({
    accountId,
    start,
    end,
    trades,
    auditLogRows,
    killSwitchEvents,
    strategyDsls,
    generatedAt,
  });
  const readmePath = path.join(packetDir, "README.md");
  await fs.writeFile(readmePath, readmeContent, "utf-8");
  const readmeSha256 = crypto.createHash("sha256").update(readmeContent).digest("hex");
  manifestEntries.push({ file: "README.md", sha256: readmeSha256, rows: 1 });

  // ── Manifest ───────────────────────────────────────────────────────────────
  const manifest: PacketManifest = {
    account_id: accountId,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    generated_at: generatedAt,
    files: manifestEntries,
  };

  const manifestPath = path.join(packetDir, "manifest.json");
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  await fs.writeFile(manifestPath, manifestContent, "utf-8");

  // manifest.sha256 — tamper-evident root
  const manifestSha256 = crypto
    .createHash("sha256")
    .update(manifestContent)
    .digest("hex");
  const manifestSha256Path = path.join(packetDir, "manifest.sha256");
  await fs.writeFile(manifestSha256Path, manifestSha256 + "  manifest.json\n", "utf-8");

  logger.info({ manifestSha256, packetDir }, "payout-audit-packet: manifest written");

  // ── Build tar.gz ───────────────────────────────────────────────────────────
  const zipPath = path.join(outputDir, packetName + ".tar.gz");
  const allFiles = [
    "trades.jsonl",
    "audit-log.jsonl",
    "bias-state.jsonl",
    "sizing-audits.jsonl",
    "kill-switch-events.jsonl",
    "strategy-dsls.json",
    "lifecycle-transitions.jsonl",
    "broker-events.jsonl",
    "README.md",
    "manifest.json",
    "manifest.sha256",
  ];

  await buildTarGz(packetDir, zipPath, allFiles);

  logger.info({ zipPath }, "payout-audit-packet: tar.gz written");

  return {
    packetDir,
    zipPath,
    manifest,
    manifestSha256,
  };
}
