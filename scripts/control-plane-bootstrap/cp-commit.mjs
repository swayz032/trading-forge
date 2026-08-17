#!/usr/bin/env node
/**
 * THE CONTROL-PLANE SEAT'S ONLY COMMIT PATH — AR-1278 F-2.
 *
 * The seat's Bash policy is default-deny with a closed set of exact shapes, and no shape permits
 * redirection, chaining or arbitrary passthrough. That makes a compliant commit impossible without
 * a helper, because the required co-author trailer contains `<...>` and `git commit -m` with it is
 * refused by the guarded Bash fence.
 *
 * WHAT IT DOES NOT DO, DELIBERATELY:
 *   - it STAGES NOTHING. Staging goes through `git add <path>`, which the guard classifies against
 *     the GPT-authorized allowlist. If this helper staged files, it would be a second writer that
 *     bypasses that boundary — exactly the class of hole F-2 was.
 *   - it takes NO arbitrary path. The message file is a FIXED location, matched literally by the
 *     one allowed Bash shape, so the command line carries no attacker-chosen argument.
 *
 * `A HELPER THAT ACCEPTS A PATH REINTRODUCES THE BOUNDARY IT WAS BUILT TO RESPECT.`
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FIXED_MSG_FILE = 'scripts/control-plane-bootstrap/.cp-commit-msg.tmp';

const i = process.argv.indexOf('--msg-file');
const supplied = i >= 0 ? process.argv[i + 1] : null;
if (supplied !== FIXED_MSG_FILE) {
  console.error(`refused: --msg-file must be exactly ${FIXED_MSG_FILE} (got ${supplied})`);
  process.exit(2);
}

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const msgPath = path.join(repoRoot, FIXED_MSG_FILE);
if (!fs.existsSync(msgPath)) {
  console.error(`refused: ${FIXED_MSG_FILE} does not exist`);
  process.exit(2);
}

// The message is moved into the git directory, which is not part of the working tree, so no
// untracked scratch file can survive to block the next SessionStart. Same pattern as
// scripts/worker-commit.mjs (AR-1274 §8), which is the proven shape in this repo.
const gitDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const scratch = path.join(gitDir, 'CP_COMMIT_MSG');

let code = 0;
try {
  fs.writeFileSync(scratch, fs.readFileSync(msgPath, 'utf8'), 'utf8');
  fs.rmSync(msgPath, { force: true });
  execFileSync('git', ['-C', repoRoot, 'commit', '-F', scratch], { stdio: 'inherit' });
} catch (error) {
  console.error(`commit failed: ${error.message}`);
  code = 1;
} finally {
  fs.rmSync(scratch, { force: true });
}
process.exit(code);
