#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function changedFiles(repo, base, head) {
  const out = git(repo, ['diff', '--name-only', `${base}..${head}`]);
  return out ? [...new Set(out.split(/\r?\n/).filter(Boolean))].sort() : [];
}

export function auditBranchCollision(repo, left, right, base = null) {
  if (!left || !right) throw new Error('left and right refs are required');
  const resolvedBase = base || git(repo, ['merge-base', left, right]);
  const leftFiles = changedFiles(repo, resolvedBase, left);
  const rightFiles = changedFiles(repo, resolvedBase, right);
  const rightSet = new Set(rightFiles);
  const overlaps = leftFiles.filter((file) => rightSet.has(file));
  return {
    schema: 'gpt-worker-branch-collision-audit-v1',
    base: resolvedBase,
    left,
    right,
    left_files: leftFiles,
    right_files: rightFiles,
    exact_path_overlaps: overlaps,
    exact_path_overlap_count: overlaps.length,
    safe_from_exact_path_collision: overlaps.length === 0,
    note: overlaps.length === 0
      ? 'No exact path collision found. Semantic/shared-contract coordination rules still apply.'
      : 'Exact path collision found. Do not let workers silently resolve semantic ownership; use the handoff contract.',
  };
}

function parseCli(argv) {
  let repo = '.';
  let left = null;
  let right = null;
  let base = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') repo = argv[++i];
    else if (arg === '--left') left = argv[++i];
    else if (arg === '--right') right = argv[++i];
    else if (arg === '--base') base = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { repo, left, right, base };
}

function main() {
  try {
    const args = parseCli(process.argv.slice(2));
    const result = auditBranchCollision(args.repo, args.left, args.right, args.base);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.safe_from_exact_path_collision) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`branch-collision-audit: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
