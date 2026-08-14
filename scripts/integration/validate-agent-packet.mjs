#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMPILER = [{
  command: "python",
  args: ["-m", "pytest", "src/engine/tests/test_pilot_conveyor.py", "src/engine/tests/test_spec_producer.py", "src/engine/tests/test_svkm_role_execution.py", "-q", "--tb=short"],
}];

const RUNTIME = [
  {
    command: "npx",
    args: [
      "vitest", "run",
      "src/data/fetchers/massive.test.ts",
      "src/data/fetchers/massive-websocket-protocol.test.ts",
      "src/server/__tests__/first-paper-trade-smoke.test.ts",
      "src/server/__tests__/paper-trading-stream-correlation-id.test.ts",
      "src/server/services/paper-trading-stream.feed-gap-wiring.test.ts",
      "src/server/__tests__/broker-router.test.ts",
      "src/server/__tests__/fill-reconciliation.test.ts",
      "src/server/services/paper-execution-service.double-close-idempotency.test.ts",
      "src/server/__tests__/kill-switch.test.ts",
      "src/server/__tests__/failure-injection-kill-switch-l2-l3-force-close.test.ts",
      "src/server/integrations/topstepx/__tests__/offline-adapter.test.ts",
      "src/server/lib/__tests__/running-code-identity.test.ts",
    ],
  },
  {
    command: "node",
    args: ["--test", "scripts/watchdog/__tests__/api-liveness-watchdog.test.mjs", "scripts/watchdog/__tests__/register-api-liveness-watchdog-task.test.mjs", "scripts/rails/__tests__/full-lane.test.mjs"],
  },
];

const GATES = [
  { command: "npm", args: ["run", "build"] },
  { command: "npm", args: ["run", "check:production-isolation"] },
  { command: "npm", args: ["run", "check:2026-compliance"] },
  { command: "npm", args: ["run", "system-map:check"] },
];

export function buildValidationPlan(profile) {
  if (profile === "compiler") return [...COMPILER, ...GATES];
  if (profile === "runtime") return [...RUNTIME, ...GATES];
  if (profile === "integration") return [...COMPILER, ...RUNTIME, ...GATES];
  throw new Error(`invalid_validation_profile:${profile}`);
}

function run(command, args, options = {}) {
  let resolvedCommand = command;
  let resolvedArgs = args;
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    resolvedCommand = process.execPath;
    resolvedArgs = command === "npm" ? [npmCli, ...args] : [npmCli, "exec", "--", ...args];
  }
  return spawnSync(resolvedCommand, resolvedArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function git(args) {
  const result = run("git", args);
  if (result.status !== 0) throw new Error(`git_failed:${args.join(" ")}:${result.stderr.trim()}`);
  return result.stdout.trim();
}

function parseArgs(argv) {
  const parsed = { profile: "integration", plan: false, base: null, candidate: null, receipt: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--plan") parsed.plan = true;
    else if (arg === "--profile") parsed.profile = argv[++index];
    else if (arg === "--base") parsed.base = argv[++index];
    else if (arg === "--candidate") parsed.candidate = argv[++index];
    else if (arg === "--receipt") parsed.receipt = argv[++index];
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

function requireSha(label, value) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? "")) throw new Error(`${label}_must_be_full_sha`);
}

function executeCli() {
  const args = parseArgs(process.argv.slice(2));
  const commands = buildValidationPlan(args.profile);
  if (args.plan) {
    process.stdout.write(`${JSON.stringify({ profile: args.profile, commands }, null, 2)}\n`);
    return;
  }

  requireSha("base", args.base);
  requireSha("candidate", args.candidate);
  const actualCandidate = git(["rev-parse", "HEAD"]);
  if (actualCandidate !== args.candidate) throw new Error(`candidate_head_mismatch:${actualCandidate}`);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) throw new Error("candidate_worktree_dirty");
  const ancestor = run("git", ["merge-base", "--is-ancestor", args.base, args.candidate]);
  if (ancestor.status !== 0) throw new Error("base_is_not_candidate_ancestor");
  const changedFiles = git(["diff", "--name-only", `${args.base}..${args.candidate}`]).split(/\r?\n/).filter(Boolean);

  const results = [];
  for (const spec of commands) {
    const startedAt = new Date().toISOString();
    const result = run(spec.command, spec.args, { stdio: "inherit", encoding: undefined });
    results.push({ ...spec, startedAt, exitCode: result.status ?? 1 });
    if (result.status !== 0) break;
  }
  const receipt = {
    schema: "trading-forge-agent-packet-validation-v1",
    generatedAt: new Date().toISOString(),
    profile: args.profile,
    base: args.base,
    candidate: args.candidate,
    changedFiles,
    results,
    verdict: results.length === commands.length && results.every((result) => result.exitCode === 0) ? "green" : "red",
  };
  if (args.receipt) writeFileSync(path.resolve(args.receipt), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.verdict !== "green") process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    executeCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
