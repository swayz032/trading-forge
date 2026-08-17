#!/usr/bin/env node
/**
 * THE CONTROL-PLANE SEAT'S HOOK DOORWAY.
 *
 * ★ THE ENVELOPE SHAPE IS MEASURED, NOT GUESSED. Read out of the pinned toolbox's
 * `claude-hook-runner.mjs` @ b6c70282:
 *     PreToolUse deny -> { hookSpecificOutput: { hookEventName:'PreToolUse',
 *                          permissionDecision:'deny', permissionDecisionReason } }
 *     SessionStart    -> { hookSpecificOutput: { hookEventName:'SessionStart', additionalContext } }
 * and an internal error DENIES rather than falling through.
 *
 * 🛑🛑 AR-1278 F-1 — THE DEFECT THIS FILE EXISTS TO CLOSE, AND IT WAS MINE.
 * The first version's `main()` built `observed` out of the SAME manifest it then validated:
 *     observed.branch = manifest.branch;  ...  verifySeatIdentity(observed, {from manifest})
 * so the identity check compared the manifest to itself and could never fail. It also honoured a
 * `manifest._observed_override` field — a manifest could dictate its own observed values outright.
 * A forged, stale or wrong-worktree manifest would have presented a perfect identity.
 *   `A CHECK WHOSE INPUT AND EXPECTATION COME FROM ONE FILE IS A SPELL-CHECKER FOR THAT FILE.`
 * Observed values are now MEASURED from git and the filesystem. The manifest supplies only the
 * EXPECTED side, and `_observed_override` is gone.
 *
 * 🛑 AR-1278 F-7 — SessionStart writes a DURABLE armed receipt into the worktree's git directory,
 * and PreToolUse refuses without one. The git dir is not part of the working tree, so no Edit/Write
 * (absolute paths are refused as escaping) and no allow-listed Bash shape can reach it. A seat that
 * was never armed therefore cannot act, and `additionalContext` — which is just text — is no longer
 * load-bearing evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  classifyControlPlaneBash,
  classifyControlPlanePath,
  classifyControlPlaneTool,
  verifySeatIdentity,
} from './control-plane-guard.mjs';
import { extractCandidateMarkers, validateAuthorization, EXPECTED_REPO } from './authorization.mjs';
import { computeBundle } from './bundle.mjs';
import { rulingIdFromFilename } from './bootstrap.mjs';
import { gitCommonDirAbs, readClaimEitherStoreReal } from './claim-store.mjs';

/**
 * AR-1278A F-8 / F-9 — THE RECEIVING SEAT VERIFIES GPT AUTHORITY FOR ITSELF.
 *
 * The previous version trusted a manifest written by the bootstrap for actor / packet /
 * authorization id / ruling id / bundle. Those are exactly the fields that decide whether this seat
 * is allowed to exist, so taking them from the thing under test is the same error as F-1, one layer
 * up. This function goes to the source: the GPT ruling branch, the real file bytes, and the durable
 * claim.
 *
 * It runs ONCE, at SessionStart. PreToolUse then relies on the armed receipt plus fresh local
 * identity — no network on the hot path.
 *
 * @returns {ok:true, marker} | {ok:false, code, detail}
 */
export function verifyAuthorityIndependently(io, manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, code: 'no_manifest', detail: 'no control-plane manifest' };
  }

  // F-9: bind the REAL origin, not the manifest's claim about it.
  const remote = io.git('config', '--get', 'remote.origin.url');
  const repo = (remote.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/) || [null, null])[1];
  if (repo !== EXPECTED_REPO) {
    return { ok: false, code: 'wrong_origin', detail: `origin is ${repo}, this bootstrap only serves ${EXPECTED_REPO}` };
  }

  // Newest ruling on the authority branch, resolved by the same strict rule the bootstrap uses.
  io.git('fetch', '--quiet', 'origin', 'external-advisor/gpt-rulings');
  const authorityHead = io.git('rev-parse', 'origin/external-advisor/gpt-rulings');
  const changed = io
    .git('show', '--name-only', '--pretty=format:', authorityHead)
    .split('\n').map((s) => s.trim())
    .filter((s) => s.startsWith('advisor-reports/') && s.endsWith('.md'));
  if (changed.length !== 1) {
    return { ok: false, code: 'authority_unreadable', detail: `expected exactly one ruling file at ${authorityHead}, saw ${changed.length}` };
  }
  const rulingId = rulingIdFromFilename(changed[0].split('/').pop());
  const rulingText = io.git('show', `${authorityHead}:${changed[0]}`);

  // Frozen state and the bundle are recomputed from REAL BYTES here, never read from the manifest.
  const queueRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json';
  const receiptRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';
  const queueBytes = io.readFileBytes(queueRel);
  const queueSha256 = crypto.createHash('sha256').update(queueBytes).digest('hex');
  const q = JSON.parse(queueBytes.toString('utf8'));
  const spent = Object.keys(q.attempts || {}).length;
  const ready = Array.isArray(q.queue) ? q.queue.length - spent : -1;
  const receiptsReadmeOnly = io.listDir(receiptRel).filter((f) => f !== 'README.md').length === 0;
  const bundleSha256 = computeBundle(io.readFileBytes).bundle_sha256;

  const candidates = extractCandidateMarkers(rulingText);
  if (candidates.length === 0) {
    return { ok: false, code: 'no_marker_in_current_authority', detail: `${rulingId} carries no executable marker` };
  }

  const refusals = [];
  for (const candidate of candidates) {
    // Replay is NOT evaluated here: by this point the bootstrap has legitimately claimed the id, so
    // an empty claimed-set is correct and the claim is verified separately below.
    const verdict = validateAuthorization(candidate, {
      rulingId,
      isNewestRuling: true,
      queueSha256,
      ready,
      spent,
      receiptsReadmeOnly,
      agentModelExecutions: 0,
      claimedAuthorizationIds: new Set(),
      workerHead: io.git('rev-parse', 'HEAD'),
      bootstrapBundleSha256: bundleSha256,
    });
    if (!verdict.ok) { refusals.push(`${verdict.code}: ${verdict.detail}`); continue; }

    const marker = verdict.marker;

    // The manifest must agree with the CURRENT authority, field for field.
    if (marker.authorization_id !== manifest.authorization_id) {
      return { ok: false, code: 'manifest_authorization_mismatch', detail: `authority ${marker.authorization_id}, manifest ${manifest.authorization_id}` };
    }
    if (rulingId !== manifest.ruling_id) {
      return { ok: false, code: 'manifest_ruling_mismatch', detail: `authority ruling ${rulingId}, manifest ${manifest.ruling_id}` };
    }
    if (marker.target_packet !== manifest.target_packet) {
      return { ok: false, code: 'manifest_packet_mismatch', detail: `authority ${marker.target_packet}, manifest ${manifest.target_packet}` };
    }
    if (bundleSha256 !== manifest.bootstrap_bundle_sha256) {
      return { ok: false, code: 'manifest_bundle_mismatch', detail: `recomputed ${bundleSha256}, manifest ${manifest.bootstrap_bundle_sha256}` };
    }
    // Set-for-set, so neither order nor a smuggled extra entry passes.
    const a = [...marker.allowed_paths].sort();
    const b = [...(manifest.allowed_paths || [])].sort();
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      return { ok: false, code: 'manifest_allowed_paths_mismatch', detail: `authority ${JSON.stringify(a)}, manifest ${JSON.stringify(b)}` };
    }

    // The durable one-shot claim must exist and describe this same authorization.
    const claim = io.readClaim ? io.readClaim(marker.authorization_id) : null;
    if (!claim) {
      return { ok: false, code: 'no_claim', detail: `no durable claim for ${marker.authorization_id}` };
    }
    if (claim.ruling_id !== rulingId || claim.target_packet !== marker.target_packet || claim.bootstrap_bundle_sha256 !== bundleSha256) {
      return { ok: false, code: 'claim_mismatch', detail: 'the durable claim does not describe the current authorization' };
    }

    return { ok: true, marker, measured: { queueSha256, ready, spent, receiptsReadmeOnly, bundleSha256, repo, rulingId } };
  }
  return { ok: false, code: 'authority_refused', detail: refusals.join(' | ') };
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `CONTROL-PLANE GUARD: ${reason}`,
    },
  };
}

function sessionContext(text) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

export function pathFromToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) return toolInput.file_path ?? null;
  return null;
}

/* ------------------------------------------------------------------ real measurement --------- */

/**
 * MEASURE the seat from the live environment. Nothing here reads the manifest — that is the whole
 * point of AR-1278 F-1.
 */
/**
 * @param trusted values from a source the seat cannot forge — the VERIFIED marker at SessionStart,
 *        or the armed receipt (minted only after that verification) at PreToolUse. Never the manifest.
 */
export function measureObservedIdentity(io, trusted = {}) {
  const git = io.git;
  const remote = git('config', '--get', 'remote.origin.url');
  // Normalize both git@host:owner/repo.git and https://host/owner/repo.git to owner/repo.
  const repo = (remote.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/) || [null, null])[1];

  const queueRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json';
  const receiptRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';
  let queueSha256 = null;
  let ready = -1;
  let spent = -1;
  let receiptsReadmeOnly = false;
  try {
    const bytes = io.readFileBytes(queueRel);
    queueSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const q = JSON.parse(bytes.toString('utf8'));
    spent = Object.keys(q.attempts || {}).length;
    ready = Array.isArray(q.queue) ? q.queue.length - spent : -1;
    receiptsReadmeOnly = io.listDir(receiptRel).filter((f) => f !== 'README.md').length === 0;
  } catch {
    /* leave the refusing defaults in place */
  }

  return {
    repo,
    worktree: io.realpath(git('rev-parse', '--show-toplevel')),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    head: git('rev-parse', 'HEAD'),
    gitDir: git('rev-parse', '--absolute-git-dir'),
    // AR-1278A F-8: these come from a TRUSTED source — the independently verified marker, or the
    // armed receipt minted only after that verification — never from the manifest being validated.
    // The previous version filled them from `manifestExpectations`, which made those five fields
    // compare the manifest to itself.
    actor: trusted.actor,
    targetPacket: trusted.targetPacket,
    authorizationId: trusted.authorizationId,
    rulingId: trusted.rulingId,
    // MEASURED from real bytes, not taken from anyone's claim about it.
    bundleSha256: computeBundle(io.readFileBytes).bundle_sha256,
    queueSha256,
    ready,
    spent,
    receiptsReadmeOnly,
    isSubagent: false,
  };
}

export function receiptPathFor(gitDir, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(gitDir, `tf-control-plane-armed-${safe}.json`);
}

export function receiptBody(sessionId, observed, manifest) {
  return {
    schema: 'CONTROL_PLANE_ARMED_RECEIPT_V1',
    session_id: sessionId,
    repo: observed.repo,
    worktree: observed.worktree,
    branch: observed.branch,
    head: observed.head,
    actor: manifest.actor,
    target_packet: manifest.target_packet,
    authorization_id: manifest.authorization_id,
    ruling_id: manifest.ruling_id,
    bundle_sha256: manifest.bootstrap_bundle_sha256,
    frozen_queue_sha256: observed.queueSha256,
    ready: observed.ready,
    spent: observed.spent,
  };
}

/** The receipt must still describe the seat that is running NOW, not the seat that armed. */
export function receiptMatchesLive(receipt, observed) {
  for (const [rk, ok] of [
    ['repo', 'repo'], ['worktree', 'worktree'], ['branch', 'branch'], ['head', 'head'],
    ['frozen_queue_sha256', 'queueSha256'],
  ]) {
    if (receipt?.[rk] !== observed?.[ok]) {
      return { ok: false, code: `receipt_drift_${rk}`, detail: `${rk}: receipt ${receipt?.[rk]}, live ${observed?.[ok]}` };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ decision ----------------- */

function expectationsFrom(manifest) {
  return {
    repo: manifest?.repo,
    worktree: manifest?.worktree,
    branch: manifest?.branch,
    head: manifest?.head,
    actor: manifest?.actor,
    targetPacket: manifest?.target_packet,
    authorizationId: manifest?.authorization_id,
    rulingId: manifest?.ruling_id,
    queueSha256: manifest?.frozen_queue_sha256,
    bundleSha256: manifest?.bootstrap_bundle_sha256,
  };
}

/**
 * @param input    hook payload
 * @param manifest the control-plane manifest (EXPECTED values only)
 * @param observed MEASURED identity (see measureObservedIdentity)
 * @param store    { readReceipt(sessionId), writeReceipt(sessionId, body) }
 */
export function decide(input, manifest, observed, store, authority = null) {
  const event = input?.hook_event_name;

  if (!manifest || typeof manifest !== 'object') {
    return event === 'PreToolUse'
      ? deny('no control-plane manifest — refusing every tool call')
      : sessionContext('CONTROL-PLANE GUARD NOT ARMED: manifest missing. Do not edit.');
  }

  const identity = verifySeatIdentity(observed, expectationsFrom(manifest));
  const sessionId = input?.session_id;

  if (event === 'SessionStart') {
    // F-8: independent authority verification gates arming. Without it, nothing is minted, and
    // without a minted receipt every subsequent tool call denies.
    if (!authority || authority.ok !== true) {
      const why = authority ? `${authority.code} — ${authority.detail}` : 'authority was never verified';
      return sessionContext(`CONTROL-PLANE GUARD NOT ARMED: ${why}. Do not edit.`);
    }
    if (!identity.ok) {
      return sessionContext(`CONTROL-PLANE GUARD NOT ARMED: ${identity.code} — ${identity.detail}. Do not edit.`);
    }
    if (!sessionId) {
      return sessionContext('CONTROL-PLANE GUARD NOT ARMED: no session_id, so no receipt can be bound. Do not edit.');
    }
    store.writeReceipt(sessionId, receiptBody(sessionId, observed, manifest));
    return sessionContext(
      `CONTROL-PLANE SEAT ARMED: actor=${manifest.actor} packet=${manifest.target_packet} ` +
        `branch=${observed.branch} head=${observed.head.slice(0, 12)} authorization=${manifest.authorization_id} ` +
        `authorized_paths=${(manifest.allowed_paths || []).length}. ` +
        'Agent/Task/PowerShell denied; Bash default-denied; writes outside the allowlist denied.',
    );
  }

  if (event !== 'PreToolUse') return null;

  if (!identity.ok) return deny(`${identity.code} — ${identity.detail}`);

  // F-7: the armed receipt is REQUIRED, and must still describe this seat.
  if (!sessionId) return deny('no session_id on the tool event — cannot bind to an armed receipt');
  const receipt = store.readReceipt(sessionId);
  if (!receipt) return deny('no armed receipt for this session — SessionStart did not arm this seat');
  const drift = receiptMatchesLive(receipt, observed);
  if (!drift.ok) return deny(`${drift.code} — ${drift.detail}`);

  const toolName = input?.tool_name;
  if (typeof toolName !== 'string' || toolName === '') return deny('unreadable tool name');

  const toolVerdict = classifyControlPlaneTool(toolName);
  if (toolVerdict.verdict !== 'ALLOW') return deny(toolVerdict.reason);

  const target = pathFromToolInput(toolName, input?.tool_input);
  if (target !== null) {
    const v = classifyControlPlanePath(target, manifest.allowed_paths);
    if (v.verdict !== 'ALLOW') return deny(`${v.verdict} ${v.path}: ${v.reason}`);
    return null;
  }

  if (toolName === 'Bash') {
    const v = classifyControlPlaneBash(input?.tool_input?.command, {
      allowedPaths: manifest.allowed_paths,
      branch: observed.branch,
    });
    if (v.verdict !== 'ALLOW') return deny(v.reason);
    return null;
  }

  return deny(`tool ${toolName} is not recognised by the control-plane guard — default deny`);
}

/* ------------------------------------------------------------------ CLI ---------------------- */

export function makeRealIo(cwd) {
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const realpath = (p) => fs.realpathSync(p).replaceAll('\\', '/');
  return {
    git,
    cwd,
    readFileBytes: (rel) => fs.readFileSync(path.join(git('rev-parse', '--show-toplevel'), rel)),
    listDir: (rel) => {
      try {
        return fs.readdirSync(path.join(git('rev-parse', '--show-toplevel'), rel));
      } catch {
        return [];
      }
    },
    realpath,
    /**
     * AR-1289A §3/C2 — reads the SAME shared Git-common-dir location the bootstrap wrote to, from
     * THIS worktree's own `git rev-parse --git-common-dir` (which resolves to the same physical
     * directory as every other worktree of this one repository — that is the entire fix). Falls
     * back to the legacy, per-checkout committed store (C4) so an old spent id is still recognised
     * even though new authorizations no longer land there.
     */
    readClaim: (authorizationId) => {
      const commonDir = gitCommonDirAbs({ git, cwd, realpath });
      const repoRoot = git('rev-parse', '--show-toplevel');
      return readClaimEitherStoreReal(commonDir, repoRoot, authorizationId);
    },
  };
}

export function makeRealStore(gitDir) {
  return {
    readReceipt(sessionId) {
      try {
        return JSON.parse(fs.readFileSync(receiptPathFor(gitDir, sessionId), 'utf8'));
      } catch {
        return null;
      }
    },
    writeReceipt(sessionId, body) {
      fs.writeFileSync(receiptPathFor(gitDir, sessionId), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    },
  };
}

function main() {
  let input = null;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(deny(`unreadable hook payload: ${error.message}`))}\n`);
    return;
  }
  try {
    const i = process.argv.indexOf('--manifest');
    const manifestPath = i >= 0 ? process.argv[i + 1] : null;
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    const io = makeRealIo(process.cwd());

    // The trusted source differs by event, and NEITHER is the manifest (AR-1278A F-8):
    //   SessionStart -> the marker this process independently fetched and validated;
    //   PreToolUse   -> the armed receipt, which only a verified SessionStart could have minted.
    let authority = null;
    let trusted = {};
    if (input?.hook_event_name === 'SessionStart') {
      authority = verifyAuthorityIndependently(io, manifest);
      if (authority.ok) {
        trusted = {
          actor: authority.marker.actor,
          targetPacket: authority.marker.target_packet,
          authorizationId: authority.marker.authorization_id,
          rulingId: authority.measured.rulingId,
        };
      }
    } else {
      const probeGitDir = io.git('rev-parse', '--absolute-git-dir');
      const receipt = makeRealStore(probeGitDir).readReceipt(input?.session_id);
      if (receipt) {
        trusted = {
          actor: receipt.actor,
          targetPacket: receipt.target_packet,
          authorizationId: receipt.authorization_id,
          rulingId: receipt.ruling_id,
        };
      }
    }

    const observed = measureObservedIdentity(io, trusted);
    const store = makeRealStore(observed.gitDir);
    const out = decide(input, manifest, observed, store, authority);
    if (out !== null) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (error) {
    if (input?.hook_event_name === 'PreToolUse') {
      process.stdout.write(`${JSON.stringify(deny(`internal error: ${error.message}`))}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(sessionContext(`CONTROL-PLANE GUARD NOT ARMED: ${error.message}`))}\n`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('control-plane-seat-hook.mjs')) main();
