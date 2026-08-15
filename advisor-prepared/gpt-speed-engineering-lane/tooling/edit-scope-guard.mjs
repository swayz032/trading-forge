import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function validateRepoPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`${label} contains unsafe path syntax: ${value}`);
  }
}

export function evaluateScope({ changedPaths, allowedExact = [], allowedPrefixes = [] }) {
  if (!Array.isArray(changedPaths)) throw new Error('changedPaths must be an array');
  if (!Array.isArray(allowedExact) || !Array.isArray(allowedPrefixes)) throw new Error('scope rules must be arrays');
  if (allowedExact.length === 0 && allowedPrefixes.length === 0) throw new Error('at least one explicit scope rule is required');

  for (const p of allowedExact) validateRepoPath(p, 'allowedExact');
  for (const p of allowedPrefixes) {
    validateRepoPath(p, 'allowedPrefixes');
    if (!p.endsWith('/')) throw new Error(`allowedPrefixes entries must end with '/': ${p}`);
  }

  const outOfScope = [];
  for (const p of changedPaths) {
    validateRepoPath(p, 'changed path');
    const exact = allowedExact.includes(p);
    const prefix = allowedPrefixes.some((x) => p.startsWith(x));
    if (!exact && !prefix) outOfScope.push(p);
  }

  return {
    ok: outOfScope.length === 0,
    changed_paths: [...changedPaths].sort(),
    out_of_scope: outOfScope.sort(),
    allowed_exact: [...allowedExact].sort(),
    allowed_prefixes: [...allowedPrefixes].sort(),
  };
}

export function inspectDiffScope({ cwd = process.cwd(), base, head = 'HEAD', scope }) {
  if (!base) throw new Error('base is required');
  const raw = git(cwd, ['diff', '--name-only', `${base}..${head}`]);
  const changedPaths = raw ? raw.split('\n').filter(Boolean) : [];
  return evaluateScope({
    changedPaths,
    allowedExact: scope.allowed_exact || [],
    allowedPrefixes: scope.allowed_prefixes || [],
  });
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const scopeFile = arg('--scope-file');
    if (!scopeFile) throw new Error('--scope-file is required');
    const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    const result = inspectDiffScope({ base: arg('--base'), head: arg('--head') || 'HEAD', scope });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 3;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
