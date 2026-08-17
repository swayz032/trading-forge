#!/usr/bin/env node
/**
 * THE CONTROL-PLANE BOOTSTRAP ENTRY POINT.
 *
 * MODES
 *   --plan     (DEFAULT) measure, resolve authority, print the deterministic plan. No side effects.
 *   --execute  perform the plan — only after a marker validates against measured state.
 *
 * 🛑 WHY `--execute` IS SAFE TO SHIP UNRUN. It cannot reach a side effect without
 * `validateAuthorization` returning ok, which requires an `authorization_class:"EXECUTABLE"` marker
 * bound to the NEWEST ruling, pinned to THIS bootstrap source SHA and bundle, with every frozen
 * field matching independently measured values and an id never claimed. The default mode is
 * `--plan`, so a bare invocation measures and prints.
 *
 * 🛑 AR-1278 F-4 — THE CLAIM NOW PRECEDES THE FIRST MUTATION, NOT JUST THE LAUNCH.
 * The first version created the branch, the worktree and the seat settings and only THEN claimed the
 * authorization. A crash in that window left bootstrap state mutated while the same authorization
 * id remained unclaimed and reusable. Order is now: all read-only checks -> O_EXCL claim -> create.
 * A failure after the claim leaves the authorization SPENT and requires a new GPT decision. That is
 * the correct trade: `SAFETY OUTRANKS CONVENIENCE, AND A REUSABLE ONE-SHOT IS NOT A ONE-SHOT.`
 *
 * 🛑 AR-1278 F-3 — THE SEAT'S GUARD IS REGISTERED WHERE THE SEAT CANNOT WRITE.
 * The first version put the seat's hooks in `<worktree>/.claude/settings.json` — the very file the
 * packet must repair, so the seat could disarm its own doorway. Registration now goes to the LOCAL
 * settings source, which is categorically denied to the seat, leaving the tracked
 * `.claude/settings.json` freely repairable. See the AR for the assumption this still rests on.
 */

import fsReal from 'node:fs';
import pathReal from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

import { extractCandidateMarkers, validateAuthorization, GPT_AUTHORITY_REF } from './authorization.mjs';
import { computeBundle } from './bundle.mjs';
import {
  buildPlan, CLAIM_DIR, LAUNCH_ARGV, LAUNCH_EXECUTABLE, SETTING_SOURCES,
  deriveBranch, deriveWorktreeDirName, SEAT_SETTINGS_REL, SEAT_MANIFEST_REL,
} from './plan.mjs';

const QUEUE_PATH = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json';
const RECEIPT_DIR = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';
const ADVISOR_REPORT_DIR = 'advisor-reports';

/* ------------------------------------------------------------------ real IO ------------------ */

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

/**
 * The ruling's identity, taken from its filename.
 *
 * 🛑 FOUND BY THE FIRST LIVE `--plan` RUN: this reported `AR-1276` while reading
 * `AR-1276C-…md`. AR-1276, AR-1276A, AR-1276B and AR-1276C are four rulings and three are
 * superseded. Fail-CLOSED, so no privilege leak — it would have silently blocked the real execution
 * ruling while looking like a correct refusal.
 *   `A PARSER THAT DROPS PART OF AN IDENTITY IS STILL COMPARING SOMETHING, AND STILL SAYS NO.`
 */
export function rulingIdFromFilename(basename) {
  const m = /AR-\d{3,5}[A-Z]?/.exec(basename);
  return m ? m[0] : null;
}

/* ------------------------------------------------------------------ measurement -------------- */

export function measureState(io) {
  const queueBytes = io.readFileBytes(QUEUE_PATH);
  const queueSha256 = crypto.createHash('sha256').update(queueBytes).digest('hex');
  const queue = JSON.parse(queueBytes.toString('utf8'));

  const spent = Object.keys(queue.attempts || {}).length;
  const ready = Array.isArray(queue.queue) ? queue.queue.length - spent : -1;
  const receiptExtras = io.listDir(RECEIPT_DIR).filter((f) => f !== 'README.md');

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

  // AR-1278 F-5: the identity of the code that would actually run.
  const bundle = computeBundle(io.readFileBytes);

  return {
    workerBranch: io.git('rev-parse', '--abbrev-ref', 'HEAD'),
    workerHead: io.git('rev-parse', 'HEAD'),
    repoParentDir: pathReal.dirname(io.repoRoot).replaceAll('\\', '/'),
    repoRemote: safeRemote(io),
    queueSha256,
    ready,
    spent,
    receiptsReadmeOnly: receiptExtras.length === 0,
    gptAuthorityHead,
    rulingId,
    rulingText,
    isNewestRuling: rulingId !== null,
    claimedAuthorizationIds,
    bootstrapBundleSha256: bundle.bundle_sha256,
    bootstrapBundleFiles: bundle.files,
    // 0 by CONSTRUCTION, not by scanning history: this process dispatches no Agent/subagent.
    agentModelExecutions: 0,
  };
}

function safeRemote(io) {
  try {
    const remote = io.git('config', '--get', 'remote.origin.url');
    return (remote.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/) || [null, null])[1];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ authority ---------------- */

export function resolveAuthorization(measured) {
  if (!measured.rulingText) {
    return { ok: false, code: 'no_ruling_readable', detail: 'could not read a single ruling from the authority head' };
  }
  const candidates = extractCandidateMarkers(measured.rulingText);
  if (candidates.length === 0) {
    return { ok: false, code: 'no_marker', detail: `no CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 block in ${measured.rulingId}` };
  }
  const refusals = [];
  for (const candidate of candidates) {
    const verdict = validateAuthorization(candidate, measured);
    if (verdict.ok) return verdict;
    refusals.push(`${verdict.code}: ${verdict.detail}`);
  }
  return { ok: false, code: 'all_markers_refused', detail: refusals.join(' | ') };
}

/* ------------------------------------------------------------------ effects ------------------ */

export function makeRealEffects(repoRoot) {
  return {
    /** FIRST mutation, and it is atomic: `wx` fails if the id was ever claimed (AR-1278 F-4). */
    writeClaim(authorizationId, body) {
      const dir = pathReal.join(repoRoot, CLAIM_DIR);
      fsReal.mkdirSync(dir, { recursive: true });
      fsReal.writeFileSync(pathReal.join(dir, `${authorizationId}.json`), `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
    },
    createBranchAndWorktree(branch, worktreePath, base) {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, worktreePath, base], { stdio: 'inherit' });
    },
    writeSeatGuard(worktreePath, settings, manifest) {
      fsReal.mkdirSync(pathReal.join(worktreePath, '.claude'), { recursive: true });
      fsReal.writeFileSync(pathReal.join(worktreePath, SEAT_SETTINGS_REL), `${JSON.stringify(settings, null, 2)}\n`);
      fsReal.writeFileSync(pathReal.join(worktreePath, SEAT_MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`);
    },
    /**
     * Run the seat's own doorway with a synthetic SessionStart, exactly as the Worker-1 launcher's
     * C5 arm-witness does. Zero model calls: this observes the guard decide rather than inferring
     * it from its inputs. `A GUARD WHOSE REFUSAL PATH HAS NEVER BEEN OBSERVED IS NOT AN INSTRUMENT.`
     */
    proveDoorway(worktreePath) {
      const payload = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'cp-armprobe' });
      const out = execFileSync(process.execPath, [
        pathReal.join(worktreePath, 'scripts/control-plane-bootstrap/control-plane-seat-hook.mjs'),
        '--manifest', pathReal.join(worktreePath, SEAT_MANIFEST_REL),
      ], { input: payload, encoding: 'utf8', cwd: worktreePath });
      return out;
    },
    launchSeat(worktreePath) {
      const child = spawn(LAUNCH_EXECUTABLE, [...LAUNCH_ARGV], { cwd: worktreePath, stdio: 'inherit' });
      return child.pid ?? null;
    },
  };
}

/**
 * The seat's hook registration. Written to the LOCAL settings source (AR-1278 F-3) so the packet can
 * repair the tracked `.claude/settings.json` without touching what governs it. `--setting-sources`
 * is passed at launch so loading is explicit rather than default-dependent.
 */
export function seatSettingsFor() {
  const doorway = 'scripts/control-plane-bootstrap/control-plane-seat-hook.mjs';
  const cmd = `node "$CLAUDE_PROJECT_DIR"/${doorway} --manifest "$CLAUDE_PROJECT_DIR"/${SEAT_MANIFEST_REL}`;
  return {
    $comment: 'CONTROL-PLANE SEAT GUARD — materialized by scripts/control-plane-bootstrap. Immutable to the seat.',
    hooks: {
      SessionStart: [{ matcher: 'startup|resume|fork', hooks: [{ type: 'command', command: cmd, timeout: 30 }] }],
      PreToolUse: [{ matcher: 'Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell', hooks: [{ type: 'command', command: cmd, timeout: 15 }] }],
    },
  };
}

/* ------------------------------------------------------------------ run ---------------------- */

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

  // ---- everything above this line is READ-ONLY. The claim is the first mutation. -------------
  const branch = deriveBranch(auth.marker.target_packet);
  const worktreePath = `${measured.repoParentDir}/${deriveWorktreeDirName(auth.marker.target_packet)}`;

  effects.writeClaim(auth.marker.authorization_id, {
    authorization_id: auth.marker.authorization_id,
    ruling_id: auth.marker.ruling_id,
    target_packet: auth.marker.target_packet,
    branch,
    worktree: worktreePath,
    source_worker_head: measured.workerHead,
    bootstrap_bundle_sha256: measured.bootstrapBundleSha256,
    claimed_at: now,
  });

  const manifest = {
    schema: 'CONTROL_PLANE_SEAT_MANIFEST_V1',
    actor: auth.marker.actor,
    repo: measured.repoRemote,
    branch,
    worktree: worktreePath,
    head: measured.workerHead,
    target_packet: auth.marker.target_packet,
    authorization_id: auth.marker.authorization_id,
    ruling_id: auth.marker.ruling_id,
    frozen_queue_sha256: measured.queueSha256,
    bootstrap_bundle_sha256: measured.bootstrapBundleSha256,
    allowed_paths: [...auth.marker.allowed_paths],
  };

  effects.createBranchAndWorktree(branch, worktreePath, measured.workerHead);
  effects.writeSeatGuard(worktreePath, seatSettingsFor(), manifest);
  const doorway = effects.proveDoorway(worktreePath);
  if (!/CONTROL-PLANE SEAT ARMED/.test(String(doorway)) || /NOT ARMED/.test(String(doorway))) {
    // The claim is already spent by design. Refusing to launch is still correct.
    return { mode: 'execute', authorized: true, plan, measured: summarize(measured), executed: false, doorway, refusal: { ok: false, code: 'doorway_not_armed', detail: String(doorway).slice(0, 400) } };
  }
  const pid = effects.launchSeat(worktreePath);

  return { mode: 'execute', authorized: true, plan: { ...plan, executed: true }, measured: summarize(measured), executed: true, pid, doorway };
}

function summarize(m) {
  return {
    worker_branch: m.workerBranch,
    worker_head: m.workerHead,
    repo_remote: m.repoRemote,
    gpt_authority_ref: GPT_AUTHORITY_REF,
    gpt_authority_head: m.gptAuthorityHead,
    newest_ruling: m.rulingId,
    bootstrap_bundle_sha256: m.bootstrapBundleSha256,
    frozen_queue_sha256: m.queueSha256,
    ready: m.ready,
    spent: m.spent,
    receipts_readme_only: m.receiptsReadmeOnly,
    agent_model_executions: m.agentModelExecutions,
    claimed_authorization_ids: [...m.claimedAuthorizationIds],
    setting_sources_at_launch: SETTING_SOURCES,
  };
}

/* ------------------------------------------------------------------ CLI ---------------------- */

if (process.argv[1] && process.argv[1].endsWith('bootstrap.mjs')) {
  const mode = process.argv.includes('--execute') ? 'execute' : 'plan';
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const io = makeRealIo(repoRoot);
  const effects = mode === 'execute' ? makeRealEffects(repoRoot) : null;
  const result = run({ mode, io, effects, now: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.authorized) {
    process.stderr.write('\nCONTROL-PLANE BOOTSTRAP REFUSED. Expected until a GPT ruling carries an EXECUTABLE marker.\n');
    process.exitCode = 3;
  }
}
