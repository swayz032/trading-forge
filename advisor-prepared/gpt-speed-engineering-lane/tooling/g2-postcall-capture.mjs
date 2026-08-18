#!/usr/bin/env node

/**
 * AR-1303A §3/§6, AR-1304 §6 — the G2-D post-call return-capture boundary (F30).
 *
 * THE HOLE THIS CLOSES: the durable bridge already defines the correct terminal law
 * (READY -> CLAIMED -> NATIVE_TASK_DISPATCHED -> RAW_RETURN_CAPTURED, `capture_native_return`
 * in `isolated_bridge.py`), but nothing trusted ever calls it. The live Worker guard registers
 * only SessionStart and PreToolUse, so a real dispatch reaches NATIVE_TASK_DISPATCHED and then
 * strands there — and ordinary Worker prose "copying the answer into a receipt afterward" is
 * both procedurally lossy and forbidden by the same self-protection fencing the receipt
 * namespace off from every other Worker write.
 *
 * WHY THIS DOES NOT REIMPLEMENT THE RECEIPT LAW: it shells out to
 * `scripts/g2d_postcall_capture.py`, which itself does nothing but call
 * `isolated_bridge.capture_native_return`. A second implementation of a receipt contract is a
 * copy that drifts and stops biting while still reporting PASS — the same reason
 * `g2-precall-guard.mjs`'s `defaultTransition` shells out to `g2d_precall_transition.py`.
 *
 * 🛑 UNVERIFIED AGAINST THE LIVE RUNTIME, FLAGGED HONESTLY (AR-1304 §6, "if it does not expose
 * such an event with sufficient evidence, do not fabricate one"): this module was built and
 * tested only against SYNTHETIC hook-event input, because proving the real PostToolUse payload
 * shape for the Agent tool requires an actual dispatch, which this repair is explicitly
 * forbidden from making. `extractRawResponseText()` below accepts the shapes the public Claude
 * Code hook documentation describes (`tool_response` as either a string or an object), but the
 * EXACT field name and shape on this runtime's PostToolUse event has not been observed live.
 * Whoever performs the live propagation step MUST confirm this against a real (or a captured,
 * real) PostToolUse payload before wiring this into `.claude/settings.json` — this is named
 * explicitly in the handoff packet as a live surface still requiring verification, not
 * silently assumed correct.
 *
 * 🛑 AR-1314A/AR-1315A F36 — CORRECTED, 2026-08-18: a resolved strict-G2 PostToolUse(Agent|Task)
 * return is the SYNCHRONOUS async-launch acknowledgement, never the subagent's final answer.
 * `evaluatePostCallCapture()` below NO LONGER calls `capture_native_return` (via `defaultCapture`
 * / `scripts/g2d_postcall_capture.py`) for a resolved G2 row — doing so was exactly the F36
 * defect: an ack persisted as though it were the final raw return, permanently occupying the
 * row's one-shot receipt slot before the subagent had actually finished. It now ALWAYS routes a
 * resolved row to `defaultCaptureLaunchAck()` / `scripts/g2d_postcall_lifecycle.py launch-ack`
 * (AR-1315A §5 Lane A), which validates the documented async-launch shape and calls
 * `record_async_launch_ack()` only — the row stays `NATIVE_TASK_DISPATCHED`. Final capture now
 * happens ONLY through a later, separately-handled real `SubagentStop` event
 * (`g2-subagentstop-capture.mjs`). `defaultCapture` and `extractRawResponseText` are kept and
 * still tested below because `scripts/g2d_postcall_capture.py` remains a real, separately-used
 * doorway (`scripts/g2d_bridge_report.py` still calls it) — they are simply no longer invoked
 * from this gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SUBAGENT_TOOL_NAMES, canonicalNativeCallSha256, safeName } from './g2-precall-guard.mjs';

const SUBAGENT_TOOLS = new Set(SUBAGENT_TOOL_NAMES);

function receiptPath(receiptDir, conditionRef, part) {
  return path.join(receiptDir, `${safeName(conditionRef)}.${part}.json`);
}

/**
 * AR-1305A PAYLOAD-SHAPE GAP, RESOLVED WITHOUT A MODEL CALL.
 *
 * `tool_response` IS THE CONFIRMED FIELD NAME — found verbatim in the shipped Claude Code
 * binary's own embedded hook documentation (`strings`-searched, zero model calls):
 *
 *     ### Hook Input (stdin JSON)
 *     {
 *       "session_id": "abc123",
 *       "tool_name": "Write",
 *       "tool_input": { ... },
 *       "tool_response": { "success": true }  // PostToolUse only
 *     }
 *
 * But that is a Write-tool example, and no production example for the Agent tool's own
 * response shape was found anywhere in the installed runtime's embedded strings — so which
 * SUB-FIELD (if any) would hold "the answer text" for a subagent dispatch is genuinely
 * unresolved. AR-1305A: "do not depend on a speculative text/content/result/output guess
 * without production-shape proof."
 *
 * THE RESOLUTION: stop guessing a sub-field. Preserve `tool_response` WHOLE. A string passes
 * through unchanged (the confirmed-simplest case). Anything else — object, array, whatever
 * shape the Agent tool's response actually turns out to be — is captured as its exact JSON
 * serialization, not a cherry-picked key. This is provably lossless with respect to whatever
 * the hook supplies, precisely because it never has to know or guess which part is "the real
 * answer": `capture_native_return()` hashes exactly these bytes, so the persisted receipt is
 * the full response, byte-identical, regardless of its internal shape.
 */
export function extractRawResponseText(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  return JSON.stringify(toolResponse ?? null);
}

/** Shells out to the trusted Python doorway. Never reimplements the receipt law.
 *
 * 🛑 AR-1315A §5 Lane B: NOT called by `evaluatePostCallCapture()` any more (see below). Kept,
 * exported and independently tested because `scripts/g2d_postcall_capture.py` still exists and
 * is still called by `scripts/g2d_bridge_report.py` — deleting this doorway would strand that
 * caller for a reason unrelated to F36. */
export function defaultCapture({ repoRoot, queuePath, receiptDir, conditionRef, rawOutput, completion, python }) {
  const script = path.join(repoRoot, 'scripts', 'g2d_postcall_capture.py');
  if (!fs.existsSync(script)) return { ok: false, error: `protected capture doorway not found: ${script}` };

  const tmpRaw = path.join(receiptDir, `.postcall-raw-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmpRaw, rawOutput ?? '', 'utf8');
  let tmpCompletion = null;
  const args = [script, '--queue', queuePath, '--receipt-dir', receiptDir, '--condition-ref', conditionRef, '--raw-output-file', tmpRaw];
  try {
    if (completion) {
      tmpCompletion = path.join(receiptDir, `.postcall-completion-${process.pid}-${Date.now()}.tmp`);
      fs.writeFileSync(tmpCompletion, JSON.stringify(completion), 'utf8');
      args.push('--completion-json', tmpCompletion);
    }
    const exe = python || process.env.TF_PYTHON || 'python';
    const res = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: repoRoot });
    if (res.error) return { ok: false, error: `capture doorway did not execute: ${res.error.message}` };
    const out = (res.stdout || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    if (res.status !== 0 || !parsed || parsed.ok !== true) {
      return { ok: false, error: `capture refused (exit ${res.status}): ${(parsed && parsed.error) || (res.stderr || '').trim() || out || 'no output'}`, raw: parsed };
    }
    return { ok: true, receipt: parsed };
  } finally {
    // The temp handoff files are never part of the receipt contract; clean up regardless of
    // outcome so a refused capture leaves no trace beyond what capture_native_return itself
    // wrote (or, on refusal, wrote nothing).
    for (const f of [tmpRaw, tmpCompletion]) { if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } } }
  }
}

/**
 * AR-1315A §5 Lane B point 1 — shells out to the F36 Worker-side doorway
 * (`scripts/g2d_postcall_lifecycle.py launch-ack`, AR-1315A §5 Lane A), which itself does
 * nothing but validate the documented async-launch-ack shape and call
 * `record_async_launch_ack()`. This function reimplements neither check: an unknown shape, a
 * missing agent identity, a row not currently NATIVE_TASK_DISPATCHED, or a duplicate ack are
 * ALL refused by the Python doorway, and its refusal reason is surfaced here unchanged.
 */
export function defaultCaptureLaunchAck({ repoRoot, queuePath, receiptDir, conditionRef, ackPayload, python }) {
  const script = path.join(repoRoot, 'scripts', 'g2d_postcall_lifecycle.py');
  if (!fs.existsSync(script)) return { ok: false, error: `protected lifecycle doorway not found: ${script}` };

  const tmpAck = path.join(receiptDir, `.postcall-ack-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmpAck, JSON.stringify(ackPayload ?? null), 'utf8');
  try {
    const exe = python || process.env.TF_PYTHON || 'python';
    const args = [script, 'launch-ack', '--queue', queuePath, '--receipt-dir', receiptDir, '--condition-ref', conditionRef, '--ack-payload-json', tmpAck];
    const res = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: repoRoot });
    if (res.error) return { ok: false, error: `lifecycle doorway did not execute: ${res.error.message}` };
    const out = (res.stdout || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    if (res.status !== 0 || !parsed || parsed.ok !== true) {
      return { ok: false, error: `launch ack refused (exit ${res.status}): ${(parsed && parsed.error) || (res.stderr || '').trim() || out || 'no output'}`, raw: parsed };
    }
    return { ok: true, receipt: parsed };
  } finally {
    // Same handoff-file discipline as defaultCapture: never part of the receipt contract.
    try { fs.unlinkSync(tmpAck); } catch { /* already gone */ }
  }
}

/**
 * THE GATE. Returns { handled, reason } for a non-G2 or unresolved call outside strict G2, or
 * { handled: true, captured: true|false, block, reason } once inside strict G2 or once the
 * call has been resolved to a frozen row.
 *
 * `handled: false` means "this PostToolUse event is none of this doorway's business" — the
 * caller must let it through untouched, exactly as `evaluateG2PreCall` leaves non-G2 subagent
 * usage untouched. This is the ONLY shape possible outside `strictSession`.
 *
 * AR-1305A F35 — `block: true` means the caller (the bridge) must emit a hook `decision: block`
 * response rather than staying silent. Two different sources of `block`:
 *   1. Inside `strictSession`, even an UNRESOLVABLE call (no manifest, queue mismatch, no
 *      matching row) is an anomaly, not silent pass-through — the dedicated eight-call session
 *      exists to run exactly eight authorized calls, and an Agent/Task return it cannot join to
 *      one of them is exactly the kind of stop AR-1265 §3.2 already requires on the PRE-call
 *      side for prose-only dispatches. Outside strict G2, the identical unresolvable call is
 *      ordinary unrelated Agent use and stays untouched (`handled: false`).
 *   2. ONCE A CALL IS RESOLVED to a frozen row (an exact canonical-hash match — never a
 *      coincidence), any further anomaly (no prior dispatch, duplicate capture, a capture
 *      failure) is unambiguously a G2 problem regardless of strict/non-strict, because matching
 *      the frozen manifest IS the proof of G2-ness. These cases are ALWAYS `block: true`.
 */
export function evaluatePostCallCapture({
  toolName,
  toolInput,
  toolResponse,
  g2,
  cwd = process.cwd(),
  nativeCalls = null,
  strictSession = false,
  captureLaunchAck = defaultCaptureLaunchAck,
}) {
  if (!SUBAGENT_TOOLS.has(toolName)) return { handled: false, reason: 'not a subagent dispatch' };

  const unresolved = (reason) => (strictSession
    ? { handled: true, captured: false, block: true, reason: `strict G2 session: ${reason}; an Agent/Task return that cannot be joined to exactly one authorized frozen dispatch is an anomaly, not silent pass-through` }
    : { handled: false, reason });

  if (!nativeCalls) return unresolved('no frozen native-call identity manifest is loaded');
  if (nativeCalls.queueArtifactSha256 !== g2.queueSha256) {
    return unresolved('native-call manifest is frozen against a different queue than the live one');
  }

  // Re-identify the call the SAME way the pre-call guard does: an exact canonical-hash match
  // against the frozen manifest, never a caller-supplied condition_ref.
  const actualSha = canonicalNativeCallSha256(toolInput);
  let matchedRow = null;
  for (const row of nativeCalls.rows.values()) {
    if (row.native_call_sha256 === actualSha) { matchedRow = row; break; }
  }
  if (!matchedRow) return unresolved('no frozen native-call row matches this exact call (not G2)');

  // Past this point the call IS resolved to a frozen row — every remaining anomaly is
  // unconditionally block:true, strict or not (see doc comment above).
  const conditionRef = matchedRow.condition_ref;
  const dispatchP = receiptPath(g2.receiptDir, conditionRef, 'dispatch');
  const rawP = receiptPath(g2.receiptDir, conditionRef, 'raw');
  const completionP = receiptPath(g2.receiptDir, conditionRef, 'completion');

  if (!fs.existsSync(dispatchP)) {
    return { handled: true, captured: false, block: true, reason: `no prior dispatch recorded for ${conditionRef}; a post-call event for an undispatched row is refused` };
  }
  if (fs.existsSync(rawP) || fs.existsSync(completionP)) {
    return { handled: true, captured: false, block: true, reason: `${conditionRef} already has a captured raw return; a second capture is refused` };
  }

  // AR-1315A §5 Lane B point 1/2: a resolved strict-G2 PostToolUse(Agent|Task) return is the
  // SYNCHRONOUS async-launch acknowledgement, never the subagent's final answer (F36's root
  // cause). This path therefore NEVER calls capture_native_return()/defaultCapture any more —
  // it ALWAYS routes to the F36 launch-ack doorway, which itself validates the documented
  // async-launch shape and fails closed on anything else. The row stays NATIVE_TASK_DISPATCHED;
  // only a later, separately-handled SubagentStop event (g2-subagentstop-capture.mjs) may
  // finalize it.
  const result = captureLaunchAck({
    repoRoot: cwd,
    queuePath: g2.queuePath,
    receiptDir: g2.receiptDir,
    conditionRef,
    ackPayload: toolResponse,
  });

  if (!result.ok) {
    return { handled: true, captured: false, block: true, reason: `async launch ack refused: ${result.error}` };
  }
  return {
    handled: true,
    captured: false,
    launchAck: true,
    block: false,
    reason: `recorded async launch ack for ${conditionRef}; row remains NATIVE_TASK_DISPATCHED`,
    receipt: result.receipt,
  };
}
