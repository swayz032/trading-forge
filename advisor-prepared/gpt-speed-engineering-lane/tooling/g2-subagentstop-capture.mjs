#!/usr/bin/env node

/**
 * AR-1315A §5 Lane B — the toolbox-side SubagentStop lifecycle adapter (F36), off-live only.
 *
 * WHY THIS IS A SIBLING OF g2-postcall-capture.mjs, NOT PART OF IT
 *   `PostToolUse` and `SubagentStop` are two different real hook events with two DIFFERENT
 *   output contracts. For `PostToolUse`, `{decision:"block", reason}` stops/denies the tool
 *   call. For `Stop`/`SubagentStop`, `decision:"block"` means the OPPOSITE: it forces Claude to
 *   keep going instead of stopping. A `SubagentStop` event fires because the subagent already
 *   finished, so `decision:"block"` here would tell an already-finished agent to keep running —
 *   never a correct response to a capture failure. Sharing one evaluator for both event shapes
 *   risks that distinction leaking into a copy-pasted `block()` call; this file exists so the
 *   SubagentStop path can never reach `claude-hook-bridge.mjs`'s PostToolUse/TaskCompleted
 *   `block()` helper at all (AR-1315A §5 Lane B point 4).
 *
 * WHY THIS IS A DOORWAY AND NOT A SECOND IMPLEMENTATION
 *   Every identity/finality rule already lives in
 *   `src/engine/extraction/g2d_subagentstop_capture.py`, reached through the CLI doorway
 *   `scripts/g2d_postcall_lifecycle.py subagent-stop` (AR-1315A §5 Lane A). This module shells
 *   out to that CLI exactly like `g2-postcall-capture.mjs` shells out to the Python receipt law
 *   for the launch-ack half, and adds no row-resolution, identity, or finality logic of its own.
 *
 * NEVER PRODUCES A HOOK `decision`. Every outcome below — a real final capture, a non-terminal
 * event, a refusal (unbound identity, ambiguous agent_id, malformed payload, duplicate terminal
 * event), or "not this doorway's business" — returns a plain audit-only result. The caller
 * (`claude-hook-bridge.mjs`) must fold this into `{ _audit: ... }` only, never into `block()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Shells out to the trusted Python F36 lifecycle doorway. Never reimplements the receipt law. */
export function defaultCaptureSubagentStop({ repoRoot, queuePath, receiptDir, hookPayload, python }) {
  const script = path.join(repoRoot, 'scripts', 'g2d_postcall_lifecycle.py');
  if (!fs.existsSync(script)) return { ok: false, error: `protected lifecycle doorway not found: ${script}` };

  const tmpPayload = path.join(receiptDir, `.subagentstop-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmpPayload, JSON.stringify(hookPayload ?? null), 'utf8');
  try {
    const exe = python || process.env.TF_PYTHON || 'python';
    const args = [script, 'subagent-stop', '--queue', queuePath, '--receipt-dir', receiptDir, '--hook-payload-json', tmpPayload];
    const res = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: repoRoot });
    if (res.error) return { ok: false, error: `lifecycle doorway did not execute: ${res.error.message}` };
    const out = (res.stdout || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    if (!parsed) {
      return { ok: false, error: `subagent-stop doorway produced no parseable output (exit ${res.status}): ${(res.stderr || '').trim() || out || 'no output'}` };
    }
    if (parsed.ok !== true) {
      return { ok: false, error: parsed.error || 'subagent-stop doorway refused', stage: parsed.stage, raw: parsed };
    }
    return { ok: true, result: parsed };
  } finally {
    // The temp handoff file is never part of the receipt/audit contract; clean up regardless of
    // outcome, exactly like the launch-ack and legacy-capture doorways.
    try { fs.unlinkSync(tmpPayload); } catch { /* already gone */ }
  }
}

/**
 * The gate. `handled: false` means this SubagentStop event is not G2's business (no G2 lifecycle
 * artifacts configured) — the caller does nothing observable. `handled: true` always carries
 * `ok` (whether the doorway accepted the event) and `reason`, and NEVER a `block`/`decision`
 * field — there is no such thing as "blocking" a SubagentStop event in this adapter; see the
 * file header for why forcing continuation on a refusal would be actively wrong.
 */
export function evaluateSubagentStop({
  hookPayload,
  g2,
  cwd = process.cwd(),
  capture = defaultCaptureSubagentStop,
}) {
  if (!g2 || !g2.queuePath || !g2.receiptDir) {
    return { handled: false, reason: 'G2 lifecycle artifacts are not configured' };
  }

  const result = capture({
    repoRoot: cwd,
    queuePath: g2.queuePath,
    receiptDir: g2.receiptDir,
    hookPayload,
  });

  if (!result.ok) {
    return { handled: true, ok: false, action: 'refused', reason: result.error };
  }
  return {
    handled: true,
    ok: true,
    action: result.result.action,
    reason: result.result.note || `subagent-stop recorded (${result.result.action})`,
    result: result.result,
  };
}
