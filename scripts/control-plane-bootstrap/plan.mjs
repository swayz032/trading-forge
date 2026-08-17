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
import { claimFileName, LEGACY_CLAIM_DIR } from './claim-store.mjs';

/** The one executable this package may ever launch. No caller may substitute it. */
export const LAUNCH_EXECUTABLE = 'claude';

/**
 * The one argv. `--dangerously-skip-permissions` is PRESERVED deliberately (AR-1276C §8: hands-free
 * remains required) and is safe here for the same measured reason the Worker-1 launcher documents:
 * PreToolUse hooks run BEFORE permission-mode logic and a hook `deny` short-circuits the resolver,
 * so this flag removes the OPERATOR prompt and not the GUARD.
 */
export const LAUNCH_ARGV = Object.freeze(['--dangerously-skip-permissions', '--setting-sources', 'user,project,local']);

/**
 * AR-1278A F-13 — HANDS-FREE MEANS THE MACHINE STARTS THE WORK, NOT JUST THE SEAT.
 *
 * Bare `claude` opens an interactive session, so the previous design could open a privileged seat
 * and then sit there waiting for a human to type the task. Tonio is not the prompt relay. The seat
 * is launched with `-p` and a prompt DERIVED MECHANICALLY from the validated marker — no model text,
 * no operator text, nothing a caller can choose. `-p` is still a top-level process, not a subagent.
 */
/**
 * AR-1290A §C — PHASE 1 ONLY. F-18 split the closeout into a privileged Phase 1 (this seat,
 * Agent/Task categorically denied) and an ordinary Phase 2 (a fresh Worker-1 seat, after GPT
 * grades Phase 1). This prompt must say so, and must give the seat a completable protocol: the
 * old five-step version told it to write a report into a directory the marker never authorized
 * (F-16) and finalize without ever being told how to create the fixed commit-message file the
 * finalizer requires (F-17). Every step below is either a fixed command or a path drawn from
 * `marker.allowed_paths` — nothing here is text the model chooses.
 */
/**
 * AR-1291A F20 — the ONE fixed path for the transient commit-message file. Exported (not a local
 * const inside buildPacketPrompt) so control-plane-guard.mjs can categorically refuse staging it
 * without hand-duplicating the literal string a second place it could drift out of sync.
 */
export const COMMIT_MSG_FILE_REL = 'scripts/control-plane-bootstrap/.cp-commit-msg.tmp';

export function buildPacketPrompt(marker) {
  const paths = marker.allowed_paths.map((p) => `  - ${p}`).join('\n');
  const reportDir = 'docs/replay-results/worker-advisor-reports/';
  const msgFile = COMMIT_MSG_FILE_REL;
  const transportCmd = 'python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py';
  return [
    `You are the top-level control-plane / guard-repair seat for packet ${marker.target_packet}, PHASE 1 ONLY.`,
    `Your authority is ruling ${marker.ruling_id} on origin/external-advisor/gpt-rulings, authorization ${marker.authorization_id}.`,
    '',
    'Do exactly this, in order, and nothing else:',
    `1. Read ${marker.ruling_id} from origin/external-advisor/gpt-rulings and re-verify the packet scope for yourself.`,
    '2. Make only the changes that ruling authorizes, only within these paths:',
    paths,
    `3. Run the fixed prompt-transport helper, exactly: ${transportCmd}`,
    '4. Run the bounded tests the ruling names.',
    `5. Write one closeout report for ${marker.target_packet} under ${reportDir} — this is the only report path you may write to.`,
    `6. Write the fixed commit message into ${msgFile} — this is the only commit-message path that exists for you.`,
    '7. Stage only the paths this authorization allows, one at a time, through: git add <path>',
    `   NEVER stage ${msgFile} itself — it is writable so you can create it, but it must never be`,
    '   staged; cp-finalize.mjs reads and deletes it directly. The guard refuses that stage attempt',
    '   categorically, whether or not it is named in allowed_paths.',
    '8. Finalize with exactly: node scripts/control-plane-bootstrap/cp-finalize.mjs',
    '9. Exit. Do not start a conversation, a question, or any further step after finalize returns.',
    '',
    'PHASE 2 IS NOT YOURS. The one cheap Agent traversal calibration and the remaining zero-model G2',
    'controls belong to a fresh, ordinary Worker-1 seat, launched only after GPT grades this Phase 1',
    'closeout. You are the privileged seat: Agent and Task are categorically denied to you for that',
    'exact reason, and running the live traversal calibration yourself would require weakening the',
    'boundary this packet exists to hold.',
    '',
    'Hard rules: never dispatch an Agent or subagent; never use PowerShell; never touch the frozen G2',
    'queue, receipts or native-call manifest; never ask the operator a question — he is not part of',
    'this loop. If you cannot proceed, write the reason into your report and finalize anyway.',
  ].join('\n');
}

export function buildLaunchArgv(marker) {
  return [...LAUNCH_ARGV, '-p', buildPacketPrompt(marker)];
}

/** Passed explicitly so the local source's loading is stated, not inherited from a default. */
export const SETTING_SOURCES = 'user,project,local';

/**
 * AR-1278 F-3 — the seat's guard is registered in the LOCAL settings source, and the manifest sits
 * beside it. Both are in `CATEGORICAL_FORBIDDEN_PATH_TOKENS`, so the seat cannot rewrite what
 * governs it, while the TRACKED `.claude/settings.json` stays freely repairable — which is the
 * whole point of the packet.
 */
export const SEAT_SETTINGS_REL = '.claude/settings.local.json';
export const SEAT_MANIFEST_REL = '.claude/control-plane-guard-manifest.json';

/**
 * LEGACY, immutable, forensic only (AR-1289A §3). Never written to by new authorizations — those go
 * through the shared git-common-dir store in claim-store.mjs. Re-exported here under its historical
 * name so existing importers (bootstrap.mjs, the test suite) are unaffected.
 */
export const CLAIM_DIR = LEGACY_CLAIM_DIR;

/** The G2 receipt namespace the claim directory must never collide with (AR-1276C §9). */
export const G2_RECEIPT_DIR = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1';

/**
 * AR-1289A §4 — ATTEMPT IDENTITY MUST INCLUDE THE AUTHORIZATION, NOT JUST THE PACKET.
 *
 * AR-1289's spent attempt left a `control-plane/ar-1278-guard-repair` branch and a
 * `wt-control-plane-ar-1278` worktree behind — both derived from `target_packet` ALONE. A fresh
 * authorization for the SAME packet would therefore collide with the failed attempt's names, and
 * the ruling forbids cleaning up the old one to make room. So both derivations now take the
 * authorization id too: same packet + same id -> byte-identical names (replay-safe); same packet +
 * different id -> different names (collision-safe); nothing here needs the old attempt deleted.
 *
 * 🛑 AR-1295 F23 — THE SEPARATOR MUST BE FLAT, NOT NESTED. Bootstrap authorization #2
 * (`cpb-2026-08-17-0002`) spent itself for nothing because this function used to join with `/`:
 * `control-plane/ar-1278-guard-repair/<auth-id>`. Authorization #1's preserved forensic branch is
 * `control-plane/ar-1278-guard-repair` — a ref Git will never let coexist with anything nested
 * beneath it (`refs/heads/X` and `refs/heads/X/Y` are mutually exclusive in Git's ref storage).
 * "Different id -> different name" was true and still let every future authorization for this
 * packet collide identically, because it never asked whether the new name was a SIBLING of the
 * old one or a CHILD of it. The fix is the separator, not another identity field: `-` makes every
 * derived branch a flat sibling under `control-plane/`, which was already established as a safe
 * "directory" prefix (no branch is ever named bare `control-plane`). See `branchNamespaceCollision`
 * below for the general, git-ref-shaped check this alone does not replace.
 */
export function deriveBranch(targetPacket, authorizationId) {
  return `control-plane/${targetPacket.toLowerCase()}-guard-repair-${authorizationId}`;
}

export function deriveWorktreeDirName(targetPacket, authorizationId) {
  return `wt-control-plane-${targetPacket.toLowerCase()}-${authorizationId}`;
}

/**
 * AR-1295 F24 — PRE-CLAIM BRANCH-REF-NAMESPACE AVAILABILITY, AS A PURE DECISION.
 *
 * Git's ref storage cannot hold a ref at `refs/heads/X` and a second ref at `refs/heads/X/Y`
 * simultaneously — one is a file, the other would need a directory at the same path. This is not
 * specific to the current flat naming (F23): ANY future branch-naming scheme collides with ANY
 * existing ref that is either an exact match, a slash-prefix ancestor of the target, or a
 * slash-prefix descendant of the target. `existingBranches` are branch names WITHOUT the
 * `refs/heads/` prefix, as MEASURED from the live repository — never taken from a claim file or
 * prompt text. `targetBranch` is the exact name `deriveBranch` would produce.
 *
 * No I/O. The caller measures; this only decides.
 */
export function branchNamespaceCollision(existingBranches, targetBranch) {
  for (const existing of existingBranches ?? []) {
    if (existing === targetBranch) return { collision: true, kind: 'exact_duplicate', with: existing };
    if (targetBranch.startsWith(`${existing}/`)) return { collision: true, kind: 'existing_is_ancestor', with: existing };
    if (existing.startsWith(`${targetBranch}/`)) return { collision: true, kind: 'target_is_ancestor', with: existing };
  }
  return { collision: false, kind: null, with: null };
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
 *                   receiptsReadmeOnly, gptAuthorityHead, gitCommonDirAbs }
 */
export function buildPlan(marker, measured) {
  assertClaimNamespaceDisjoint();

  // AR-1289A §4: identity is target_packet + authorization_id, so a fresh authorization for the
  // same packet never collides with a prior spent attempt's branch/worktree.
  const branch = deriveBranch(marker.target_packet, marker.authorization_id);
  const worktreeDir = deriveWorktreeDirName(marker.target_packet, marker.authorization_id);
  const worktreePath = `${measured.repoParentDir}/${worktreeDir}`;
  // AR-1289A §3: the claim lives in the shared Git common directory, not any working tree.
  const claimPath = `${measured.gitCommonDirAbs}/${claimFileName(marker.authorization_id)}`;

  return {
    schema: 'CONTROL_PLANE_BOOTSTRAP_PLAN_V1',

    repo_identity: EXPECTED_REPO,
    source_worker_branch: measured.workerBranch,
    source_worker_head: measured.workerHead,

    target_actor_class: EXPECTED_ACTOR,
    target_packet: marker.target_packet,

    proposed_target_branch: branch,
    proposed_target_worktree: worktreePath,

    // AR-1295 F24 — reported in BOTH --plan and --execute output (buildPlan runs before the mode
    // branch in bootstrap.mjs's run()), so branch-namespace availability is visible read-only,
    // without spending a claim to find out.
    branch_namespace_existing_refs: measured.existingControlPlaneBranches ?? [],
    branch_namespace_conflict: branchNamespaceCollision(measured.existingControlPlaneBranches ?? [], branch),

    settings_guard_template: {
      // Materialized INTO the new worktree, in the LOCAL source the seat may not write (F-3).
      settings_path: `${worktreePath}/${SEAT_SETTINGS_REL}`,
      manifest_path: `${worktreePath}/${SEAT_MANIFEST_REL}`,
      repairable_project_settings: `${worktreePath}/.claude/settings.json`,
      hook_doorway: 'scripts/control-plane-bootstrap/control-plane-seat-hook.mjs',
      guard_module: 'scripts/control-plane-bootstrap/control-plane-guard.mjs',
      binding_mechanism: 'launch-directory cwd (AR-1271A §4 measured), setting-sources user,project,local',
    },

    // AR-1289A §3 — outside every working tree, so the seat cannot reach it through Edit/Write.
    claim_store: {
      path: claimPath,
      git_common_dir: measured.gitCommonDirAbs,
      legacy_fallback_dir: LEGACY_CLAIM_DIR,
      _note: 'both bootstrap.mjs and the receiving seat independently derive this path from Git; nothing supplies it',
    },

    bootstrap_source_sha_required: marker.bootstrap_source_sha,
    bootstrap_source_sha_measured: measured.workerHead,
    bootstrap_bundle_sha256_required: marker.bootstrap_bundle_sha256,
    bootstrap_bundle_sha256_measured: measured.bootstrapBundleSha256,

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
      argv: buildLaunchArgv(marker),
      cwd: worktreePath,
      top_level: true,
      is_subagent: false,
      supervised: true,
      interactive: false,
      _note: 'launched with -p so the machine starts the work; the bootstrap waits for exit and verifies the completion receipt',
    },

    // Ordered exactly as execution performs them. AR-1278 F-4: every read-only check completes
    // FIRST, then the O_EXCL claim, and only then the first external mutation. A crash after the
    // claim leaves the authorization SPENT and needing a new GPT decision — deliberately, because a
    // reusable one-shot is not a one-shot.
    planned_operations: [
      { step: 1, op: 'verify_gpt_authority', detail: `fetch ${GPT_AUTHORITY_REF}, confirm newest ruling carries this authorization_id`, mutating: false },
      { step: 2, op: 'verify_frozen_state', detail: 'queue sha256 + 8 READY + 0 SPENT + receipts README-only', mutating: false },
      { step: 3, op: 'verify_bootstrap_identity', detail: 'worker HEAD equals pinned source sha; recomputed bundle equals pinned bundle', mutating: false },
      { step: 4, op: 'verify_no_replay', detail: `no claim for this id in the shared store (${claimPath}) or the legacy store (${LEGACY_CLAIM_DIR}/)`, mutating: false },
      // AR-1295 F24 — a deterministic Git ref-namespace collision must refuse HERE, before the
      // claim, or a foreseeable `git worktree add` failure spends a one-shot authorization for
      // nothing (exactly what happened to cpb-2026-08-17-0002).
      { step: 5, op: 'verify_branch_namespace_available', detail: `${branch} must not exact-match, nest under, or be nested under any existing refs/heads/control-plane/* ref`, mutating: false },
      { step: 6, op: 'write_claim', detail: `O_EXCL ${claimPath} — FIRST mutation`, mutating: true },
      { step: 7, op: 'create_branch_and_worktree', detail: `${branch} from ${measured.workerHead} at ${worktreePath}`, mutating: true },
      { step: 8, op: 'materialize_seat_guard', detail: `${SEAT_SETTINGS_REL} + ${SEAT_MANIFEST_REL} (immutable to the seat)`, mutating: true },
      // AR-1278A §1: `claude --init-only` runs Setup + SessionStart hooks and EXITS without a
      // conversation, so it proves Claude Code itself discovered and invoked the Local hook — which
      // a direct node call to the doorway can never show. Zero model calls.
      { step: 9, op: 'prove_doorway_init_only', detail: 'claude --init-only on the new worktree; require the durable armed receipt before any conversation', mutating: false },
      { step: 10, op: 'launch_seat_supervised', detail: `${LAUNCH_EXECUTABLE} -p <marker-derived packet prompt> (cwd=${worktreePath}); wait for exit`, mutating: true },
      { step: 11, op: 'verify_completion_receipt', detail: 'read the trusted completion receipt written by cp-finalize.mjs under the git dir', mutating: false },
    ],

    executed: false,
    _note: 'AR-1277 authors this plan. Only a later GPT ruling carrying an EXECUTABLE marker may run it.',
  };
}
