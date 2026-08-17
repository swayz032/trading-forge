#!/usr/bin/env node

/**
 * AR-1263 §7C — the G2-D pre-call boundary.
 *
 * THE HOLE THIS CLOSES: the durable bridge records excellent evidence, but it records it
 * AFTER the model has answered. For a one-shot budget that is too late —
 *
 *     native Opus Task fires -> no matching durable pre-call receipt
 *     -> answer returns -> finalizer correctly REFUSES
 *     -> but the attempt is already burned and cannot be recreated honestly.
 *
 * Required property:
 *   a native subagent invocation that is part of G2-D cannot be issued unless the exact
 *   frozen condition already holds a durable pre-call permit for the exact queue SHA +
 *   task-input SHA + requested `opus` route; a second invocation for the same condition
 *   is denied BEFORE the model call.
 *
 * FAIL-CLOSED DETECTION IS THE WHOLE DESIGN. Detection must not depend on the caller
 * volunteering a marker, or "forgetting" the marker becomes the bypass. So an invocation is
 * treated as G2-shaped when it *touches G2 surface at all* — the frozen queue artifact, the
 * real receipt directory, or any condition ref drawn from the queue itself. A G2-shaped call
 * with no valid permit is DENIED; the permit is how you get through the gate, never how you
 * get noticed by it.
 *
 * `AN OPT-IN GUARD IS A GUARD THAT THE MISTAKE YOU FEAR WILL OPT OUT OF.`
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const G2_PERMIT_SCHEMA = 'g2d-precall-permit-v1';
export const APPROVED_REQUESTED_MODEL = 'opus';
export const NATIVE_CALL_MANIFEST_SCHEMA = 'g2d-native-call-identity-v1';

/**
 * AR-1267 §6.1 — THE ACTUAL MODEL FIELD, NOT THE PERMIT'S OPINION OF IT.
 *
 * `[MEASURED 2026-08-16, live Agent tool schema, read WITHOUT dispatching]` the subagent tool
 * input is `{description, prompt, subagent_type, model?, isolation?}` with
 * `additionalProperties: false`, and `model` is an enum of {sonnet, opus, haiku, fable}. Two
 * facts from that schema are load-bearing here and neither is guessable:
 *
 *   1. `model` is OPTIONAL, and omitting it inherits the parent/agent-definition model. So a
 *      G2 call with no `model` field is NOT "probably Opus" — it is unbound, and unbound must
 *      DENY (AR-1267 §9F: "Agent model omitted/inherited when explicit Opus is required -> deny").
 *   2. `subagent_type: 'fork'` IGNORES `model` outright and inherits the parent's context. That
 *      would break the isolation law and silently defeat the model binding at the same time, so
 *      the frozen row pins the type and a fork can never match it.
 *
 * `additionalProperties: false` is also why the permit travels as a `G2D-PERMIT:` marker inside
 * the prompt rather than a `g2d_permit` field: a real native call cannot carry an extra field.
 * The frozen row therefore pins the prompt WITH its marker, which stays deterministic because
 * the permit path is derived from the receipt dir and the condition ref.
 */
export const ACTUAL_MODEL_FIELD = 'model';
export const APPROVED_ACTUAL_MODEL = 'opus';

/**
 * Subagent-dispatch tools. A model call issued through any of these can spend an attempt.
 *
 * AR-1265 §3.1 — TOOL-NAME PARITY IS LOAD-BEARING. A correct guard that never receives the
 * event is not a guard, so this set and the installed PreToolUse matcher must name the SAME
 * tools. Exported so the registration-parity control can assert that instead of trusting a
 * comment: at the graded pin the matcher was `Edit|Write|NotebookEdit|Bash` while this set
 * was {Agent, Task}, and the gap was invisible to every synthetic test.
 *
 * `[MEASURED 2026-08-16]` the live Claude Code runtime for this seat exposes the subagent
 * dispatch tool as `Agent`; no tool named `Task` is present in its registry (`TaskOutput` and
 * `TaskStop` are distinct tools acting on already-spawned tasks). Both names are retained
 * because a name that never arrives costs nothing, while a name that arrives unguarded is
 * exactly the one-shot hole this file exists to close.
 */
export const SUBAGENT_TOOL_NAMES = Object.freeze(['Agent', 'Task']);
const SUBAGENT_TOOLS = new Set(SUBAGENT_TOOL_NAMES);

/** Mirrors isolated_attempt_receipt._safe_name so "already spent" is checked against the
 *  receipt files the Python side actually writes, not a name we invented here. */
export function safeName(conditionRef) {
  const slug = conditionRef.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  const digest = crypto.createHash('sha256').update(conditionRef, 'utf8').digest('hex').slice(0, 12);
  return `${slug}.${digest}`;
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Load the frozen G2 context from committed artifacts. Never derives or regenerates a queue.
 */
export function loadG2Context({ queuePath, receiptDir }) {
  if (!queuePath || !fs.existsSync(queuePath)) throw new Error(`frozen queue artifact not found: ${queuePath}`);
  if (!receiptDir || !fs.existsSync(receiptDir)) throw new Error(`real receipt directory not found: ${receiptDir}`);

  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const entries = new Map();
  for (const entry of queue.queue || []) {
    entries.set(entry.condition_ref, { task_input_sha256: entry.task_input_sha256 });
  }
  return {
    queuePath,
    receiptDir,
    queueSha256: sha256File(queuePath),
    maxAttemptsPerCondition: queue.max_attempts_per_condition,
    entries,
    attempts: queue.attempts || {},
  };
}

/** A condition is spent if the durable queue records an attempt, or ANY receipt file for it
 *  already exists on disk. Either is sufficient — they are separate durable witnesses.
 *
 *  🛑 AR-1267 §5 — DO NOT "FIX" THIS TO IGNORE `.attempt`. It reads as if it contradicts the
 *  durable law (which writes `.attempt` BEFORE the model runs), and under AR-1266 it genuinely
 *  did: the caller was expected to claim first, so the guard denied the very sequence the law
 *  mandates. The contradiction was in WHO CLAIMS, not in this predicate. Now the hook itself
 *  performs the transition (see §10 of `evaluateG2PreCall`), so at the moment this runs the
 *  correct state is READY with no receipts, and a pre-existing `.attempt` is exactly what it
 *  looks like: a prior claim or a crashed call, which is denied pending desk adjudication. */
export function conditionIsSpent(g2, conditionRef) {
  if (Object.prototype.hasOwnProperty.call(g2.attempts, conditionRef)) {
    return { spent: true, witness: 'queue.attempts records this condition' };
  }
  const base = safeName(conditionRef);
  for (const part of ['attempt', 'dispatch', 'raw', 'completion']) {
    const p = path.join(g2.receiptDir, `${base}.${part}.json`);
    if (fs.existsSync(p)) return { spent: true, witness: `receipt exists: ${path.basename(p)}` };
  }
  return { spent: false, witness: null };
}

/**
 * AR-1267 §9E — FORCED CAPTURE. A `.dispatch` with no completed `.raw` + `.completion` means a
 * call went out and its answer was never captured. Racing on to the next frozen ref would spend
 * a second one-shot attempt while the first answer is still unrecovered — and an uncaptured
 * answer cannot be re-obtained, because the attempt that produced it is already spent.
 *
 * So a crash-shaped ref STOPS THE CAMPAIGN for desk adjudication rather than being skipped.
 * Returns the outstanding ref, or null. Read-only; it never repairs what it finds.
 */
export function outstandingCapture(g2) {
  for (const ref of g2.entries.keys()) {
    const base = safeName(ref);
    const at = (part) => path.join(g2.receiptDir, `${base}.${part}.json`);
    if (!fs.existsSync(at('dispatch'))) continue;
    const missing = ['raw', 'completion'].filter((p) => !fs.existsSync(at(p)));
    if (missing.length) {
      return { ref, missing, witness: `${base}.dispatch.json exists but ${missing.map((m) => `${base}.${m}.json`).join(' + ')} does not` };
    }
  }
  return null;
}

/**
 * AR-1267 §6.2 — the frozen EIGHT-ROW NATIVE-CALL IDENTITY.
 *
 * The queue's `task_input_sha256` binds the LOGICAL task. It says nothing about the bytes that
 * actually reach the model, so a permit for the right condition could accompany a prompt
 * carrying batch answers, a prior winner, a GPT hint or a "correct quote" — and the guard would
 * have seen only that the invocation text CONTAINS the condition ref.
 *
 * This artifact is frozen BEFORE any answer exists, derived only from the already-frozen queue
 * and the pinned source identities, and it is what the actual call is hash-matched against.
 */
export function loadNativeCallManifest({ manifestPath }) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`frozen native-call manifest not found: ${manifestPath}`);
  }
  const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (doc.schema !== NATIVE_CALL_MANIFEST_SCHEMA) {
    throw new Error(`native-call manifest schema is not ${NATIVE_CALL_MANIFEST_SCHEMA}`);
  }
  const rows = new Map();
  for (const row of doc.calls || []) rows.set(row.condition_ref, row);
  if (rows.size === 0) throw new Error('native-call manifest contains no rows');
  return {
    manifestPath,
    queueArtifactSha256: doc.queue_artifact_sha256,
    rows,
  };
}

/**
 * The canonical hash over the LOAD-BEARING fields of the actual tool input.
 *
 * Only three fields decide what the model is and what it is asked; `description` and
 * `isolation` are excluded on purpose, because binding a field that does not change the model's
 * task would make the guard brittle without making it stricter. Key order is fixed by the
 * literal, so this is deterministic across processes.
 */
export function canonicalNativeCallSha256(toolInput) {
  const canonical = JSON.stringify({
    model: typeof toolInput?.model === 'string' ? toolInput.model : null,
    subagent_type: typeof toolInput?.subagent_type === 'string' ? toolInput.subagent_type : null,
    prompt: typeof toolInput?.prompt === 'string' ? toolInput.prompt : null,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * AR-1267 §5 — THE TRUSTED TRANSITION, PERFORMED INSIDE PreToolUse.
 *
 * The durable law writes `.attempt` BEFORE the model is invoked (`claim_attempt`), and
 * `record_native_dispatch` permits `.dispatch` only from CLAIMED. The previous guard treated any
 * `.attempt` as spent, so the two rules could not both be satisfied: claim first and the guard
 * denied; do not claim and the model ran unbudgeted. The seam was procedural, so the repair is
 * to remove the seam — the hook itself performs `claim -> dispatch` and only then returns ALLOW.
 *
 * This SHELLS OUT to the Python law rather than reimplementing it. A second implementation of a
 * receipt contract is a copy that drifts and stops biting while still reporting PASS — the same
 * reason `claude_guard_hook.mjs` is a doorway and not a second guard.
 */
export function defaultTransition({ repoRoot, queuePath, receiptDir, conditionRef, taskInputSha256, python }) {
  const script = path.join(repoRoot, 'scripts', 'g2d_precall_transition.py');
  if (!fs.existsSync(script)) {
    return { ok: false, error: `protected transition doorway not found: ${script}` };
  }
  const exe = python || process.env.TF_PYTHON || 'python';
  const res = spawnSync(exe, [
    script,
    '--queue', queuePath,
    '--receipt-dir', receiptDir,
    '--condition-ref', conditionRef,
    '--task-input-sha256', taskInputSha256,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, cwd: repoRoot });

  if (res.error) return { ok: false, error: `transition doorway did not execute: ${res.error.message}` };
  const out = (res.stdout || '').trim();
  let parsed = null;
  try { parsed = JSON.parse(out); } catch { parsed = null; }
  if (res.status !== 0 || !parsed || parsed.ok !== true) {
    return {
      ok: false,
      error: `transition refused (exit ${res.status}): ${(parsed && parsed.error) || (res.stderr || '').trim() || out || 'no output'}`,
      raw: parsed,
    };
  }
  return { ok: true, receipts: parsed };
}

/**
 * Is this invocation G2-shaped? Fail-closed: we look for G2 surface, not for cooperation.
 */
/** Every string value in the tool input, walked recursively.
 *  We search these RAW strings, never `JSON.stringify` output: stringify escapes Windows
 *  path separators to `\\`, which silently truncated permit paths and produced a confident
 *  "permit unreadable" for a permit that was perfectly readable.
 *  `AUDIT THE INSTRUMENT BEFORE BELIEVING IT.` */
function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringValues(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringValues(v, out);
  return out;
}

const PERMIT_MARKER = /G2D-PERMIT:\s*(\S+)/;

export function isG2Shaped(g2, toolInput) {
  const strings = stringValues(toolInput ?? {});
  const hay = strings.join('\n');

  // A call that carries a permit marker is G2 BY DECLARATION, even if the condition it
  // names is not a queue member — otherwise a bogus ref would route around the gate.
  if (toolInput && typeof toolInput.g2d_permit === 'string' && toolInput.g2d_permit.trim() !== '') {
    return { g2: true, why: 'carries a G2 pre-call permit field' };
  }
  if (PERMIT_MARKER.test(hay)) return { g2: true, why: 'carries a G2 pre-call permit marker' };

  if (hay.includes(path.basename(g2.queuePath))) return { g2: true, why: 'references the frozen queue artifact' };
  if (hay.includes(path.basename(g2.receiptDir))) return { g2: true, why: 'references the real receipt directory' };
  for (const ref of g2.entries.keys()) {
    if (hay.includes(ref)) return { g2: true, why: `references frozen condition ref ${ref}` };
  }
  return { g2: false, why: null };
}

function extractPermitPath(toolInput) {
  if (toolInput && typeof toolInput.g2d_permit === 'string' && toolInput.g2d_permit.trim() !== '') {
    return toolInput.g2d_permit.trim();
  }
  for (const s of stringValues(toolInput ?? {})) {
    const m = s.match(PERMIT_MARKER);
    if (m) return m[1];
  }
  return null;
}

/**
 * AR-1304 §5 (F29 repair) — THE ONLY PLACE A PERMIT PATH IS COMPUTED, NOT CHOSEN.
 *
 * Mirrors the existing `.attempt` / `.dispatch` / `.raw` / `.completion` naming convention
 * (`safeName(conditionRef)` under `receiptDir`) so a permit sits beside the receipts it
 * precedes. A caller-supplied path is never trusted as this value — see step 9 below.
 */
export function permitPathFor(receiptDir, conditionRef) {
  return path.join(receiptDir, `${safeName(conditionRef)}.permit.json`);
}

/**
 * AR-1304 §5 (F29 repair) — HOOK-OWNED EXACT PERMIT MATERIALIZATION.
 *
 * THE DEADLOCK THIS CLOSES: the ordinary Worker-1 lane guard categorically self-protects the
 * entire frozen receipt namespace, so nothing with write authority can pre-create the permit
 * file `extractPermitPath` used to require. No sanctioned permit issuer bridged that gap.
 *
 * THE FIX IS NARROW: when the marker names a permit path that does not exist yet, this may
 * WRITE that exact file, create-only, but only from values already frozen elsewhere — never
 * from anything the caller supplied. Every check below is a REFUSAL to materialize; it is not
 * a second copy of the validation `evaluateG2PreCall` performs after reading the permit back
 * (steps 1-9 in that function are unchanged and still run against whatever this writes).
 *
 * Returns `{ materialized: true }` on a successful create-only write, `{ materialized: false }`
 * when a permit now exists at that path (this call raced a concurrent one, or one already
 * existed) and the caller should just read it, or `{ materialized: false, denyReason }` when
 * materialization is refused outright and the caller must deny before ever touching the model.
 */
export function materializePermitIfNeeded({ g2, toolInput, actualModel, permitPath, nativeCalls }) {
  if (fs.existsSync(permitPath)) return { materialized: false };

  if (!nativeCalls) {
    return { materialized: false, denyReason: 'no frozen native-call identity manifest is loaded, so no permit can be materialized' };
  }
  if (nativeCalls.queueArtifactSha256 !== g2.queueSha256) {
    return {
      materialized: false,
      denyReason: `native-call manifest was frozen against queue ${nativeCalls.queueArtifactSha256} but the live frozen queue is ${g2.queueSha256}`,
    };
  }

  // AR-1304 §5 step 6 — model must be the explicit, actual 'opus' route before anything else.
  if (actualModel !== APPROVED_ACTUAL_MODEL) {
    return {
      materialized: false,
      denyReason: `cannot materialize a permit: the actual native call requests model '${actualModel}', not '${APPROVED_ACTUAL_MODEL}'`,
    };
  }

  // AR-1304 §5 step 2/3 — resolve the ONE frozen row this exact call matches. No condition_ref
  // is trusted from the caller anywhere in this function; it is derived solely from the byte-
  // exact match between the actual call and the frozen manifest.
  const actualSha = canonicalNativeCallSha256(toolInput);
  let matchedRow = null;
  for (const row of nativeCalls.rows.values()) {
    if (row.native_call_sha256 === actualSha) { matchedRow = row; break; }
  }
  if (!matchedRow) {
    return {
      materialized: false,
      denyReason: `no frozen native-call row matches this exact call (canonical sha256 ${actualSha}); refusing to materialize a permit for an unrecognized call`,
    };
  }

  // AR-1304 §5 step 7 — subagent_type must match the frozen row. NOTE: `matchedRow` was found
  // by an exact canonical-hash match over {model, subagent_type, prompt} (step 2/3 above), so a
  // subagent_type mismatch is already impossible to reach this point with — the hash match
  // itself is the enforcement. This check stays as defense-in-depth documentation of the
  // requirement, not as reachable dead code the reader has to puzzle out.
  if (toolInput?.subagent_type !== matchedRow.subagent_type) {
    return {
      materialized: false,
      denyReason: `cannot materialize a permit: subagent_type '${toolInput?.subagent_type}' does not match the frozen '${matchedRow.subagent_type}' for ${matchedRow.condition_ref}`,
    };
  }

  const conditionRef = matchedRow.condition_ref;
  const entry = g2.entries.get(conditionRef);
  if (!entry) {
    return {
      materialized: false,
      denyReason: `native-call manifest row names condition_ref ${conditionRef}, which is not a member of the frozen queue`,
    };
  }

  // AR-1304 §5 step 9 — the permit path is DERIVED, never a caller's arbitrary choice. A
  // marker naming any other path is refused outright rather than silently redirected.
  const expectedPath = permitPathFor(g2.receiptDir, conditionRef);
  if (path.resolve(permitPath) !== path.resolve(expectedPath)) {
    return {
      materialized: false,
      denyReason: `permit marker names ${permitPath}, but the frozen derivation for ${conditionRef} is ${expectedPath}; refusing to materialize at an arbitrary path`,
    };
  }

  // AR-1304 §5 step 10 — only READY (never spent/claimed) may be materialized.
  const spent = conditionIsSpent(g2, conditionRef);
  if (spent.spent) {
    return {
      materialized: false,
      denyReason: `condition ${conditionRef} is already spent/claimed (${spent.witness}); refusing to materialize a permit for it`,
    };
  }

  const permit = {
    schema: G2_PERMIT_SCHEMA,
    queue_artifact_sha256: g2.queueSha256,
    condition_ref: conditionRef,
    task_input_sha256: entry.task_input_sha256,
    requested_model: APPROVED_REQUESTED_MODEL,
    attempt: 1,
  };

  try {
    // Create-only: a concurrent materialization for the same condition can win this race, but
    // never both — the loser falls through to read what the winner wrote, unchanged.
    fs.writeFileSync(expectedPath, JSON.stringify(permit, null, 2), { flag: 'wx' });
    return { materialized: true };
  } catch (error) {
    if (error && error.code === 'EEXIST') return { materialized: false };
    return { materialized: false, denyReason: `permit materialization failed: ${error.message}` };
  }
}

const deny = (reason) => ({ allow: false, g2: true, reason });

/**
 * THE GATE. Returns {allow, g2, reason}.
 *
 * Non-G2 subagent usage is untouched and remains usable under its own policy — this guard
 * exists to protect eight frozen calls, not to police ordinary work.
 */
export function evaluateG2PreCall({
  toolName,
  toolInput,
  g2,
  cwd = process.cwd(),
  strictSession = false,
  nativeCalls = null,
  transition = defaultTransition,
}) {
  if (!SUBAGENT_TOOLS.has(toolName)) return { allow: true, g2: false, reason: 'not a subagent dispatch' };

  // AR-1265 §3.2 — THE CONTENT-DETECTION BYPASS.
  // Content-shaped detection is fail-closed against a caller who *mentions* G2 surface, but it
  // is still evadable by a G2 dispatch carrying only condition PROSE: no queue filename, no
  // condition ref, no permit marker. That call would be classified benign and allowed, and the
  // attempt would burn. So the dedicated eight-call execution session runs in STRICT mode, where
  // membership is decided by the SESSION, not by the payload:
  //
  //     strict session  =>  EVERY subagent dispatch needs a valid permit, full stop.
  //
  // Cheap helper work is simply not permitted inside that reserved session; it exists to spend
  // exactly eight controlled calls, not to do general engineering. The non-G2 calibration runs
  // BEFORE strict mode is armed, never as an exemption carved inside it.
  const shaped = strictSession
    ? { g2: true, why: 'strict dedicated G2 execution session: every subagent dispatch requires a permit' }
    : isG2Shaped(g2, toolInput);
  if (!shaped.g2) return { allow: true, g2: false, reason: 'benign non-G2 subagent usage' };

  const permitPath = extractPermitPath(toolInput);
  if (!permitPath) {
    return deny(`G2-shaped subagent dispatch (${shaped.why}) carries no durable pre-call permit; refusing before the model call`);
  }

  const absolute = path.isAbsolute(permitPath) ? permitPath : path.resolve(cwd, permitPath);

  // AR-1304 §5 (F29) — materialize the exact frozen permit when it does not exist yet. This
  // runs BEFORE the read below, and it is the only place a permit file is ever written by this
  // guard. It either creates the file, finds one already there (never overwritten), or returns
  // a denial reason — in every case control falls through to the SAME read-and-validate path
  // that already existed, so nothing here shortcuts steps 1-9 below.
  const materialize = materializePermitIfNeeded({
    g2,
    toolInput,
    actualModel: toolInput ? toolInput[ACTUAL_MODEL_FIELD] : undefined,
    permitPath: absolute,
    nativeCalls,
  });
  if (materialize.denyReason) return deny(materialize.denyReason);

  let permit;
  try {
    permit = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    return deny(`pre-call permit unreadable (${absolute}): ${error.message}`);
  }

  if (permit.schema !== G2_PERMIT_SCHEMA) {
    return deny(`pre-call permit schema is not ${G2_PERMIT_SCHEMA}`);
  }

  // 1. exact queue artifact identity
  if (permit.queue_artifact_sha256 !== g2.queueSha256) {
    return deny(`permit queue SHA ${permit.queue_artifact_sha256} != frozen queue SHA ${g2.queueSha256}`);
  }

  // 2. the condition must be a real member of the frozen eight
  const entry = g2.entries.get(permit.condition_ref);
  if (!entry) {
    return deny(`permit condition_ref ${permit.condition_ref} is not a member of the frozen queue`);
  }

  // 3. exact task input identity
  if (permit.task_input_sha256 !== entry.task_input_sha256) {
    return deny(`permit task_input_sha256 does not match the frozen entry for ${permit.condition_ref}`);
  }

  // 4. exact requested model route — strict equality, never a family guess
  if (permit.requested_model !== APPROVED_REQUESTED_MODEL) {
    return deny(`permit requested_model must be exactly '${APPROVED_REQUESTED_MODEL}', got '${permit.requested_model}'`);
  }

  // 5. the permit must describe the condition the invocation actually names
  const blob = stringValues(toolInput ?? {}).join('\n');
  if (!blob.includes(permit.condition_ref)) {
    return deny(`permit is for ${permit.condition_ref}, which this invocation does not name`);
  }

  // 6. one shot only
  const spent = conditionIsSpent(g2, permit.condition_ref);
  if (spent.spent) {
    return deny(`condition ${permit.condition_ref} is already spent/claimed (${spent.witness}); a second dispatch is refused before the model call`);
  }
  if (permit.attempt !== 1 || permit.attempt > g2.maxAttemptsPerCondition) {
    return deny(`permit attempt must be 1 and within max_attempts_per_condition=${g2.maxAttemptsPerCondition}, got ${permit.attempt}`);
  }

  // 7. AR-1267 §9E — nothing proceeds while an earlier answer is still uncaptured.
  const outstanding = outstandingCapture(g2);
  if (outstanding) {
    return deny(
      `a prior frozen dispatch has not been captured (${outstanding.witness}); every subsequent ` +
      'frozen dispatch is refused until that answer is captured or the desk adjudicates it. ' +
      'An uncaptured answer cannot be re-obtained — its attempt is already spent.',
    );
  }

  // 8. AR-1267 §6.1 — THE ACTUAL model field, not the permit's claim about it.
  //    Checked separately from the hash so the denial names the real reason.
  const actualModel = toolInput ? toolInput[ACTUAL_MODEL_FIELD] : undefined;
  if (typeof actualModel !== 'string' || actualModel.trim() === '') {
    return deny(
      `the actual native call sets no '${ACTUAL_MODEL_FIELD}' field, so its model is inherited ` +
      `rather than requested; G2-D requires an explicit '${APPROVED_ACTUAL_MODEL}' route`,
    );
  }
  if (actualModel !== APPROVED_ACTUAL_MODEL) {
    return deny(
      `the actual native call requests model '${actualModel}', not '${APPROVED_ACTUAL_MODEL}'; ` +
      'a correct-looking permit may not accompany a call to another model',
    );
  }

  // 9. AR-1267 §6.2 — the actual call must BE the frozen call, byte for byte.
  if (!nativeCalls) {
    return deny(
      'no frozen native-call identity manifest is loaded, so the actual prompt and model cannot ' +
      'be bound to the authorized task; refusing before the model call',
    );
  }
  if (nativeCalls.queueArtifactSha256 !== g2.queueSha256) {
    return deny(
      `native-call manifest was frozen against queue ${nativeCalls.queueArtifactSha256} but the ` +
      `live frozen queue is ${g2.queueSha256}`,
    );
  }
  const row = nativeCalls.rows.get(permit.condition_ref);
  if (!row) {
    return deny(`native-call manifest has no frozen row for ${permit.condition_ref}`);
  }
  if (row.task_input_sha256 !== entry.task_input_sha256) {
    return deny(`native-call row for ${permit.condition_ref} pins a task hash the frozen queue does not`);
  }
  if (row.subagent_type !== toolInput?.subagent_type) {
    return deny(
      `the actual native call uses subagent_type '${toolInput?.subagent_type}', not the frozen ` +
      `'${row.subagent_type}'`,
    );
  }
  const actualSha = canonicalNativeCallSha256(toolInput);
  if (actualSha !== row.native_call_sha256) {
    return deny(
      `the actual native call does not match the frozen execution identity for ` +
      `${permit.condition_ref}: canonical sha256 ${actualSha} != frozen ${row.native_call_sha256}. ` +
      'A changed prompt, an added hint, a pasted batch answer or a changed model all land here.',
    );
  }

  // 10. AR-1267 §5 — THE TRANSITION IS THE ALLOW.
  //     `.attempt` then `.dispatch`, both create-only, through the existing Python law, and only
  //     then does Claude get to run the model. The create-only receipt is the race arbiter, so a
  //     concurrent pair produces at most one ALLOW. If the claim lands and the dispatch does not,
  //     the attempt is SPENT and this denies: no cleanup, no retry (AR-1267 §5).
  const moved = transition({
    repoRoot: cwd,
    queuePath: g2.queuePath,
    receiptDir: g2.receiptDir,
    conditionRef: permit.condition_ref,
    taskInputSha256: entry.task_input_sha256,
  });
  if (!moved || moved.ok !== true) {
    return deny(
      `the durable claim -> dispatch transition did not complete, so the model call is refused: ` +
      `${(moved && moved.error) || 'transition returned nothing'}`,
    );
  }

  return {
    allow: true,
    g2: true,
    transitioned: true,
    reason:
      `authorized G2 pre-call permit for ${permit.condition_ref} at queue ` +
      `${g2.queueSha256.slice(0, 12)}; durable attempt and dispatch were written before this ALLOW`,
  };
}
