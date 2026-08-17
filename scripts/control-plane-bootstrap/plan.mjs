/**
 * AR-1277 §10 — THE DETERMINISTIC PLAN.
 *
 * A plan is the artifact that makes "authoring without executing" reviewable: GPT can read
 * exactly what WOULD happen, field by field, without anything happening. Every value here is
 * either measured by the caller or DERIVED mechanically from the validated marker.
 *
 * 🛑 NOTHING IN THIS FILE IS SUPPLIED BY MODEL TEXT. AR-1276C §9 forbids "no arbitrary
 * branch/worktree path supplied by model text", "no arbitrary settings/hook path", "no arbitrary
 * executable", "no arbitrary command passthrough". So the branch name, the worktree directory,
 * the settings path, the argv and the executable are all COMPUTED from `target_packet` and fixed
 * constants. There is deliberately no parameter by which a caller could name them.
 *   `IF A PRIVILEGED LAUNCHER TAKES A PATH ARGUMENT, THE PATH ARGUMENT IS THE PRIVILEGE.`
 *
 * ★ WHY cwd IS THE MECHANISM AND `--settings` IS NOT.
 * AR-1271A §4 measured that Claude Code resolves hook binding from the LAUNCH DIRECTORY, and
 * this repository's own Worker-1 seat is the standing proof: its guard binds from the worktree it
 * is launched in. That mechanism is EVIDENCED. Whether hooks supplied via `--settings` register
 * identically is NOT evidenced, and AR-1276C §8 forbids guessing — so the design does not depend
 * on it. The control-plane guard binds the same proven way: its own worktree, its own
 * `.claude/settings.json`, launched with that worktree as cwd.
 */

import { EXPECTED_ACTOR, EXPECTED_REPO, GPT_AUTHORITY_REF } from './authorization.mjs';

/** The one executable this package may ever launch. No caller may substitute it. */
export const LAUNCH_EXECUTABLE = 'claude';

/**
 * The one argv. `--dangerously-skip-permissions` is PRESERVED deliberately (AR-1276C §8: hands-free
 * remains required) and is safe here for the same measured reason the Worker-1 launcher documents:
 * PreToolUse hooks run BEFORE permission-mode logic and a hook `deny` short-circuits the resolver,
 * so this flag removes the OPERATOR prompt and not the GUARD.
 */
export const LAUNCH_ARGV = Object.freeze(['--dangerously-skip-permissions']);

export const CLAIM_DIR = 'docs/replay-results/control-plane-bootstrap/claims';

/** The G2 receipt namespace the claim directory must never collide with (AR-1276C §9). */
export const G2_RECEIPT_DIR = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';

export function deriveBranch(targetPacket) {
  return `control-plane/${targetPacket.toLowerCase()}-guard-repair`;
}

export function deriveWorktreeDirName(targetPacket) {
  return `wt-control-plane-${targetPacket.toLowerCase()}`;
}

/**
 * Proof, not assertion, that the replay-claim namespace is disjoint from the frozen G2 receipt
 * namespace. Called by buildPlan so a future edit that moves the claims under the G2 tree cannot
 * pass silently.
 */
export function assertClaimNamespaceDisjoint(claimDir = CLAIM_DIR, g2Dir = G2_RECEIPT_DIR) {
  const a = `${claimDir.replace(/\/+$/, '')}/`;
  const b = `${g2Dir.replace(/\/+$/, '')}/`;
  if (a.startsWith(b) || b.startsWith(a)) {
    throw new Error(`claim namespace ${claimDir} overlaps the frozen G2 receipt namespace ${g2Dir}`);
  }
  return true;
}

/**
 * @param marker   a marker that ALREADY passed validateAuthorization
 * @param measured { workerBranch, workerHead, repoParentDir, queueSha256, ready, spent,
 *                   receiptsReadmeOnly, gptAuthorityHead }
 */
export function buildPlan(marker, measured) {
  assertClaimNamespaceDisjoint();

  const branch = deriveBranch(marker.target_packet);
  const worktreeDir = deriveWorktreeDirName(marker.target_packet);
  const worktreePath = `${measured.repoParentDir}/${worktreeDir}`;

  return {
    schema: 'CONTROL_PLANE_BOOTSTRAP_PLAN_V1',

    repo_identity: EXPECTED_REPO,
    source_worker_branch: measured.workerBranch,
    source_worker_head: measured.workerHead,

    target_actor_class: EXPECTED_ACTOR,
    target_packet: marker.target_packet,

    proposed_target_branch: branch,
    proposed_target_worktree: worktreePath,

    settings_guard_template: {
      // Materialized INTO the new worktree. Never an edit of this worktree's own settings.
      settings_path: `${worktreePath}/.claude/settings.json`,
      hook_doorway: 'scripts/control-plane-bootstrap/control-plane-seat-hook.mjs',
      guard_module: 'scripts/control-plane-bootstrap/control-plane-guard.mjs',
      binding_mechanism: 'launch-directory cwd (AR-1271A §4 measured); --settings is NOT relied upon',
    },

    gpt_authority_branch: GPT_AUTHORITY_REF,
    gpt_authority_head: measured.gptAuthorityHead,
    authorizing_ruling: marker.ruling_id,
    authorization_id: marker.authorization_id,

    frozen_queue_sha256_required: marker.frozen_queue_sha256,
    frozen_queue_sha256_measured: measured.queueSha256,
    ready_required: marker.require_ready,
    ready_measured: measured.ready,
    spent_required: marker.require_spent,
    spent_measured: measured.spent,
    receipt_namespace_required: marker.require_receipts,
    receipt_namespace_measured: measured.receiptsReadmeOnly ? 'README_ONLY' : 'NOT_README_ONLY',

    authorized_paths: [...marker.allowed_paths],

    planned_process: {
      executable: LAUNCH_EXECUTABLE,
      argv: [...LAUNCH_ARGV],
      cwd: worktreePath,
      top_level: true,
      is_subagent: false,
    },

    // Ordered exactly as execution would perform them, so a reviewer can check the sequence and
    // not merely the set. The claim is written BEFORE the launch: a crash after spawning must not
    // leave the authorization reusable.
    planned_operations: [
      { step: 1, op: 'verify_gpt_authority', detail: `fetch ${GPT_AUTHORITY_REF}, confirm newest ruling carries this authorization_id` },
      { step: 2, op: 'verify_frozen_state', detail: 'queue sha256 + 8 READY + 0 SPENT + receipts README-only' },
      { step: 3, op: 'verify_no_replay', detail: `no claim exists at ${CLAIM_DIR}/${marker.authorization_id}.json` },
      { step: 4, op: 'create_branch', detail: `${branch} from ${measured.workerHead}` },
      { step: 5, op: 'create_worktree', detail: worktreePath },
      { step: 6, op: 'materialize_seat_guard', detail: `${worktreePath}/.claude/settings.json + control-plane manifest` },
      { step: 7, op: 'arm_witness', detail: 'run the seat hook directly with a synthetic payload; zero model calls' },
      { step: 8, op: 'write_claim', detail: `${CLAIM_DIR}/${marker.authorization_id}.json` },
      { step: 9, op: 'launch_seat', detail: `${LAUNCH_EXECUTABLE} ${LAUNCH_ARGV.join(' ')} (cwd=${worktreePath})` },
    ],

    executed: false,
    _note: 'AR-1277 authors this plan. Only a later GPT ruling carrying an EXECUTABLE marker may run it.',
  };
}
