#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyResumeAnchor } from './resume-anchor-guard.mjs';
import { auditPaths } from './lane-boundary-guard.mjs';

export function runClaudePreflight({ cwd = process.cwd(), worker, expectedBranch, expectedHead, intendedPaths }) {
  if (!['worker-1', 'worker-2'].includes(worker)) throw new Error('worker must be worker-1 or worker-2');
  if (!Array.isArray(intendedPaths) || intendedPaths.length === 0) throw new Error('intended_paths must be a non-empty array');

  const anchor = verifyResumeAnchor({ cwd, expectedBranch, expectedHead, requireClean: true });
  const lane = auditPaths(worker, intendedPaths);
  const ok = anchor.ok && lane.safe_to_edit_without_handoff;

  return {
    schema: 'gpt-claude-preflight-v1',
    ok,
    verdict: ok ? 'PASS' : 'STOP',
    worker,
    anchor,
    lane,
    note: 'PASS verifies paused-state and bounded path ownership only; it is not semantic authorization beyond the active order.',
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  try {
    const input = arg('--input');
    if (!input) throw new Error('--input config.json is required');
    const config = JSON.parse(fs.readFileSync(input, 'utf8'));
    const result = runClaudePreflight({
      cwd: arg('--repo') || process.cwd(),
      worker: config.worker,
      expectedBranch: config.expected_branch,
      expectedHead: config.expected_head,
      intendedPaths: config.intended_paths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`claude-preflight: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
