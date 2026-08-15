#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COORDINATION_RULES = [
  { kind: 'exact', value: 'package.json', reason: 'shared package contract' },
  { kind: 'exact', value: 'src/server/db/schema.ts', reason: 'shared database schema' },
  { kind: 'exact', value: 'src/server/index.ts', reason: 'shared server composition root' },
  { kind: 'prefix', value: '.github/workflows/', reason: 'shared CI workflow' },
  { kind: 'prefix', value: 'src/server/db/migrations/', reason: 'shared database migration' },
];

const WORKER_1_RULES = [
  { kind: 'exact', value: 'src/server/lib/decision-atom.ts' },
  { kind: 'exact', value: 'scripts/atomize-transcript.ts' },
  { kind: 'contains', value: '/compiler/' },
  { kind: 'prefix', value: 'compiler/' },
  { kind: 'contains', value: 'strategy-factory' },
  { kind: 'contains', value: 'decision-atom' },
  { kind: 'contains', value: 'atomize-transcript' },
];

const WORKER_2_RULES = [
  { kind: 'prefix', value: 'src/server/services/paper-' },
  { kind: 'exact', value: 'src/server/routes/paper.ts' },
  { kind: 'contains', value: 'fill-reconciliation-service' },
  { kind: 'contains', value: 'server-mediated-executor' },
  { kind: 'contains', value: '/watchdog/' },
  { kind: 'contains', value: '/recovery/' },
  { kind: 'exact', value: 'src/server/middleware/auth.ts' },
  { kind: 'contains', value: 'auth.middleware' },
  { kind: 'contains', value: 'auth-middleware' },
];

function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('changed path must be a non-empty string');
  }
  const normalized = input.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`unsafe repository path: ${input}`);
  }
  return normalized;
}

function matchesRule(repoPath, rule) {
  if (rule.kind === 'exact') return repoPath === rule.value;
  if (rule.kind === 'prefix') return repoPath.startsWith(rule.value);
  if (rule.kind === 'contains') return repoPath.includes(rule.value);
  throw new Error(`unknown rule kind: ${rule.kind}`);
}

function matchAny(repoPath, rules) {
  return rules.find((rule) => matchesRule(repoPath, rule));
}

function relatedTestOwnership(repoPath) {
  const lower = repoPath.toLowerCase();
  if (!lower.includes('test') && !lower.includes('spec')) return null;
  if (
    lower.includes('compiler') ||
    lower.includes('strategy-factory') ||
    lower.includes('decision-atom') ||
    lower.includes('atomize-transcript')
  ) return 'worker-1';
  if (
    lower.includes('paper') ||
    lower.includes('reconciliation') ||
    lower.includes('executor') ||
    lower.includes('watchdog') ||
    lower.includes('recovery') ||
    lower.includes('auth')
  ) return 'worker-2';
  return null;
}

export function classifyPath(worker, rawPath) {
  if (!['worker-1', 'worker-2'].includes(worker)) {
    throw new Error(`worker must be worker-1 or worker-2, got: ${worker}`);
  }
  const repoPath = normalizeRepoPath(rawPath);

  const coordination = matchAny(repoPath, COORDINATION_RULES);
  if (coordination) {
    return {
      path: repoPath,
      verdict: 'HANDOFF_REQUIRED',
      reason: coordination.reason,
    };
  }

  const worker1 = matchAny(repoPath, WORKER_1_RULES) || relatedTestOwnership(repoPath) === 'worker-1';
  const worker2 = matchAny(repoPath, WORKER_2_RULES) || relatedTestOwnership(repoPath) === 'worker-2';

  if (worker === 'worker-1' && worker2) {
    return { path: repoPath, verdict: 'BLOCK', reason: 'obvious Worker 2 runtime/safety ownership' };
  }
  if (worker === 'worker-2' && worker1) {
    return { path: repoPath, verdict: 'BLOCK', reason: 'obvious Worker 1 compiler/factory ownership' };
  }
  if (worker === 'worker-1' && worker1) {
    return { path: repoPath, verdict: 'ALLOW_LANE_MATCH', reason: 'matches Worker 1 compiler/factory path evidence' };
  }
  if (worker === 'worker-2' && worker2) {
    return { path: repoPath, verdict: 'ALLOW_LANE_MATCH', reason: 'matches Worker 2 runtime/safety path evidence' };
  }

  return {
    path: repoPath,
    verdict: 'REVIEW_REQUIRED',
    reason: 'path ownership is not provable from the bounded path rules; semantic authority must be checked',
  };
}

export function auditPaths(worker, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('at least one changed path is required');
  }
  const results = paths.map((p) => classifyPath(worker, p));
  const blocking = results.filter((x) => ['BLOCK', 'HANDOFF_REQUIRED', 'REVIEW_REQUIRED'].includes(x.verdict));
  return {
    schema: 'gpt-lane-boundary-audit-v1',
    worker,
    safe_to_edit_without_handoff: blocking.length === 0,
    results,
    summary: {
      allow: results.filter((x) => x.verdict === 'ALLOW_LANE_MATCH').length,
      block: results.filter((x) => x.verdict === 'BLOCK').length,
      handoff_required: results.filter((x) => x.verdict === 'HANDOFF_REQUIRED').length,
      review_required: results.filter((x) => x.verdict === 'REVIEW_REQUIRED').length,
    },
  };
}

function parseCli(argv) {
  let worker = null;
  let pathsFile = null;
  const paths = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--worker') worker = argv[++i];
    else if (arg === '--paths-file') pathsFile = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    else paths.push(arg);
  }
  if (!worker) throw new Error('--worker is required');
  if (pathsFile) {
    const parsed = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('--paths-file must contain a JSON array of repository paths');
    paths.push(...parsed);
  }
  return { worker, paths };
}

function main() {
  try {
    const { worker, paths } = parseCli(process.argv.slice(2));
    const audit = auditPaths(worker, paths);
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    if (!audit.safe_to_edit_without_handoff) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`lane-boundary-guard: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
