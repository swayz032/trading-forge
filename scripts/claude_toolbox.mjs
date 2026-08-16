#!/usr/bin/env node
/**
 * WORKER-1 PROTECTION TOOLBOX ACTIVATOR — AR-1236 §11 / AR-1230.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT A COPY
 *   AR-1194..AR-1198 built a worker protection toolbox. AR-1230 authorized activating it and
 *   AR-1236 §11 repeated the order with its constraint: **"Do not rebuild them."**
 *
 *   MEASURED: the toolbox is real (37 files) and it lives on `origin/external-advisor/
 *   gpt-speed-engineering`, a ref this worktree never checks out. From the Worker-1 seat it was
 *   therefore BUILT-UNREACHABLE — present in the repository, reachable by nothing the worker runs.
 *   That is the exact species `system_inventory.py` exists to surface, and it is why "already
 *   built" and "actually usable" are different claims.
 *
 *   🛑 COPYING THE FILES INTO THIS BRANCH WOULD BE A REBUILD WITH EXTRA STEPS. Two copies of a
 *   guard drift, and the copy that drifts is the one that stops biting while still reporting
 *   PASS. So this materializes the tooling FROM THE PINNED REF into a throwaway cache and runs
 *   it there. The ref is the single source; this file is a doorway, not a fork.
 *
 * PROVENANCE
 *   Every run records the ref, the resolved commit, and the sha256 of each materialized file.
 *   If the toolbox moves, the receipt changes and the drift is visible instead of silent.
 *
 * Usage:
 *   node scripts/claude_toolbox.mjs preflight   --worker worker-1 --branch B --head H --paths a,b
 *   node scripts/claude_toolbox.mjs theater     --files <test files...>
 *   node scripts/claude_toolbox.mjs finish      --json <finish-check payload path>
 *   node scripts/claude_toolbox.mjs materialize            # cache only, print the receipt
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLBOX_REF = 'origin/external-advisor/gpt-speed-engineering';
const TOOLBOX_DIR = 'advisor-prepared/gpt-speed-engineering-lane/tooling';
const CACHE = path.join(os.tmpdir(), 'tf-claude-toolbox');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Materialize the pinned tooling into a cache dir. Returns a provenance receipt. */
export function materialize() {
  let commit;
  try {
    commit = git(['rev-parse', TOOLBOX_REF]).trim();
  } catch {
    throw new Error(
      `TOOLBOX REF NOT FOUND: ${TOOLBOX_REF}. The toolbox is not rebuilt here by design — ` +
      `without the ref there is nothing to activate, and inventing a replacement is exactly ` +
      `what AR-1236 §11 forbids. Fetch the ref and re-run.`,
    );
  }

  const files = git(['ls-tree', '-r', '--name-only', commit, '--', TOOLBOX_DIR])
    .split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.mjs'));
  if (files.length === 0) throw new Error(`no .mjs files under ${TOOLBOX_DIR} at ${commit}`);

  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });

  const manifest = [];
  for (const f of files) {
    const body = git(['show', `${commit}:${f}`]);
    const name = path.basename(f);
    fs.writeFileSync(path.join(CACHE, name), body, 'utf8');
    manifest.push({ file: name, sha256: crypto.createHash('sha256').update(body).digest('hex') });
  }

  return {
    schema: 'worker1-toolbox-activation-v1',
    authority: 'AR-1236 §11 (activate, do not rebuild) + AR-1230',
    ref: TOOLBOX_REF,
    commit,
    cache: CACHE,
    file_count: manifest.length,
    manifest,
    note:
      'Materialized FROM the pinned ref, never copied into the worker branch. One source of ' +
      'truth; a drifting second copy of a guard is a guard that stops biting while still ' +
      'reporting PASS.',
  };
}

async function load(name) {
  const p = path.join(CACHE, name);
  if (!fs.existsSync(p)) materialize();
  return import(`file://${path.join(CACHE, name)}`);
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const cmd = process.argv[2];
  const receipt = materialize();

  if (cmd === 'materialize') {
    console.log(JSON.stringify(receipt, null, 2));
    return 0;
  }

  if (cmd === 'preflight') {
    const { runClaudePreflight } = await load('claude-preflight.mjs');
    const out = runClaudePreflight({
      cwd: process.cwd(),
      worker: arg('--worker', 'worker-1'),
      expectedBranch: arg('--branch'),
      expectedHead: arg('--head'),
      intendedPaths: (arg('--paths', '') || '').split(',').filter(Boolean),
    });
    console.log(JSON.stringify({ toolbox: { ref: receipt.ref, commit: receipt.commit }, ...out }, null, 2));
    return out.ok ? 0 : 1;
  }

  if (cmd === 'theater') {
    const { auditTestText } = await load('test-theater-detector.mjs');
    const files = process.argv.slice(process.argv.indexOf('--files') + 1);
    const rows = files.map((f) => {
      const text = fs.readFileSync(f, 'utf8');
      const r = auditTestText({ text, critical: true, requireMutationEvidence: true, mutationEvidence: true });
      return { file: f, ...r };
    });
    // 🛑 THE FIELD IS `hard_failures`, NOT `hardFailures`. The first version of this line read the
    // camelCase name, which is `undefined` on every row — so it reported "0 hard failures" while
    // the tool itself was returning verdict BLOCK. A false green IN THE RUNNER, in a runner whose
    // whole job is catching false greens. Caught only by a planted positive control, which is why
    // a clean result from an unproven detector is worth nothing. Verdict is read too, so a future
    // rename breaks loudly instead of silently passing.
    const failed = rows.filter((r) => r.hard_failures?.length || r.verdict === 'BLOCK');
    console.log(JSON.stringify({
      toolbox: { ref: receipt.ref, commit: receipt.commit },
      audited: rows.length, hard_failures: failed.length, rows,
    }, null, 2));
    return failed.length ? 1 : 0;
  }

  if (cmd === 'finish') {
    // AR-1239 §8: the usage block advertised `finish` while the dispatcher exposed only
    // materialize/preflight/theater. An advertised command that does not exist is a false
    // capability claim in the tool whose job is checking claims — so it is wired, not deleted.
    const { runClaudeFinishCheck } = await load('claude-finish-check.mjs');
    const payloadPath = arg('--json');
    if (!payloadPath) {
      console.error('finish requires --json <path> with {worker, base, scope, receipt}');
      return 2;
    }
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const out = runClaudeFinishCheck({ cwd: process.cwd(), ...payload });
    console.log(JSON.stringify({ toolbox: { ref: receipt.ref, commit: receipt.commit }, ...out }, null, 2));
    return out.ok ? 0 : 1;
  }

  console.error('usage: materialize | preflight | theater --files <...> | finish --json <path>');
  return 2;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('claude_toolbox.mjs')) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(String(e.message || e)); process.exit(3); });
}
