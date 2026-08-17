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
import { execFileSync } from 'node:child_process';

import { extractCandidateMarkers, validateAuthorization, GPT_AUTHORITY_REF, EXPECTED_REPO } from './authorization.mjs';
import { computeBundle } from './bundle.mjs';
import { ALL_TOOLS_MATCHER } from './control-plane-guard.mjs';
import {
  buildPlan, buildLaunchArgv, CLAIM_DIR, LAUNCH_EXECUTABLE, SETTING_SOURCES,
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
    /**
     * THE FIRST MUTATION, and it is a single atomic act.
     *
     * AR-1278A F-10: the previous version called `mkdirSync(..., {recursive:true})` first, so a
     * failure between the directory creation and the claim write left external state changed while
     * the authorization was still reusable. The parent directory is now COMMITTED in the repository
     * (see CLAIM_DIR/README.md), so the critical section is exactly one `wx` write: it either makes
     * the authorization non-reusable or it changes nothing at all.
     */
    writeClaim(authorizationId, body) {
      const dir = pathReal.join(repoRoot, CLAIM_DIR);
      if (!fsReal.existsSync(dir)) {
        throw new Error(`claim directory ${CLAIM_DIR} must pre-exist; refusing to create it inside the one-shot critical section`);
      }
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
     * AR-1278A §1 — `claude --init-only` runs Setup + SessionStart hooks and EXITS without starting
     * a conversation, so this proves CLAUDE CODE ITSELF discovered and invoked the Local-source hook.
     * A direct `node` call to the doorway could only ever prove the doorway works when called; it
     * could never prove the runtime would call it. Zero model conversation.
     *
     * Returns the armed receipt the seat's SessionStart minted, or null. The caller refuses to
     * launch without it.
     */
    proveDoorwayInitOnly(worktreePath) {
      // Claude Code refuses to launch inside another Claude Code session and names the bypass; this
      // is a separate top-level process running hooks and exiting, which is exactly the sanctioned
      // mode. Only the nesting markers are scrubbed.
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_SSE_PORT;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      try {
        execFileSync(LAUNCH_EXECUTABLE, ['--init-only', '--setting-sources', SETTING_SOURCES], {
          cwd: worktreePath, encoding: 'utf8', timeout: 180000, stdio: 'pipe', env,
        });
      } catch (error) {
        return { ok: false, detail: `--init-only failed: ${String(error.stderr || error.message).slice(0, 400)}` };
      }
      const gitDir = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
      const found = fsReal.readdirSync(gitDir).filter((f) => f.startsWith('tf-control-plane-armed-'));
      if (found.length === 0) {
        return { ok: false, detail: 'no durable armed receipt was minted by --init-only; the Local hook did not arm' };
      }
      return { ok: true, receipts: found };
    },

    /**
     * AR-1278A F-13 — SUPERVISED AND HANDS-FREE. `-p` with a marker-derived prompt means the machine
     * starts the work instead of opening a seat that waits for a human to type. The call is
     * synchronous so the bootstrap can inspect exit status and then verify the completion receipt,
     * rather than spawning a terminal and walking away. `-p` is a top-level process, not a subagent.
     */
    launchSeatSupervised(worktreePath, argv) {
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_SSE_PORT;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      try {
        const out = execFileSync(LAUNCH_EXECUTABLE, argv, { cwd: worktreePath, encoding: 'utf8', stdio: 'pipe', env });
        return { ok: true, output: String(out).slice(-2000) };
      } catch (error) {
        return { ok: false, detail: String(error.stderr || error.message).slice(0, 800) };
      }
    },

    /** The trusted completion receipt cp-finalize.mjs writes under the git dir. */
    readCompletionReceipt(worktreePath) {
      try {
        const gitDir = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
        return JSON.parse(fsReal.readFileSync(pathReal.join(gitDir, 'tf-control-plane-completion.json'), 'utf8'));
      } catch {
        return null;
      }
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
    /**
     * AR-1278A F-11, and it is MEASURED, not defensive decoration. `claude --init-only` in a scratch
     * fixture showed that with project settings carrying `disableAllHooks:true`, a Local-registered
     * SessionStart hook FIRES when Local carries `disableAllHooks:false` and DOES NOT FIRE when Local
     * omits it. So without this line the privileged seat could disarm its own guard by editing only
     * the tracked `.claude/settings.json` — which is a file its packet must edit.
     *   `PRECEDENCE YOU RELY ON BUT DO NOT STATE IS A DEFAULT SOMEBODY ELSE CAN CHANGE.`
     */
    disableAllHooks: false,
    hooks: {
      SessionStart: [{ matcher: 'startup|resume|fork', hooks: [{ type: 'command', command: cmd, timeout: 60 }] }],
      // AR-1278A F-12: ALL tools, not a name list. A matcher that enumerates tools cannot be
      // default-deny, because an unlisted tool never reaches the guard at all.
      PreToolUse: [{ matcher: ALL_TOOLS_MATCHER, hooks: [{ type: 'command', command: cmd, timeout: 15 }] }],
    },
  };
}

/* ------------------------------------------------------------------ run ---------------------- */

export function run({ mode = 'plan', io, effects, now = null } = {}) {
  const measured = measureState(io);

  // AR-1278A F-9 — BIND THE REAL ORIGIN BEFORE ANYTHING ELSE.
  // The marker declares `repo: swayz032/trading-forge`, but the previous version never compared
  // that to the ACTUAL remote — and then wrote `manifest.repo = measured.repoRemote`, so a copied
  // repository with a different origin became internally self-consistent while the marker still
  // said Trading Forge. A marker's claim about where it is running is not evidence of where it is
  // running. The receiving seat repeats this check independently.
  if (measured.repoRemote !== EXPECTED_REPO) {
    return {
      mode,
      authorized: false,
      refusal: { ok: false, code: 'wrong_origin', detail: `origin is ${measured.repoRemote}, this bootstrap only serves ${EXPECTED_REPO}` },
      measured: summarize(measured),
      executed: false,
    };
  }

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

  // The gate: Claude Code must itself discover and invoke the Local hook, and that hook must mint a
  // durable armed receipt. No receipt, no conversation. The claim is already spent by design —
  // refusing to launch is still the correct outcome, and it is reported as a refusal, not a success.
  const doorway = effects.proveDoorwayInitOnly(worktreePath);
  if (!doorway?.ok) {
    return {
      mode: 'execute', authorized: true, plan, measured: summarize(measured), executed: false, doorway,
      refusal: { ok: false, code: 'doorway_not_armed', detail: doorway?.detail ?? 'unknown' },
    };
  }

  const launch = effects.launchSeatSupervised(worktreePath, buildLaunchArgv(auth.marker));
  const completion = effects.readCompletionReceipt(worktreePath);
  const completionOk = Boolean(
    completion
    && completion.authorization_id === auth.marker.authorization_id
    && completion.ruling_id === auth.marker.ruling_id
    && completion.target_packet === auth.marker.target_packet,
  );

  return {
    mode: 'execute',
    authorized: true,
    plan: { ...plan, executed: true },
    measured: summarize(measured),
    executed: true,
    doorway,
    launch,
    completion,
    completion_verified: completionOk,
  };
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
