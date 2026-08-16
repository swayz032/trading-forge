import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Raw bytes, deliberately NOT decoded or trimmed: the diff hash must cover exactly what git
 *  emits, including trailing newlines and binary payloads. Trimming here would make two
 *  different working trees hash identically. */
function gitBytes(cwd, args) {
  return execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
}

const HEX64 = /^[0-9a-f]{64}$/;

function normalizeRepoPath(input) {
  return String(input).trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * The exact bytes of `git diff HEAD --binary -- <path>`, hashed.
 *
 * `--binary` matters: without it a binary change renders as the literal text
 * "Binary files ... differ", which is identical for two completely different contents.
 */
export function dirtyDiffSha256(cwd, repoPath) {
  return crypto.createHash('sha256').update(gitBytes(cwd, ['diff', 'HEAD', '--binary', '--', repoPath])).digest('hex');
}

/** Working-tree entries from `git status --porcelain -z`. `-z` because the v1 text format
 *  quotes and escapes paths containing spaces or non-ASCII, and a guard that mis-parses a
 *  path fails OPEN on exactly the filenames an attacker would choose. */
function dirtyEntries(cwd) {
  const parts = gitBytes(cwd, ['status', '--porcelain', '-z']).toString('utf8').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const record = parts[i];
    if (!record) continue;
    const x = record[0];
    const y = record[1];
    // Rename/copy records carry the ORIGIN path in the following NUL-separated field.
    if (x === 'R' || x === 'C') i += 1;
    entries.push({ x, y, path: normalizeRepoPath(record.slice(3)) });
  }
  return entries;
}

/**
 * AR-1265 §4 — the governed dirty-file exception.
 *
 * The desk's disposition for the one known dirty file is NOT `require_clean:false` and NOT a
 * sweep-commit. It is an exception pinned to an exact path AND the exact hash of that path's
 * diff, so the historical finding is preserved while any future edit hiding behind the same
 * filename still blocks SessionStart.
 *
 * `A PATH-ONLY EXCEPTION GOVERNS A NAME, NOT A CHANGE — AND THE NAME IS THE PART THAT DOES
 *  NOT MOVE.`
 */
function validateAllowedDirty(allowedDirty) {
  if (allowedDirty === undefined || allowedDirty === null) return [];
  if (!Array.isArray(allowedDirty)) throw new Error('allowed_dirty must be an array');
  return allowedDirty.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`allowed_dirty[${index}] must be an object`);
    const repoPath = normalizeRepoPath(raw.path ?? '');
    // Blanket exceptions are refused by construction: no globs, no directories, no empty path.
    if (repoPath === '') throw new Error(`allowed_dirty[${index}].path is required`);
    if (repoPath.includes('*') || repoPath.includes('?') || repoPath.endsWith('/')) {
      throw new Error(`allowed_dirty[${index}].path must name one exact file, not a pattern or directory: ${repoPath}`);
    }
    if (typeof raw.diff_sha256 !== 'string' || !HEX64.test(raw.diff_sha256)) {
      throw new Error(`allowed_dirty[${index}].diff_sha256 must be a 64-character lowercase sha256 of the exact diff bytes`);
    }
    if (typeof raw.authority !== 'string' || raw.authority.trim() === '') {
      throw new Error(`allowed_dirty[${index}].authority is required — an exception with no citation is a blanket exception`);
    }
    return { path: repoPath, diff_sha256: raw.diff_sha256, authority: raw.authority.trim() };
  });
}

function evaluateDirty(cwd, allowed) {
  const byPath = new Map(allowed.map((rule) => [rule.path, rule]));
  const errors = [];
  const accepted = [];

  for (const entry of dirtyEntries(cwd)) {
    // Untracked content is never covered by a diff hash — `git diff HEAD` cannot see it — so
    // it stays blocking unless separately and explicitly governed.
    if (entry.x === '?') {
      errors.push(`untracked path is not governed by any allowed_dirty exception: ${entry.path}`);
      continue;
    }
    const rule = byPath.get(entry.path);
    if (!rule) {
      errors.push(`worktree is dirty at an ungoverned path: ${entry.path}`);
      continue;
    }
    const actual = dirtyDiffSha256(cwd, entry.path);
    if (actual !== rule.diff_sha256) {
      errors.push(
        `allowed_dirty path ${entry.path} no longer matches its pinned diff: got ${actual}, pinned ${rule.diff_sha256} (authority ${rule.authority})`,
      );
      continue;
    }
    accepted.push({ path: entry.path, diff_sha256: actual, authority: rule.authority });
  }

  return { errors, accepted };
}

export function verifyResumeAnchor({
  cwd = process.cwd(),
  expectedBranch,
  expectedHead,
  requireClean = true,
  allowedDirty = [],
}) {
  if (!expectedBranch) throw new Error('expectedBranch is required');
  if (!expectedHead) throw new Error('expectedHead is required');

  const allowed = validateAllowedDirty(allowedDirty);
  if (!requireClean && allowed.length > 0) {
    // Otherwise the exception list reads as protection while `require_clean:false` already
    // allowed everything — a guard that looks narrower than it is.
    throw new Error('allowed_dirty is meaningless with require_clean:false; a blanket allow-dirty is not an exception');
  }

  const branch = git(cwd, ['branch', '--show-current']);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const resolvedExpected = git(cwd, ['rev-parse', `${expectedHead}^{commit}`]);
  const dirty = git(cwd, ['status', '--porcelain']).length > 0;
  const errors = [];

  if (branch !== expectedBranch) {
    errors.push(`branch mismatch: expected ${expectedBranch}, got ${branch || '(detached)'}`);
  }
  if (head !== resolvedExpected) {
    errors.push(`resume anchor moved: expected ${resolvedExpected}, got ${head}`);
  }

  let acceptedDirty = [];
  if (requireClean && dirty) {
    const verdict = evaluateDirty(cwd, allowed);
    acceptedDirty = verdict.accepted;
    // A tree dirty ONLY at governed paths whose diffs match their pins is not an error.
    // A listed path that is absent simply means the tree is cleaner than the exception.
    for (const error of verdict.errors) errors.push(error);
  }

  return {
    branch,
    head,
    expected_head: resolvedExpected,
    clean: !dirty,
    require_clean: requireClean,
    allowed_dirty: allowed,
    accepted_dirty: acceptedDirty,
    ok: errors.length === 0,
    errors,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    // `--diff-sha256 <path>` prints the pinnable hash for an allowed_dirty entry, so the value
    // in a manifest is COMPUTED from the tree rather than hand-copied.
    const target = arg('--diff-sha256');
    if (target) {
      process.stdout.write(`${dirtyDiffSha256(process.cwd(), normalizeRepoPath(target))}\n`);
    } else {
      const result = verifyResumeAnchor({
        expectedBranch: arg('--expected-branch'),
        expectedHead: arg('--expected-head'),
        requireClean: !process.argv.includes('--allow-dirty'),
        allowedDirty: arg('--allowed-dirty') ? JSON.parse(arg('--allowed-dirty')) : [],
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 3;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
