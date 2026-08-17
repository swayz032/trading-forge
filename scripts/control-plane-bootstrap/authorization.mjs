/**
 * AR-1277 §7 — THE EXECUTION-AUTHORIZATION MARKER, AND WHY IT IS A SCHEMA AND NOT A PHRASE.
 *
 * AR-1276C §7, verbatim: "Do not authorize execution based on the words `control-plane`,
 * `AR-1278`, or a partial JSON match." So nothing in this file greps prose. A marker is accepted
 * only when EVERY field of a closed schema validates against independently MEASURED repository
 * state, and it is rejected on the first failure with a distinct machine-readable reason.
 *
 * ★ THE DISCRIMINATOR IS `authorization_class`.
 * AR-1276C §7 prints a complete, well-formed marker and then says it is a DESIGN SCHEMA EXAMPLE
 * that must be refused. A validator that keys on schema name alone would happily execute the
 * ruling that told it not to. So the executable form carries a field the example does not
 * (`authorization_class: "EXECUTABLE"`), and refusal of AR-1276C is therefore STRUCTURAL — it
 * fails because it is incomplete against the closed schema, not because this file recognises a
 * disclaimer sentence somewhere near it.
 *   `A VALIDATOR THAT READS PROSE CAN BE TALKED INTO THINGS.`
 *
 * ★ WHY THE FIELD SET IS CLOSED (`unknown_field` is a refusal).
 * An open schema lets a future marker carry `executable_path`, `settings_path` or `worktree_path`
 * and lets model-authored text choose what runs. AR-1276C §9 forbids exactly that. Refusing
 * unknown fields means such a smuggled key cannot be silently ignored — it is loud.
 *
 * ★ NOTHING HERE PERFORMS I/O. Every comparison is against values the caller MEASURED. That is
 * what makes the negative controls in scripts/control_plane_bootstrap.test.mjs real tests rather
 * than mocks of themselves.
 */

export const MARKER_SCHEMA = 'CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1';

export const EXPECTED_REPO = 'swayz032/trading-forge';
export const EXPECTED_ACTOR = 'top-level-control-plane-guard-repair';
export const EXPECTED_SOURCE_ACTOR = 'worker-1';
export const EXPECTED_EXECUTION = 'ONE_BOOTSTRAP_EXECUTION';
export const GPT_AUTHORITY_REF = 'refs/heads/external-advisor/gpt-rulings';

/**
 * The closed field set. A marker carrying anything not listed here is REFUSED, and a marker
 * missing anything listed here is REFUSED. There is no optional field on purpose: every one of
 * these is load-bearing for a privilege transition, and "optional" is where a default lives.
 */
export const MARKER_FIELDS = Object.freeze([
  'schema',
  'authorization_class',
  'authorization_id',
  'ruling_id',
  'actor',
  'execution',
  'source_actor',
  'target_packet',
  'repo',
  'frozen_queue_sha256',
  'require_ready',
  'require_spent',
  'require_receipts',
  'require_agent_model_executions_before_launch',
  'hands_free',
  'allowed_paths',
]);

/** Paths the control-plane seat may NEVER be authorized to touch, whatever a ruling says. */
export const CATEGORICAL_FORBIDDEN_PATH_TOKENS = Object.freeze([
  'isolated_fallback_queue_t1.json',
  'isolated-receipts-t1',
  'native_call_manifest_t1.json',
]);

const HEX64 = /^[0-9a-f]{64}$/;
// The optional trailing letter is not cosmetic: AR-1276, AR-1276A, AR-1276B and AR-1276C are four
// distinct rulings. A pattern that stops at the digits collapses them into one identity.
const PACKET = /^AR-\d{3,5}[A-Z]?$/;
const AUTH_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function refuse(code, detail) {
  return { ok: false, code, detail };
}

/**
 * Pull every candidate marker out of a ruling's markdown.
 *
 * Deliberately greedy: it returns AR-1276C's example too. Hiding the example from the validator
 * would make negative control #18 untestable, and a control that cannot see the thing it must
 * reject proves nothing. The refusal happens in validateAuthorization, where it is visible.
 */
export function extractCandidateMarkers(rulingText) {
  if (typeof rulingText !== 'string') return [];

  // 🛑 A LINE-STATE SCANNER, NOT A REGEX — AND THIS WAS MEASURED, NOT PREFERRED.
  // The first implementation used /```(?:json)?\s*\n([\s\S]*?)\n```/g. Against the REAL AR-1276C
  // (17,979 chars, 32 fences, only 1 of them ```json) it extracted ZERO markers: a ```text fence
  // cannot open a match, so the scanner resynchronised on that block's CLOSING fence, paired it
  // with the next block's OPENING fence, and from there every pairing was off by one — the json
  // block ended up counted as the *body* of a mis-paired block.
  //
  // The failure mode is the dangerous direction for a control: `no_marker` and "found it and
  // refused it" are the same observation from outside, so negative control #18 passed against the
  // live ruling while proving nothing. `A CONTROL THAT CANNOT SEE ITS TARGET REPORTS SUCCESS.`
  // Fences are a LINE construct in markdown, so they are read a line at a time.
  const out = [];
  const lines = rulingText.split(/\r?\n/);
  let inFence = false;
  let body = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        let parsed;
        try {
          parsed = JSON.parse(body.join('\n'));
        } catch {
          parsed = null; // a block that is not JSON is not a marker; it is prose in a box.
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.schema === MARKER_SCHEMA) {
          out.push(parsed);
        }
        inFence = false;
        body = [];
      } else {
        inFence = true;
        body = [];
      }
      continue;
    }
    if (inFence) body.push(line);
  }
  return out;
}

/**
 * @param marker   the candidate object
 * @param measured INDEPENDENTLY measured state — never taken from the marker:
 *   { rulingId, isNewestRuling, queueSha256, ready, spent, receiptsReadmeOnly,
 *     agentModelExecutions, claimedAuthorizationIds:Set<string> }
 */
export function validateAuthorization(marker, measured) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return refuse('not_an_object', 'authorization marker must be a JSON object');
  }

  // --- closed schema -------------------------------------------------------------------------
  if (marker.schema !== MARKER_SCHEMA) {
    return refuse('wrong_schema', `schema must be ${MARKER_SCHEMA}, got ${String(marker.schema)}`);
  }
  const unknown = Object.keys(marker).filter((k) => !MARKER_FIELDS.includes(k));
  if (unknown.length > 0) {
    return refuse('unknown_field', `unknown field(s) refused: ${unknown.join(', ')}`);
  }
  const missing = MARKER_FIELDS.filter((k) => !(k in marker));
  if (missing.length > 0) {
    // AR-1276C §7's example block lands HERE — it carries no authorization_class, no
    // authorization_id, no ruling_id, no repo and no allowed_paths.
    return refuse('missing_field', `missing required field(s): ${missing.join(', ')}`);
  }

  // --- the executable/example discriminator, checked before anything expensive ----------------
  if (marker.authorization_class !== 'EXECUTABLE') {
    return refuse(
      'not_executable',
      `authorization_class must be "EXECUTABLE", got ${JSON.stringify(marker.authorization_class)} — ` +
        'a schema example is not an authorization',
    );
  }

  // --- identity ------------------------------------------------------------------------------
  if (marker.actor !== EXPECTED_ACTOR) return refuse('wrong_actor', `actor must be ${EXPECTED_ACTOR}`);
  if (marker.source_actor !== EXPECTED_SOURCE_ACTOR) {
    return refuse('wrong_source_actor', `source_actor must be ${EXPECTED_SOURCE_ACTOR}`);
  }
  if (marker.execution !== EXPECTED_EXECUTION) {
    return refuse('wrong_execution', `execution must be ${EXPECTED_EXECUTION}`);
  }
  if (marker.repo !== EXPECTED_REPO) return refuse('wrong_repo', `repo must be ${EXPECTED_REPO}`);
  if (typeof marker.target_packet !== 'string' || !PACKET.test(marker.target_packet)) {
    return refuse('bad_target_packet', 'target_packet must look like AR-1278');
  }
  if (typeof marker.authorization_id !== 'string' || !AUTH_ID.test(marker.authorization_id)) {
    return refuse('bad_authorization_id', 'authorization_id must be 8-128 chars of [A-Za-z0-9._:-]');
  }

  // --- the marker is bound to the ruling that carried it --------------------------------------
  // Without this, a marker could be lifted out of a graded ruling and pasted into a later one.
  if (marker.ruling_id !== measured.rulingId) {
    return refuse(
      'ruling_id_mismatch',
      `marker claims ruling ${marker.ruling_id} but was found in ${measured.rulingId}`,
    );
  }
  if (measured.isNewestRuling !== true) {
    return refuse('stale_authority', 'the authorizing ruling is not the newest ruling on the GPT branch');
  }

  // --- frozen-state preconditions, compared against MEASURED values ---------------------------
  if (typeof marker.frozen_queue_sha256 !== 'string' || !HEX64.test(marker.frozen_queue_sha256)) {
    return refuse('bad_queue_sha_format', 'frozen_queue_sha256 must be 64 lowercase hex chars');
  }
  if (marker.frozen_queue_sha256 !== measured.queueSha256) {
    return refuse(
      'frozen_queue_sha_mismatch',
      `marker requires ${marker.frozen_queue_sha256}, measured ${measured.queueSha256}`,
    );
  }
  if (marker.require_ready !== 8 || measured.ready !== 8) {
    return refuse('ready_not_8', `require_ready=${marker.require_ready}, measured ready=${measured.ready}`);
  }
  if (marker.require_spent !== 0 || measured.spent !== 0) {
    return refuse('spent_not_0', `require_spent=${marker.require_spent}, measured spent=${measured.spent}`);
  }
  if (marker.require_receipts !== 'README_ONLY' || measured.receiptsReadmeOnly !== true) {
    return refuse('receipts_not_readme_only', 'the G2 receipt namespace is not README-only');
  }
  if (marker.require_agent_model_executions_before_launch !== 0 || measured.agentModelExecutions !== 0) {
    return refuse('agent_executions_not_0', 'Agent/subagent model executions before launch must be 0');
  }
  if (marker.hands_free !== true) {
    return refuse('hands_free_not_true', 'hands_free must be true — Tonio is never the permission pipeline');
  }

  // --- the protected-edit allowlist supplied by GPT authority ---------------------------------
  if (!Array.isArray(marker.allowed_paths) || marker.allowed_paths.length === 0) {
    return refuse('bad_allowed_paths', 'allowed_paths must be a non-empty array');
  }
  for (const p of marker.allowed_paths) {
    if (typeof p !== 'string' || p.length === 0) {
      return refuse('bad_allowed_paths', 'allowed_paths entries must be non-empty strings');
    }
    const norm = p.replaceAll('\\', '/');
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.split('/').includes('..')) {
      return refuse('escaping_allowed_path', `allowed_paths entry escapes the repository: ${p}`);
    }
    for (const token of CATEGORICAL_FORBIDDEN_PATH_TOKENS) {
      if (norm.toLowerCase().includes(token.toLowerCase())) {
        // No ruling may authorize this. The frozen plane is not a scope question.
        return refuse('forbidden_g2_path', `allowed_paths may never reference the frozen G2 plane: ${p}`);
      }
    }
  }

  // --- replay ---------------------------------------------------------------------------------
  const claimed = measured.claimedAuthorizationIds;
  const already = claimed instanceof Set ? claimed.has(marker.authorization_id) : Array.isArray(claimed) && claimed.includes(marker.authorization_id);
  if (already) {
    return refuse(
      'replayed_authorization',
      `authorization_id ${marker.authorization_id} has already been claimed — one authorization is one execution`,
    );
  }

  return { ok: true, marker };
}
