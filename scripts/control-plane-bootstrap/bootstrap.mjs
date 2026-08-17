#!/usr/bin/env node
/**
 * AR-1277 — THE CONTROL-PLANE BOOTSTRAP ENTRY POINT.
 *
 * MODES
 *   --plan     (DEFAULT) measure, resolve authority, print the deterministic plan. No side effects.
 *   --execute  perform the plan — but ONLY after a marker validates. AR-1277 authors this path;
 *              it does not run it, because no EXECUTABLE marker exists on the GPT branch yet, and
 *              the refusal is therefore the observed behaviour rather than a promise.
 *
 * 🛑 WHY `--execute` IS SAFE TO SHIP UNRUN.
 * It cannot reach a side effect without `validateAuthorization` returning ok, and that requires an
 * `authorization_class:"EXECUTABLE"` marker, bound to the NEWEST ruling on the GPT branch, whose
 * every frozen-state field matches independently measured values, whose id has never been claimed.
 * AR-1276C §7's own example fails that check by construction. The default mode is `--plan` so an
 * accidental bare invocation measures and prints rather than acts.
 *
 * 🛑 THE BOOTSTRAP GRANTS NOTHING BY ITSELF (AR-1276C §6).
 * Worker-1 being able to run this file is NOT authority. The authority is the GPT ruling branch,
 * and the receiving seat re-verifies it independently through its own guard
 * (control-plane-seat-hook.mjs) before its first edit. Two checks, two processes, one authority.
 *   `THE TRIGGER IS NOT THE AUTHORITY.`
 *
 * ALL I/O IS INJECTED so the tests exercise this real control flow against fakes and can PROVE
 * that a refusal happened before any effect was requested — a test that stubs the decision instead
 * of the world proves only that the stub works.
 */

import fsReal from 'node:fs';
import pathReal from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';

import { extractCandidateMarkers, validateAuthorization, GPT_AUTHORITY_REF } from './authorization.mjs';
import { buildPlan, CLAIM_DIR, LAUNCH_ARGV, LAUNCH_EXECUTABLE, deriveBranch, deriveWorktreeDirName } from './plan.mjs';

const QUEUE_PATH = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json';
const RECEIPT_DIR = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';
const ADVISOR_REPORT_DIR = 'advisor-reports';

/* ------------------------------------------------------------------ real IO ---------------- */

export function makeRealIo(repoRoot) {
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  return {
    repoRoot,
    git,
    readFile: (rel) => fsReal.readFileSync(pathReal.join(repoRoot, rel), 'utf8'),
    readFileBytes: (rel) => fsReal.readFileSync(pathReal.join(repoRoot, rel)),
    listDir: (rel) => {
      try {
        return fsReal.readdirSync(pathReal.join(repoRoot, rel));
      } catch {
        return [];
      }
    },
    exists: (rel) => fsReal.existsSync(pathReal.join(repoRoot, rel)),
  };
}

/* ------------------------------------------------------------------ measurement ------------ */

/**
 * The ruling's identity, taken from its filename.
 *
 * 🛑 FOUND BY THE FIRST LIVE `--plan` RUN, NOT BY REVIEW: this reported `AR-1276` while reading
 * `AR-1276C-GPT-OPERATOR-RULING-...md`, because the pattern stopped at the digits. The revision
 * letter is part of the identity — AR-1276, AR-1276A, AR-1276B and AR-1276C are four different
 * rulings, and three of them are already superseded. The consequence was fail-CLOSED (a marker
 * carrying `ruling_id:"AR-1280A"` would have been refused for a mismatch that did not exist), so
 * it would not have leaked privilege — it would have silently blocked the real execution ruling
 * and looked like a correct refusal while doing it.
 *   `A PARSER THAT DROPS PART OF AN IDENTITY IS STILL COMPARING SOMETHING, AND STILL SAYS NO.`
 */
export function rulingIdFromFilename(basename) {
  const m = /AR-\d{3,5}[A-Z]?/.exec(basename);
  return m ? m[0] : null;
}

/**
 * Everything the validator compares against is measured HERE, from the repository, never taken
 * from the marker. AR-1276C §6: "bootstrap verifies frozen G2 is pristine."
 */
export function measureState(io) {
  const queueBytes = io.readFileBytes(QUEUE_PATH);
  const queueSha256 = crypto.createHash('sha256').update(queueBytes).digest('hex');
  const queue = JSON.parse(queueBytes.toString('utf8'));

  const spent = Object.keys(queue.attempts || {}).length;
  const ready = Array.isArray(queue.queue) ? queue.queue.length - spent : -1;
  const receiptExtras = io.listDir(RECEIPT_DIR).filter((f) => f !== 'README.md');

  // Newest ruling on the GPT authority branch, by commit order — not by filename sort, which
  // would let a hand-named file jump the queue.
  io.git('fetch', '--quiet', 'origin', 'external-advisor/gpt-rulings');
  const gptAuthorityHead = io.git('rev-parse', 'origin/external-advisor/gpt-rulings');
  const changed = io
    .git('show', '--name-only', '--pretty=format:', gptAuthorityHead)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${ADVISOR_REPORT_DIR}/`) && s.endsWith('.md'));

  let rulingId = null;
  let rulingText = '';
  if (changed.length === 1) {
    rulingText = io.git('show', `${gptAuthorityHead}:${changed[0]}`);
    rulingId = rulingIdFromFilename(pathReal.basename(changed[0]));
  }

  const claimedAuthorizationIds = new Set(
    io.listDir(CLAIM_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
  );

  return {
    workerBranch: io.git('rev-parse', '--abbrev-ref', 'HEAD'),
    workerHead: io.git('rev-parse', 'HEAD'),
    repoParentDir: pathReal.dirname(io.repoRoot).replaceAll('\\', '/'),
    queueSha256,
    ready,
    spent,
    receiptsReadmeOnly: receiptExtras.length === 0,
    gptAuthorityHead,
    rulingId,
    rulingText,
    // The newest COMMIT on the authority branch is the newest ruling by construction: we read the
    // ruling out of that commit rather than searching the tree for a file we liked the name of.
    isNewestRuling: rulingId !== null,
    claimedAuthorizationIds,
    // 0 by CONSTRUCTION, not by scanning history: this process dispatches no Agent/subagent. Stated
    // as a property of the bootstrap, and it is what the closing report attests.
    agentModelExecutions: 0,
  };
}

/* ------------------------------------------------------------------ authority --------------- */

export function resolveAuthorization(measured) {
  if (!measured.rulingText) {
    return { ok: false, code: 'no_ruling_readable', detail: 'could not read a single ruling from the authority head' };
  }
  const candidates = extractCandidateMarkers(measured.rulingText);
  if (candidates.length === 0) {
    return { ok: false, code: 'no_marker', detail: `no ${'CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1'} block in ${measured.rulingId}` };
  }
  const refusals = [];
  for (const candidate of candidates) {
    const verdict = validateAuthorization(candidate, measured);
    if (verdict.ok) return verdict;
    refusals.push(`${verdict.code}: ${verdict.detail}`);
  }
  return { ok: false, code: 'all_markers_refused', detail: refusals.join(' | ') };
}

/* ------------------------------------------------------------------ effects ----------------- */

/**
 * The only side-effecting surface. Injected, so every test runs against a recorder and the
 * "external side effects = NONE" line in the AR is a measurement rather than a claim.
 */
export function makeRealEffects(repoRoot) {
  return {
    createBranchAndWorktree(branch, worktreePath, base) {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, worktreePath, base], { stdio: 'inherit' });
    },
    writeSeatGuard(worktreePath, settings, manifest) {
      const dir = pathReal.join(worktreePath, '.claude');
      fsReal.mkdirSync(dir, { recursive: true });
      fsReal.writeFileSync(pathReal.join(dir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
      fsReal.writeFileSync(pathReal.join(dir, 'control-plane-guard-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    },
    writeClaim(repoRootDir, authorizationId, body) {
      const dir = pathReal.join(repoRootDir, CLAIM_DIR);
      fsReal.mkdirSync(dir, { recursive: true });
      const file = pathReal.join(dir, `${authorizationId}.json`);
      // wx: a second execution of the same authorization fails here even if the earlier claim was
      // written by a process that then crashed. Replay refusal must not depend on a prior read.
      fsReal.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
    },
    launchSeat(worktreePath) {
      const child = spawn(LAUNCH_EXECUTABLE, [...LAUNCH_ARGV], { cwd: worktreePath, stdio: 'inherit', detached: false });
      return child.pid ?? null;
    },
  };
}

export function seatSettingsFor() {
  const doorway = 'scripts/control-plane-bootstrap/control-plane-seat-hook.mjs';
  const manifest = '.claude/control-plane-guard-manifest.json';
  const cmd = `node "$CLAUDE_PROJECT_DIR"/${doorway} --manifest "$CLAUDE_PROJECT_DIR"/${manifest}`;
  return {
    $comment: 'CONTROL-PLANE SEAT GUARD — materialized by scripts/control-plane-bootstrap (AR-1277).',
    hooks: {
      SessionStart: [{ matcher: 'startup|resume|fork', hooks: [{ type: 'command', command: cmd, timeout: 30 }] }],
      // PowerShell is registered HERE from the start: AR-1276C §6B names it, and a matcher that
      // omits it is the exact gap AR-1278 exists to close on the Worker side.
      PreToolUse: [{ matcher: 'Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell', hooks: [{ type: 'command', command: cmd, timeout: 15 }] }],
    },
  };
}

/* ------------------------------------------------------------------ run --------------------- */

export function run({ mode = 'plan', io, effects, now = null } = {}) {
  const measured = measureState(io);
  const auth = resolveAuthorization(measured);

  if (!auth.ok) {
    return { mode, authorized: false, refusal: auth, measured: summarize(measured), executed: false };
  }

  const plan = buildPlan(auth.marker, measured);
  if (mode !== 'execute') {
    return { mode: 'plan', authorized: true, plan, measured: summarize(measured), executed: false };
  }

  const branch = deriveBranch(auth.marker.target_packet);
  const worktreePath = `${measured.repoParentDir}/${deriveWorktreeDirName(auth.marker.target_packet)}`;
  const manifest = {
    schema: 'CONTROL_PLANE_SEAT_MANIFEST_V1',
    actor: auth.marker.actor,
    branch,
    worktree: worktreePath,
    target_packet: auth.marker.target_packet,
    authorization_id: auth.marker.authorization_id,
    frozen_queue_sha256: measured.queueSha256,
    allowed_paths: [...auth.marker.allowed_paths],
  };

  effects.createBranchAndWorktree(branch, worktreePath, measured.workerHead);
  effects.writeSeatGuard(worktreePath, seatSettingsFor(), manifest);
  // Claim BEFORE launch: a crash between spawn and claim would otherwise leave a one-shot
  // authorization reusable, which is the whole failure mode AR-1276C §9's replay law names.
  effects.writeClaim(io.repoRoot, auth.marker.authorization_id, {
    authorization_id: auth.marker.authorization_id,
    ruling_id: auth.marker.ruling_id,
    target_packet: auth.marker.target_packet,
    branch,
    worktree: worktreePath,
    source_worker_head: measured.workerHead,
    claimed_at: now,
  });
  const pid = effects.launchSeat(worktreePath);

  return { mode: 'execute', authorized: true, plan: { ...plan, executed: true }, measured: summarize(measured), executed: true, pid };
}

function summarize(m) {
  return {
    worker_branch: m.workerBranch,
    worker_head: m.workerHead,
    gpt_authority_ref: GPT_AUTHORITY_REF,
    gpt_authority_head: m.gptAuthorityHead,
    newest_ruling: m.rulingId,
    frozen_queue_sha256: m.queueSha256,
    ready: m.ready,
    spent: m.spent,
    receipts_readme_only: m.receiptsReadmeOnly,
    agent_model_executions: m.agentModelExecutions,
    claimed_authorization_ids: [...m.claimedAuthorizationIds],
  };
}

/* ------------------------------------------------------------------ CLI --------------------- */

if (process.argv[1] && process.argv[1].endsWith('bootstrap.mjs')) {
  const mode = process.argv.includes('--execute') ? 'execute' : 'plan';
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const io = makeRealIo(repoRoot);
  const effects = mode === 'execute' ? makeRealEffects(repoRoot) : null;
  const result = run({ mode, io, effects, now: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.authorized) {
    process.stderr.write('\nCONTROL-PLANE BOOTSTRAP REFUSED. This is the expected state until a GPT ruling carries an EXECUTABLE marker.\n');
    process.exitCode = 3;
  }
}
