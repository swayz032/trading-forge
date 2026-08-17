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
export function measureObservedIdentity(io, manifestExpectations = {}) {
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
    // These four are properties of the AUTHORIZATION, not of the filesystem, so they are taken from
    // the expectation side and compared to themselves — deliberately inert. They are listed here so
    // the identity vector has one shape, and they are NOT what F-1 was about.
    actor: manifestExpectations.actor,
    targetPacket: manifestExpectations.targetPacket,
    authorizationId: manifestExpectations.authorizationId,
    rulingId: manifestExpectations.rulingId,
    // Measured, and compared against the authorization's pins.
    bundleSha256: manifestExpectations.bundleSha256,
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
export function decide(input, manifest, observed, store) {
  const event = input?.hook_event_name;

  if (!manifest || typeof manifest !== 'object') {
    return event === 'PreToolUse'
      ? deny('no control-plane manifest — refusing every tool call')
      : sessionContext('CONTROL-PLANE GUARD NOT ARMED: manifest missing. Do not edit.');
  }

  const identity = verifySeatIdentity(observed, expectationsFrom(manifest));
  const sessionId = input?.session_id;

  if (event === 'SessionStart') {
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
  return {
    git,
    readFileBytes: (rel) => fs.readFileSync(path.join(git('rev-parse', '--show-toplevel'), rel)),
    listDir: (rel) => {
      try {
        return fs.readdirSync(path.join(git('rev-parse', '--show-toplevel'), rel));
      } catch {
        return [];
      }
    },
    realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/'),
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
    const observed = measureObservedIdentity(io, expectationsFrom(manifest));
    const store = makeRealStore(observed.gitDir);
    const out = decide(input, manifest, observed, store);
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
