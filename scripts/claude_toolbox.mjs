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

// AR-1266 §E: re-pointed from `origin/external-advisor/gpt-speed-engineering` to the branch
// carrying the AR-1265-reviewed toolbox. The base branch is the ANCESTOR of this one, so the
// authority did not change hands — the reviewed repairs simply live two commits further on.
// Left as a HINT only; the pin below is still the authority.
const TOOLBOX_REF = 'origin/claude/worker1-p1-toolbox-20260816';
const TOOLBOX_DIR = 'advisor-prepared/gpt-speed-engineering-lane/tooling';
const CACHE = path.join(os.tmpdir(), 'tf-claude-toolbox');

/**
 * IMMUTABLE PIN — the P1 item that stood OPEN from AR-1239 §14 through AR-1249.
 *
 * 🛑 WHY A BRANCH REF WAS NOT ENOUGH. `TOOLBOX_REF` is a BRANCH, and a branch moves. Every run
 * silently adopted whatever that branch pointed at, so the guards protecting this seat could be
 * changed under it between two runs and the receipt would faithfully record the new commit
 * without anything ever saying "this is not what you activated". A provenance receipt that
 * reports a moving target documents drift; it does not detect it.
 *
 * So the pin is the authority and the branch is only a hint. `materialize()` resolves the PIN,
 * and separately reports whether the branch has moved away from it. Drift becomes a visible fact
 * instead of a silent upgrade.
 */
// RE-PINNED 2026-08-16 by AR-1266 §E, on AR-1265's order to "integrate the exact reviewed
// toolbox ... refresh the toolbox pin/bundle identity to the exact reviewed source".
//   dd1bc230 -> 6a06ffae   (AR-1264 A+C, then AR-1266 A-C)
// RE-PINNED AGAIN 2026-08-16 by AR-1268 §G, on AR-1267 §9G ("Integrate by deliberate immutable
// re-pin, not copy"):
//   6a06ffae -> e0c44ca4   (AR-1268 A/C/D/E — the four pre-call boundary edges)
// RE-PINNED AGAIN 2026-08-16 by AR-1270 §C, on AR-1269 §6C:
//   e0c44ca4 -> 18108039   (AR-1270 A/B — the two trust-surface gaps AR-1269 §4/§5 left RED:
//                           the G2 queue + receipt namespace become SELF_PROTECTED, and a
//                           protected-surface fence closes Bash as a side door around the path
//                           classifier). Member diff: 3 files, +377/-12. Descendant verified with
//                           `git merge-base --is-ancestor e0c44ca4 18108039`.
// RE-PINNED AGAIN 2026-08-16 by the guard-repair seat, on the operator's explicit instruction:
//   18108039 -> b6c70282   (the SessionStart -> PreToolUse lifecycle repair). 18108039's guard
//                           DENIED EVERY TOOL CALL IN A CORRECTLY-LAUNCHED SEAT and did it
//                           silently: SessionStart wrote `TF_CLAUDE_GUARD_ANCHOR_OK=1` into the
//                           file at CLAUDE_ENV_FILE, PreToolUse read that name from its own
//                           process env, and — MEASURED in the shipped claude.exe — nothing ever
//                           carries it across, because CLAUDE_ENV_FILE reaches only
//                           SessionStart/Setup/CwdChanged/FileChanged and feeds the BASH TOOL's
//                           shell. Fail-CLOSED, so three seats could not see it. b6c70282 deletes
//                           that variable and arms through a marker BOUND to session + worktree +
//                           git dir + branch + head + pin + bundle, most of it RE-MEASURED per
//                           tool call. Member diff: 8 files, +1199/-65 (2 new toolbox modules, so
//                           the bundle covers 44 files, not 42). Descendant verified with
//                           `git merge-base --is-ancestor 18108039 b6c70282`.
//
// 🛑 THIS CONSTANT IS HALF OF A RE-PIN, AND THE HALF THAT IS EASY TO FORGET.
// The manifest's `_toolbox_pin` is the EXPECTED identity; THIS is what actually gets materialized.
// Updating only the manifest makes the doorway refuse with "materialized toolbox pin X != manifest
// _toolbox_pin Y" — correct, fail-closed, and a bricked seat. Updating only this constant would be
// far worse: the new law would execute while the self-protected manifest still attested to the old
// one, and nothing would disagree. MEASURED here: the manifest was edited first and the live
// doorway refused on exactly that mismatch, which is how this line got found.
// `A RE-PIN IS TWO FILES. CHANGE ONE AND YOU HAVE EITHER A BRICK OR A LIE.`
//
// A re-pin is a DELIBERATE act with a member diff behind it, which is precisely the motion the
// comment above demands instead of silently adopting whatever a branch points at.
// RE-PINNED 2026-08-17 by AR-1311 control-plane seat, on AR-1311A executable ruling
// (cpb-2026-08-17-0005):
//   b6c70282 -> 4c5f9d4a   (AR-1307 F32-F35 handshake repair). Member diff: 3 new .mjs files,
//                           44 -> 47. Descendant verified under AR-1310 with
//                           `git merge-base --is-ancestor b6c70282 4c5f9d4a`.
// RE-PINNED 2026-08-18 by AR-1319 control-plane seat, on AR-1318A executable ruling
// (cpb-2026-08-18-0007):
//   4c5f9d4a -> bbf2e6c2   (AR-1318 F36 two-location GIT_TREE receipt-state compatibility
//                           repair + SubagentStop lifecycle finality). Descendant verified
//                           under AR-1318A ruling with Worker commit 3c2df1d0.
const TOOLBOX_PIN = 'bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Materialize the pinned tooling into a cache dir. Returns a provenance receipt. */
export function materialize() {
  // THE PIN IS THE AUTHORITY. A missing pin is a hard stop: running from whatever the branch
  // happens to point at is the exact behaviour the pin exists to end.
  let commit;
  try {
    commit = git(['rev-parse', `${TOOLBOX_PIN}^{commit}`]).trim();
  } catch {
    throw new Error(
      `TOOLBOX PIN NOT FOUND: ${TOOLBOX_PIN}. The toolbox is not rebuilt here by design — ` +
      `without the pinned commit there is nothing authorized to activate, and inventing a ` +
      `replacement is exactly what AR-1236 §11 forbids. Fetch ${TOOLBOX_REF} and re-run.`,
    );
  }
  if (commit !== TOOLBOX_PIN) {
    throw new Error(`pin ${TOOLBOX_PIN} resolved to ${commit}; refusing an ambiguous pin.`);
  }

  // The branch is a HINT now, not the source. Its position is reported so a move is visible.
  let branchCommit = null;
  try { branchCommit = git(['rev-parse', TOOLBOX_REF]).trim(); } catch { branchCommit = null; }
  const drifted = branchCommit !== null && branchCommit !== TOOLBOX_PIN;

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

  const bundleSha = crypto.createHash('sha256')
    .update(manifest.map((m) => `${m.file}:${m.sha256}`).join('\n')).digest('hex');

  return {
    schema: 'worker1-toolbox-activation-v2',
    authority: 'AR-1236 §11 (activate, do not rebuild) + AR-1230 + AR-1254 §10 (immutable pin)',
    ref: TOOLBOX_REF,
    pin: TOOLBOX_PIN,
    commit,
    pin_is_authority: true,
    branch_commit: branchCommit,
    branch_drifted_from_pin: drifted,
    drift_note: drifted
      ? `⚠ ${TOOLBOX_REF} has moved to ${branchCommit}, away from the pinned ${TOOLBOX_PIN}. ` +
        'This run used the PIN. The branch moving is not an upgrade and does not change what is ' +
        'activated — re-pin deliberately, with a member diff, or keep running the pin.'
      : `${TOOLBOX_REF} still matches the pin.`,
    cache: CACHE,
    file_count: manifest.length,
    bundle_sha256: bundleSha,
    manifest,
    note:
      'Materialized FROM the PINNED COMMIT, never copied into the worker branch. One source of ' +
      'truth; a drifting second copy of a guard is a guard that stops biting while still ' +
      'reporting PASS. `bundle_sha256` covers every file name+hash, so a content change inside ' +
      'the pin is detectable without diffing 37 rows by eye.',
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
