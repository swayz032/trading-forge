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
 * Best-effort extraction of the raw text a PostToolUse event carries for a subagent's answer.
 * Accepts a plain string, or an object exposing a `text`/`content`/`result` field (the shapes
 * documented for Claude Code hook tool results); anything else is serialized verbatim so no
 * information is silently dropped, and the exact bytes handed to `capture_native_return` are
 * always traceable back to what this function was given.
 */
export function extractRawResponseText(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  if (toolResponse && typeof toolResponse === 'object') {
    for (const key of ['text', 'content', 'result', 'output']) {
      const v = toolResponse[key];
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) {
        const joined = v.map((b) => (typeof b === 'string' ? b : (b?.text ?? JSON.stringify(b)))).join('');
        if (joined) return joined;
      }
    }
  }
  return JSON.stringify(toolResponse ?? null);
}

/** Shells out to the trusted Python doorway. Never reimplements the receipt law. */
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
 * THE GATE. Returns { handled, reason } for a non-G2 or unresolved call, or
 * { handled: true, captured: true|false, reason } for a resolved G2 dispatch.
 *
 * `handled: false` means "this PostToolUse event is none of this doorway's business" — the
 * caller must let it through untouched, exactly as `evaluateG2PreCall` leaves non-G2 subagent
 * usage untouched.
 */
export function evaluatePostCallCapture({
  toolName,
  toolInput,
  toolResponse,
  g2,
  cwd = process.cwd(),
  nativeCalls = null,
  capture = defaultCapture,
}) {
  if (!SUBAGENT_TOOLS.has(toolName)) return { handled: false, reason: 'not a subagent dispatch' };
  if (!nativeCalls) return { handled: false, reason: 'no frozen native-call identity manifest is loaded' };
  if (nativeCalls.queueArtifactSha256 !== g2.queueSha256) {
    return { handled: false, reason: 'native-call manifest is frozen against a different queue than the live one' };
  }

  // Re-identify the call the SAME way the pre-call guard does: an exact canonical-hash match
  // against the frozen manifest, never a caller-supplied condition_ref.
  const actualSha = canonicalNativeCallSha256(toolInput);
  let matchedRow = null;
  for (const row of nativeCalls.rows.values()) {
    if (row.native_call_sha256 === actualSha) { matchedRow = row; break; }
  }
  if (!matchedRow) return { handled: false, reason: 'no frozen native-call row matches this exact call (not G2)' };

  const conditionRef = matchedRow.condition_ref;
  const dispatchP = receiptPath(g2.receiptDir, conditionRef, 'dispatch');
  const rawP = receiptPath(g2.receiptDir, conditionRef, 'raw');
  const completionP = receiptPath(g2.receiptDir, conditionRef, 'completion');

  if (!fs.existsSync(dispatchP)) {
    return { handled: true, captured: false, reason: `no prior dispatch recorded for ${conditionRef}; a post-call event for an undispatched row is refused` };
  }
  if (fs.existsSync(rawP) || fs.existsSync(completionP)) {
    return { handled: true, captured: false, reason: `${conditionRef} already has a captured raw return; a second capture is refused` };
  }

  const rawOutput = extractRawResponseText(toolResponse);
  const result = capture({
    repoRoot: cwd,
    queuePath: g2.queuePath,
    receiptDir: g2.receiptDir,
    conditionRef,
    rawOutput,
    completion: null,
  });

  if (!result.ok) {
    return { handled: true, captured: false, reason: `capture refused: ${result.error}` };
  }
  return { handled: true, captured: true, reason: `captured raw return for ${conditionRef}`, receipt: result.receipt };
}
