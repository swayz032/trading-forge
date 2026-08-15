#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectDiffScope } from './edit-scope-guard.mjs';
import { auditPaths } from './lane-boundary-guard.mjs';
import { verifyReceipt } from './commit-evidence-verifier.mjs';
import { auditBranchCollision } from './branch-collision-audit.mjs';

function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

export function runClaudeFinishCheck({ cwd = process.cwd(), worker, base, head = 'HEAD', scope, receipt, otherWorkerRef = null, collisionBase = null }) {
  if (!['worker-1', 'worker-2'].includes(worker)) throw new Error('worker must be worker-1 or worker-2');
  if (!base) throw new Error('base is required');
  if (!scope || typeof scope !== 'object') throw new Error('scope is required');
  if (!receipt || typeof receipt !== 'object') throw new Error('receipt is required');

  const resolvedHead = git(cwd, ['rev-parse', `${head}^{commit}`]);
  const dirty = git(cwd, ['status', '--porcelain']).length > 0;
  const scopeResult = inspectDiffScope({ cwd, base, head: resolvedHead, scope });
  const changed = scopeResult.changed_paths;
  const lane = changed.length > 0 ? auditPaths(worker, changed) : null;
  const evidence = verifyReceipt(receipt, cwd);
  let receiptHead = null;
  try { if (receipt.commit) receiptHead = git(cwd, ['rev-parse', `${receipt.commit}^{commit}`]); } catch { receiptHead = null; }
  const collision = otherWorkerRef ? auditBranchCollision(cwd, resolvedHead, otherWorkerRef, collisionBase) : null;

  const failures = [];
  if (dirty) failures.push('worktree is dirty after reported completion');
  if (changed.length === 0) failures.push('packet contains no changed paths');
  if (!scopeResult.ok) failures.push('actual diff escaped authorized edit scope');
  if (lane && !lane.safe_to_edit_without_handoff) failures.push('actual diff requires lane review/handoff or crosses worker ownership');
  if (!evidence.ok) failures.push('commit/evidence receipt failed mechanical verification');
  if (receiptHead !== resolvedHead) failures.push('reported receipt commit is not the checked head commit');
  if (collision && !collision.safe_from_exact_path_collision) failures.push('other worker branch has exact changed-path collision');

  return {
    schema: 'gpt-claude-finish-check-v1', ok: failures.length === 0,
    verdict: failures.length === 0 ? 'PASS_FOR_GPT_REVIEW' : 'STOP',
    worker, base, head: resolvedHead, clean: !dirty, scope: scopeResult, lane, evidence, collision, failures,
    note: 'PASS_FOR_GPT_REVIEW is mechanical only; GPT must still inspect production semantics, RED/GREEN validity, controls, architecture, and CI.',
  };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function main() {
  try {
    const input = arg('--input'); if (!input) throw new Error('--input config.json is required');
    const c = JSON.parse(fs.readFileSync(input, 'utf8'));
    const r = runClaudeFinishCheck({ cwd: arg('--repo') || process.cwd(), worker: c.worker, base: c.base, head: c.head || 'HEAD', scope: c.scope, receipt: c.receipt, otherWorkerRef: c.other_worker_ref || null, collisionBase: c.collision_base || null });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); if (!r.ok) process.exitCode = 3;
  } catch (error) { process.stderr.write(`claude-finish-check: ${error.message}\n`); process.exitCode = 2; }
}
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
