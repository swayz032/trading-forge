#!/usr/bin/env node
/**
 * GUARD-RESPECTING COMMIT HELPER — AR-1274 §8 (bounded; explicitly NOT a shell parser).
 *
 * THE PROBLEM, MEASURED
 *   Guarded Bash refuses command text containing redirect-like `<` / `>`. The required
 *   co-author trailer is `Co-Authored-By: … <noreply@anthropic.com>`, so `git commit -m` with a
 *   compliant trailer is unconditionally refused:
 *
 *     $ git commit -m "… Co-Authored-By: … <noreply@anthropic.com>"
 *     file-output redirection through Bash is blocked in guarded worker sessions
 *
 *   `git commit -F <file>` avoids it, but the message file then sits UNTRACKED in the worktree,
 *   and the resume anchor treats untracked files as blocking ("cannot be laundered by listing
 *   them"). Bash has no guard-respecting delete primitive, so the scratch file would brick the
 *   next SessionStart. AR-1274 §8 authorizes exactly this helper as the way out.
 *
 * WHAT IT DOES
 *   Moves the message into the worktree's own git directory — which is NOT part of the working
 *   tree, so it can never appear as an untracked file — commits with `-F`, and removes both the
 *   source and the scratch copy in a `finally`, so a failed commit leaves no residue either.
 *
 * WHAT IT IS NOT
 *   Not a shell parser, not a commit-message generator, and not a way around any boundary: it
 *   stages nothing and adds nothing. Paths are staged by the caller with explicit `git add`, so
 *   the governed dirty-file exception cannot be swept in by accident.
 *
 * Usage:
 *   node scripts/worker-commit.mjs --msg-file scripts/.worker-commit-msg.tmp
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const msgFile = arg('--msg-file');
if (!msgFile) {
  console.error('usage: node scripts/worker-commit.mjs --msg-file <path>');
  process.exit(2);
}
if (!fs.existsSync(msgFile)) {
  console.error(`message file not found: ${msgFile}`);
  process.exit(2);
}

const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const scratch = path.join(gitDir, 'WORKER_COMMIT_MSG');

let code = 0;
try {
  fs.writeFileSync(scratch, fs.readFileSync(msgFile, 'utf8'), 'utf8');
  // Remove the in-worktree source immediately: from here on nothing untracked exists, even if
  // the commit itself fails.
  fs.rmSync(msgFile, { force: true });

  const out = execFileSync('git', ['commit', '-F', scratch], { encoding: 'utf8' });
  process.stdout.write(out);
} catch (error) {
  process.stderr.write(String(error.stdout || '') + String(error.stderr || error.message || error) + '\n');
  code = 1;
} finally {
  fs.rmSync(scratch, { force: true });
  fs.rmSync(msgFile, { force: true });
}
process.exit(code);
