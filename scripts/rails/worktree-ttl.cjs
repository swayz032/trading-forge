"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { persistRailRun } = require("./rail-runtime.cjs");

const DAY_MS = 86_400_000;

function parseWorktreePorcelain(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }
  return text.trim().split(/\r?\n\r?\n/).map((record, index) => {
    const lines = record.split(/\r?\n/);
    const value = (prefix) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? null;
    const branchRef = value("branch ");
    return {
      path: value("worktree "),
      head: value("HEAD "),
      branch: branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : null,
      isMain: index === 0,
      locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
    };
  });
}

function summarizeWorktrees(entries, nowMs, ttlDays) {
  if (!Array.isArray(entries)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(ttlDays)
    || ttlDays < 0) {
    throw new Error("worktree_ttl_invalid");
  }
  const stale = [];
  const unreadable = [];
  for (const entry of entries) {
    if (entry?.isMain) continue;
    if (!entry
      || !Number.isFinite(entry.mtimeMs)
      || !Number.isInteger(entry.uniqueCommits)
      || entry.uniqueCommits < 0) {
      unreadable.push(entry ?? { path: "unknown" });
      continue;
    }
    const ageDays = (nowMs - entry.mtimeMs) / DAY_MS;
    if (ageDays > ttlDays) {
      stale.push({ ...entry, ageDays: Number(ageDays.toFixed(1)) });
    }
  }
  stale.sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path));
  unreadable.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { stale, unreadable, count: stale.length };
}

function git(repoDir, args) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function collectWorktreeEvidence(repoDir) {
  const parsed = parseWorktreePorcelain(git(repoDir, ["worktree", "list", "--porcelain"]));
  return parsed.map((entry) => {
    let mtimeMs = null;
    let uniqueCommits = null;
    try {
      mtimeMs = fs.statSync(entry.path).mtimeMs;
    } catch {
      // Kept null and surfaced as unreadable by summarizeWorktrees.
    }
    try {
      uniqueCommits = Number(git(repoDir, ["rev-list", "--count", entry.head, "--not", "--remotes"]));
    } catch {
      // Kept null and surfaced as unreadable by summarizeWorktrees.
    }
    return { ...entry, mtimeMs, uniqueCommits };
  });
}

function formatMessage(summary, ttlDays) {
  if (summary.stale.length === 0 && summary.unreadable.length === 0) {
    return `GREEN Tower Rails worktrees: none older than ${ttlDays} days.`;
  }
  const lines = [
    `AMBER Tower Rails worktrees: ${summary.stale.length} older than ${ttlDays} days; ${summary.unreadable.length} unreadable.`,
    ...summary.stale.map((entry) => `- ${entry.path} (${entry.branch ?? "detached"}, ${entry.ageDays}d, ${entry.uniqueCommits} unique commits)`),
    ...summary.unreadable.map((entry) => `- UNREADABLE ${entry.path ?? "unknown"}`),
  ];
  return lines.join("\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const repoDir = path.resolve(process.env.TF_REPO_DIR ?? process.cwd());
  const ttlDays = Number(process.env.RAILS_WORKTREE_TTL_DAYS ?? 7);
  const evidence = collectWorktreeEvidence(repoDir);
  const summary = summarizeWorktrees(evidence, Date.now(), ttlDays);
  const payload = {
    thresholdVersion: "rails_thresholds_v1",
    ttlDays,
    worktreeCount: evidence.length,
    ...summary,
  };
  console.log(JSON.stringify(payload, null, 2));

  const persisted = await persistRailRun({
    repoDir,
    rail: "worktree-ttl",
    action: "rails.worktree_ttl_reported",
    payload,
    message: formatMessage(summary, ttlDays),
    notify: true,
    dryRun,
  });
  if (!persisted.ok) {
    console.error(`RAIL_PERSISTENCE_RED ${JSON.stringify(persisted)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectWorktreeEvidence,
  formatMessage,
  parseWorktreePorcelain,
  summarizeWorktrees,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`WORKTREE_TTL_RAIL_RED ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
