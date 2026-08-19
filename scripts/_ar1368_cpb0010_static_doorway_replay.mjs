#!/usr/bin/env node
/**
 * AR-1363A §5 — bounded, read-only, zero-model, zero-network static forensic replay of the
 * cpb-2026-08-19-0010 SessionStart authority/identity decision, using the REAL production
 * functions from scripts/control-plane-bootstrap/ against the REAL preserved evidence in the
 * failed worktree wt-control-plane-ar-1361a-cpb-2026-08-19-0010.
 *
 * Imports production modules; does not modify them. Writes nothing to the preserved worktree,
 * its git dir, or any shared claim store. `git fetch` is intercepted and never actually invoked.
 * `rev-parse origin/external-advisor/gpt-rulings` is pinned to the HISTORICAL authority head
 * this attempt actually used, not today's (which has since moved).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { verifyAuthorityIndependently, decide, measureObservedIdentity } from './control-plane-bootstrap/control-plane-seat-hook.mjs';

const WORKTREE_PATH = 'C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010';
const HISTORICAL_AUTHORITY_HEAD = 'e7077d46a657288ecc5eb9c38a4540acf218a653';
const CLAIM_PATH = 'C:/Users/tonio/Projects/trading-forge/trading-forge/.git/tf-control-plane-claim-cpb-2026-08-19-0010.json';
const AUTHORIZATION_ID = 'cpb-2026-08-19-0010';

let fetchInterceptCount = 0;
const gitCallLog = [];

function realGit(args) {
  // MSYS2_ARG_CONV_EXCL/MSYS_NO_PATHCONV: this harness's own subprocess spawning environment
  // (inherited from a git-bash/MSYS shell) was auto-mangling a `<sha>:<path>` argument as if it
  // were a Windows path, producing a spurious "Filename too long" stat error unrelated to the
  // production authority/identity logic under test. This is a harness-invocation adjustment only
  // -- no protected file is touched -- to let the exact same production call succeed here the way
  // it would in a non-MSYS spawn context.
  return execFileSync('git', ['-C', WORKTREE_PATH, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
  }).trim();
}

function makeReplayIo() {
  return {
    git: (...args) => {
      gitCallLog.push(args.join(' '));
      if (args[0] === 'fetch') {
        fetchInterceptCount += 1;
        return ''; // NO-OP. Never a real network call.
      }
      if (args[0] === 'rev-parse' && args[1] === 'origin/external-advisor/gpt-rulings') {
        return HISTORICAL_AUTHORITY_HEAD; // pinned, not today's moved ref
      }
      return realGit(args);
    },
    readFileBytes: (rel) => fs.readFileSync(path.join(WORKTREE_PATH, rel)),
    listDir: (rel) => {
      try { return fs.readdirSync(path.join(WORKTREE_PATH, rel)); } catch { return []; }
    },
    realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/'),
    readClaim: (authorizationId) => {
      if (authorizationId !== AUTHORIZATION_ID) return null;
      return JSON.parse(fs.readFileSync(CLAIM_PATH, 'utf8'));
    },
  };
}

function inMemoryStore() {
  const receipts = new Map();
  return {
    map: receipts,
    readReceipt: (sessionId) => receipts.get(sessionId) ?? null,
    writeReceipt: (sessionId, body) => { receipts.set(sessionId, body); },
  };
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function runOnce(manifest, label) {
  const io = makeReplayIo();
  let authority;
  let runtimeException = null;
  try {
    authority = verifyAuthorityIndependently(io, manifest);
  } catch (error) {
    // A REAL, reproducible native git exception (not a clean {ok:false,code,detail} refusal) --
    // recorded distinctly rather than silently forced into the refusal shape or left to crash the
    // whole harness, so main + all three negative controls can still be attempted and compared.
    runtimeException = String(error?.message ?? error);
    authority = { ok: false, code: 'RUNTIME_EXCEPTION', detail: runtimeException };
  }
  let armed = false;
  let sessionContextText = null;
  const store = inMemoryStore();
  if (authority.ok) {
    const observed = measureObservedIdentity(io, {
      actor: authority.marker.actor,
      targetPacket: authority.marker.target_packet,
      authorizationId: authority.marker.authorization_id,
      rulingId: authority.measured.rulingId,
    });
    const sessionId = `replay-${label}-${crypto.randomUUID()}`;
    const out = decide({ hook_event_name: 'SessionStart', session_id: sessionId }, manifest, observed, store, authority);
    sessionContextText = out?.hookSpecificOutput?.additionalContext ?? null;
    armed = store.map.size > 0;
  } else {
    // authority failed -> decide() would also refuse to arm, mirror that without calling decide()
    // a second time on a bogus observed identity (authority must be verified first in the real path).
    sessionContextText = `CONTROL-PLANE GUARD NOT ARMED: ${authority.code} — ${authority.detail}. Do not edit.`;
  }
  return { label, authority, armed, sessionContextText, receiptCount: store.map.size, runtimeException };
}

function main() {
  const manifestPath = path.join(WORKTREE_PATH, '.claude/control-plane-guard-manifest.json');
  const settingsPath = path.join(WORKTREE_PATH, '.claude/settings.local.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const evidenceHashes = {
    settings_local_json: sha256File(settingsPath),
    control_plane_guard_manifest_json: sha256File(manifestPath),
    claim_json: sha256File(CLAIM_PATH),
  };

  const protectedModules = [
    'control-plane-bootstrap/authorization.mjs',
    'control-plane-bootstrap/bootstrap.mjs',
    'control-plane-bootstrap/bundle.mjs',
    'control-plane-bootstrap/claim-store.mjs',
    'control-plane-bootstrap/control-plane-guard.mjs',
    'control-plane-bootstrap/control-plane-seat-hook.mjs',
  ].map((rel) => {
    const p = path.join(WORKTREE_PATH, 'scripts', rel);
    return { path: `scripts/${rel}`, sha256: sha256File(p) };
  });

  // ---- MAIN REPLAY (real preserved manifest, unmutated) ----
  const main_ = runOnce(manifest, 'main');

  // ---- NEGATIVE CONTROLS (in-memory mutated copies only; nothing on disk touched) ----
  const c1 = runOnce({ ...manifest, branch: 'control-plane/SOMETHING-ELSE-NOT-REAL' }, 'ctrl1-branch');
  const c2 = runOnce({ ...manifest, bootstrap_bundle_sha256: '0'.repeat(64) }, 'ctrl2-bundle-sha');
  const c3 = runOnce({ ...manifest, authorization_id: 'cpb-2026-08-19-FAKE' }, 'ctrl3-authorization-id');

  const negativeControlsAllRefused = !c1.armed && !c2.armed && !c3.armed;
  const anyRuntimeException = [main_, c1, c2, c3].some((r) => r.runtimeException !== null);

  let classification;
  if (main_.runtimeException !== null) {
    // Distinct from a clean {ok:false} static refusal: this is a native process crash inside
    // verifyAuthorityIndependently's git call, deterministic and reproducible, occurring BEFORE any
    // manifest field is inspected. Not one of F1/F2/F3 as literally defined in AR-1363A -- flagged
    // explicitly rather than shoehorned into either label.
    classification = 'F4_RUNTIME_EXCEPTION_PRE_AUTHORITY';
  } else if (!negativeControlsAllRefused) {
    classification = 'F3_INDETERMINATE'; // a negative control armed -> harness invalid
  } else if (main_.armed) {
    classification = 'F1_STATIC_PASS';
  } else {
    // authority passed but decide() still didn't arm (e.g. identity mismatch) -> report as F2-shaped
    classification = 'F2_STATIC_FAIL';
  }

  const result = {
    schema: 'AR1363A_CPB0010_STATIC_DOORWAY_REPLAY_V1',
    worktree: WORKTREE_PATH,
    historical_authority_head_used: HISTORICAL_AUTHORITY_HEAD,
    authorization_id: AUTHORIZATION_ID,
    evidence_hashes: evidenceHashes,
    protected_module_blobs: protectedModules,
    fetch_intercept_count: fetchInterceptCount,
    git_calls_total: gitCallLog.length,
    git_calls: gitCallLog,
    main_replay: {
      authority_ok: main_.authority.ok,
      authority_code: main_.authority.code ?? null,
      authority_detail: main_.authority.detail ?? null,
      authority_measured: main_.authority.ok ? main_.authority.measured : null,
      armed: main_.armed,
      session_context_text: main_.sessionContextText,
      runtime_exception: main_.runtimeException,
    },
    negative_controls: {
      ctrl1_altered_branch: { armed: c1.armed, session_context_text: c1.sessionContextText, runtime_exception: c1.runtimeException },
      ctrl2_altered_bundle_sha: { armed: c2.armed, authority_code: c2.authority.code ?? null, session_context_text: c2.sessionContextText, runtime_exception: c2.runtimeException },
      ctrl3_altered_authorization_id: { armed: c3.armed, authority_code: c3.authority.code ?? null, session_context_text: c3.sessionContextText, runtime_exception: c3.runtimeException },
      all_refused: negativeControlsAllRefused,
    },
    any_runtime_exception: anyRuntimeException,
    classification,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
