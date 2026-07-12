"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { persistRailRun } = require("./rail-runtime.cjs");

function decideDivergence({ pairs, threshold }) {
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { verdict: "ALARM", lines: ["divergence threshold is invalid (fail-closed)"] };
  }
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { verdict: "ALARM", lines: ["branch evidence is empty (fail-closed)"] };
  }

  const lines = [];
  for (const pair of pairs) {
    if (!pair
      || !Number.isInteger(pair.ahead)
      || !Number.isInteger(pair.behind)
      || typeof pair.ffPossible !== "boolean") {
      lines.push(`${pair?.name ?? "unknown"}: UNREADABLE branch evidence (fail-closed)`);
      continue;
    }
    if (!pair.ffPossible) {
      lines.push(`${pair.name}: histories FORKED (no fast-forward reconciliation)`);
      continue;
    }
    if (pair.ahead > threshold || pair.behind > threshold) {
      lines.push(`${pair.name}: local ${pair.ahead} ahead / ${pair.behind} behind origin (threshold ${threshold})`);
    }
  }
  return { verdict: lines.length > 0 ? "ALARM" : "OK", lines };
}

function git(repoDir, args) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isAncestor(repoDir, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function collectBranchPairs(repoDir, branches) {
  try {
    git(repoDir, ["fetch", "origin", "--quiet"]);
  } catch {
    return branches.map((name) => ({ name, ahead: null, behind: null, ffPossible: null }));
  }

  return branches.map((name) => {
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
      return { name, ahead: null, behind: null, ffPossible: null };
    }
    const local = name;
    const remote = `origin/${name}`;
    try {
      git(repoDir, ["show-ref", "--verify", `refs/heads/${name}`]);
      git(repoDir, ["show-ref", "--verify", `refs/remotes/origin/${name}`]);
      const ahead = Number(git(repoDir, ["rev-list", "--count", `${remote}..${local}`]));
      const behind = Number(git(repoDir, ["rev-list", "--count", `${local}..${remote}`]));
      const ffPossible = isAncestor(repoDir, local, remote)
        || isAncestor(repoDir, remote, local);
      return { name, ahead, behind, ffPossible };
    } catch {
      return { name, ahead: null, behind: null, ffPossible: null };
    }
  });
}

function formatMessage(result, pairs) {
  if (result.verdict === "OK") {
    return `GREEN Tower Rails divergence: ${pairs.map((p) => `${p.name} ${p.ahead}/${p.behind}`).join("; ")}`;
  }
  return `RED Tower Rails divergence:\n${result.lines.map((line) => `- ${line}`).join("\n")}`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run") || args.has("--test-skew");
  const repoDir = path.resolve(process.env.TF_REPO_DIR ?? process.cwd());
  const threshold = Number(process.env.RAILS_DIVERGENCE_THRESHOLD ?? 10);
  const branches = (process.env.RAILS_DIVERGENCE_BRANCHES ?? "hardening/phase-0,main")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const pairs = args.has("--test-skew")
    ? [{ name: "main", ahead: 0, behind: threshold + 1, ffPossible: true }]
    : collectBranchPairs(repoDir, branches);
  const result = decideDivergence({ pairs, threshold });
  const payload = {
    thresholdVersion: "rails_thresholds_v1",
    threshold,
    pairs,
    ...result,
  };
  console.log(JSON.stringify(payload, null, 2));

  const persisted = await persistRailRun({
    repoDir,
    rail: "divergence",
    action: args.has("--test-skew") ? "rails.divergence_checked_test" : "rails.divergence_checked",
    payload,
    message: formatMessage(result, pairs),
    notify: result.verdict === "ALARM",
    dryRun,
  });
  if (!persisted.ok) {
    console.error(`RAIL_PERSISTENCE_RED ${JSON.stringify(persisted)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectBranchPairs,
  decideDivergence,
  formatMessage,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`DIVERGENCE_RAIL_RED ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
