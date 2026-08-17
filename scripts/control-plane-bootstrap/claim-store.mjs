/**
 * AR-1289A §3 — THE SHARED CLAIM STORE.
 *
 * AR-1289 found the defect: the claim was written as an untracked file in the SOURCE worktree, but
 * the receiving seat reads its claim from ITS OWN `git rev-parse --show-toplevel` — a fresh
 * `git worktree add` checkout, which can only ever contain committed bytes at the ref it was cut
 * from. An uncommitted file in a sibling worktree is structurally invisible to it. Repeating the
 * claim would not fix this; the storage location was wrong.
 *
 * GPT selected option (c): put the claim in the Git COMMON directory, not any working tree. Every
 * worktree of one repository shares exactly one common directory (`git rev-parse --git-common-dir`
 * resolves to the same physical folder from any of them), so a file written there by the bootstrap
 * (running in the source worktree) is immediately visible to the seat (running in a brand-new
 * sibling worktree) with no commit, no checkout, and no channel through the marker/manifest/model
 * prompt/env — both sides independently derive the SAME path from Git itself.
 *
 * 🛑 THE FIRST MUTATION MUST STILL BE THE CLAIM. The common directory already exists — git created
 * it — so writing into it is exactly one `wx`/O_EXCL act, same as the legacy design. No `mkdir`
 * before it; that would reintroduce AR-1278A F-10's window.
 *
 * 🛑 THE LEGACY STORE IS IMMUTABLE FOREVER, NOT REPLACED. `cpb-2026-08-17-0001.json` is committed
 * history. A repository worktree cut from a commit at or after that point will legitimately see it
 * in its own checkout — that is ordinary git, not a bug — and this module must keep recognising it,
 * or a storage-mechanism change would silently un-spend a spent authorization (C4).
 */

import fsReal from 'node:fs';
import pathReal from 'node:path';

/**
 * The sole owner of this path. `plan.mjs` re-exports it as `CLAIM_DIR` for backward compatibility
 * with existing importers — a one-directional dependency (plan.mjs -> claim-store.mjs), not a
 * cycle: claim-store.mjs needs nothing from plan.mjs.
 */
export const LEGACY_CLAIM_DIR = 'docs/replay-results/control-plane-bootstrap/claims';

export const CLAIM_FILE_PREFIX = 'tf-control-plane-claim-';
export const CLAIM_FILE_SUFFIX = '.json';

export function claimFileName(authorizationId) {
  return `${CLAIM_FILE_PREFIX}${authorizationId}${CLAIM_FILE_SUFFIX}`;
}

/** The inverse of claimFileName. Returns null for anything not shaped like a claim file. */
export function authorizationIdFromClaimFileName(filename) {
  if (typeof filename !== 'string') return null;
  if (!filename.startsWith(CLAIM_FILE_PREFIX) || !filename.endsWith(CLAIM_FILE_SUFFIX)) return null;
  const id = filename.slice(CLAIM_FILE_PREFIX.length, filename.length - CLAIM_FILE_SUFFIX.length);
  return id.length > 0 ? id : null;
}

const ABS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/**
 * Pure. `git rev-parse --git-common-dir` may return a path RELATIVE to the cwd it was invoked
 * from (a worktree typically sees something like `../../.git`), so it is resolved against that
 * SAME cwd, then canonicalized. `realpath` is injected so a symlink or case difference cannot make
 * two worktrees of one repository disagree about what is, physically, one directory.
 */
export function resolveGitCommonDirAbs(rawGitCommonDir, cwd, realpath) {
  const joined = ABS_PATH.test(rawGitCommonDir) ? rawGitCommonDir : pathReal.join(cwd, rawGitCommonDir);
  return realpath(joined).replaceAll('\\', '/');
}

/** @param io { git(...args)=>string bound to a fixed cwd, cwd:string, realpath(p)=>string } */
export function gitCommonDirAbs(io) {
  return resolveGitCommonDirAbs(io.git('rev-parse', '--git-common-dir'), io.cwd, io.realpath);
}

export function claimStorePathAbs(gitCommonDirAbs_, authorizationId) {
  return `${gitCommonDirAbs_.replace(/\/+$/, '')}/${claimFileName(authorizationId)}`;
}

/* ------------------------------------------------------------ pure enumeration ----------------- */

export function listNewStoreClaimedIds(filenames) {
  return filenames.map(authorizationIdFromClaimFileName).filter((id) => id !== null);
}

export function listLegacyClaimedIds(filenames) {
  return filenames.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

/** C4 — an id claimed in EITHER store is spent. The only function ever asked "is this id claimed". */
export function unionClaimedIds(newStoreFilenames, legacyFilenames) {
  return new Set([...listNewStoreClaimedIds(newStoreFilenames), ...listLegacyClaimedIds(legacyFilenames)]);
}

/** Pure claim-body selection: new store wins if (impossibly) both somehow describe the same id. */
export function selectClaim(newStoreBody, legacyBody) {
  return newStoreBody ?? legacyBody ?? null;
}

/* ------------------------------------------------------------ real IO ------------------------- */

/**
 * THE FIRST MUTATION, and it remains a single atomic act. No directory is created here — the git
 * common directory pre-exists by construction (git itself made it), matching the legacy design's
 * committed-parent invariant one level up.
 */
export function writeClaimExclusive(gitCommonDirAbs_, authorizationId, body) {
  if (!fsReal.existsSync(gitCommonDirAbs_)) {
    throw new Error(`git common directory ${gitCommonDirAbs_} does not exist; refusing to write a claim there`);
  }
  const target = claimStorePathAbs(gitCommonDirAbs_, authorizationId);
  fsReal.writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
  return target;
}

export function readClaimFromNewStore(gitCommonDirAbs_, authorizationId) {
  try {
    return JSON.parse(fsReal.readFileSync(claimStorePathAbs(gitCommonDirAbs_, authorizationId), 'utf8'));
  } catch {
    return null;
  }
}

export function readLegacyClaim(repoRoot, authorizationId) {
  try {
    return JSON.parse(fsReal.readFileSync(pathReal.join(repoRoot, LEGACY_CLAIM_DIR, `${authorizationId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** C4 — the claim describing this id, checking the new store first, then the immutable legacy one. */
export function readClaimEitherStoreReal(gitCommonDirAbs_, repoRoot, authorizationId) {
  return selectClaim(
    readClaimFromNewStore(gitCommonDirAbs_, authorizationId),
    readLegacyClaim(repoRoot, authorizationId),
  );
}

export function listNewStoreFilenamesReal(gitCommonDirAbs_) {
  try {
    return fsReal.readdirSync(gitCommonDirAbs_);
  } catch {
    return [];
  }
}
