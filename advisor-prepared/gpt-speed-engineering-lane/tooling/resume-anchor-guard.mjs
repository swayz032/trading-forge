import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function verifyResumeAnchor({
  cwd = process.cwd(),
  expectedBranch,
  expectedHead,
  requireClean = true,
}) {
  if (!expectedBranch) throw new Error('expectedBranch is required');
  if (!expectedHead) throw new Error('expectedHead is required');

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
  if (requireClean && dirty) errors.push('worktree is dirty');

  return {
    branch,
    head,
    expected_head: resolvedExpected,
    clean: !dirty,
    require_clean: requireClean,
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
    const result = verifyResumeAnchor({
      expectedBranch: arg('--expected-branch'),
      expectedHead: arg('--expected-head'),
      requireClean: !process.argv.includes('--allow-dirty'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 3;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
