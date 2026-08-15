import { execFileSync } from 'node:child_process';

function git(cwd, args) { return execFileSync('git', args, { cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim(); }

export function inspectWorker({ cwd=process.cwd(), worker, expectedBranch, order }) {
  if (!/^worker-[12]$/.test(worker || '')) throw new Error('worker must be worker-1 or worker-2');
  if (!expectedBranch) throw new Error('expectedBranch is required');
  if (!order) throw new Error('order is required');
  const root = git(cwd, ['rev-parse','--show-toplevel']);
  const branch = git(cwd, ['branch','--show-current']);
  const head = git(cwd, ['rev-parse','HEAD']);
  const dirty = git(cwd, ['status','--porcelain']).length > 0;
  const errors = [];
  if (branch !== expectedBranch) errors.push(`branch mismatch: expected ${expectedBranch}, got ${branch || '(detached)'}`);
  if (dirty) errors.push('worktree is dirty');
  return { worker, order, root, branch, head, clean: !dirty, ok: errors.length === 0, errors };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i+1] : undefined; }
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = inspectWorker({ worker:arg('--worker'), expectedBranch:arg('--expected-branch'), order:arg('--order') });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 3;
  } catch (err) { console.error(err.message); process.exitCode = 2; }
}
