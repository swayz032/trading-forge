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

export const G2_PERMIT_SCHEMA = 'g2d-precall-permit-v1';
export const APPROVED_REQUESTED_MODEL = 'opus';

// Subagent-dispatch tools. A model call issued through any of these can spend an attempt.
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

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
 *  already exists on disk. Either is sufficient — they are separate durable witnesses. */
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

const deny = (reason) => ({ allow: false, g2: true, reason });

/**
 * THE GATE. Returns {allow, g2, reason}.
 *
 * Non-G2 subagent usage is untouched and remains usable under its own policy — this guard
 * exists to protect eight frozen calls, not to police ordinary work.
 */
export function evaluateG2PreCall({ toolName, toolInput, g2, cwd = process.cwd() }) {
  if (!SUBAGENT_TOOLS.has(toolName)) return { allow: true, g2: false, reason: 'not a subagent dispatch' };

  const shaped = isG2Shaped(g2, toolInput);
  if (!shaped.g2) return { allow: true, g2: false, reason: 'benign non-G2 subagent usage' };

  const permitPath = extractPermitPath(toolInput);
  if (!permitPath) {
    return deny(`G2-shaped subagent dispatch (${shaped.why}) carries no durable pre-call permit; refusing before the model call`);
  }

  const absolute = path.isAbsolute(permitPath) ? permitPath : path.resolve(cwd, permitPath);
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

  return {
    allow: true,
    g2: true,
    reason: `authorized G2 pre-call permit for ${permit.condition_ref} at queue ${g2.queueSha256.slice(0, 12)}`,
  };
}
