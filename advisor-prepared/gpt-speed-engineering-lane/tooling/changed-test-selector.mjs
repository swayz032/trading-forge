import fs from 'node:fs';
import path from 'node:path';

const CODE_EXT = /\.(?:ts|tsx|js|mjs|cjs|py)$/i;

function norm(p) {
  const v = String(p).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!v || v.startsWith('/') || v.split('/').includes('..')) throw new Error(`unsafe path: ${p}`);
  return v;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'coverage') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function packageHasScript(repoRoot, name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return Boolean(pkg?.scripts?.[name]);
  } catch { return false; }
}

function relatedVitest(repoRoot, changed) {
  const stems = new Set(changed.filter(f => /\.(?:ts|tsx|js|mjs|cjs)$/i.test(f)).map(f => path.basename(f).replace(/\.(?:ts|tsx|js|mjs|cjs)$/i, '').replace(/\.(?:test|spec)$/i, '')));
  if (!stems.size) return [];
  return walk(path.join(repoRoot, 'src'))
    .map(abs => path.relative(repoRoot, abs).replaceAll('\\', '/'))
    .filter(rel => /(?:__tests__\/.*|\.(?:test|spec))\.(?:ts|tsx|js|mjs|cjs)$/i.test(rel))
    .filter(rel => {
      const base = path.basename(rel).replace(/\.(?:ts|tsx|js|mjs|cjs)$/i, '').replace(/\.(?:test|spec)$/i, '');
      return stems.has(base);
    })
    .sort();
}

export function classifyChangedFiles(files, { repoRoot = process.cwd() } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('at least one changed file is required');
  const changed = [...new Set(files.map(norm))].sort();
  const commands = new Set();
  const reasons = [];
  let full = false;
  let production = false;
  let ts = false;
  let python = false;
  let scripts = false;

  for (const f of changed) {
    if (f.startsWith('advisor-prepared/') || f.startsWith('advisor-reports/') || f.startsWith('docs/') || /\.(?:md|txt)$/i.test(f)) continue;
    if (!CODE_EXT.test(f) && !f.startsWith('.github/') && !f.startsWith('ci/') && !/^package(?:-lock)?\.json$/.test(f) && !f.startsWith('migrations/')) {
      full = true; reasons.push(`unclassified non-doc path: ${f}`); continue;
    }
    production = true;
    if (f.startsWith('src/engine/')) python = true;
    if (f.startsWith('src/') && /\.(?:ts|tsx|js|mjs|cjs)$/i.test(f)) ts = true;
    if (f.startsWith('scripts/') || f.startsWith('ci/')) scripts = true;
    if (f.startsWith('.github/') || f.startsWith('ci/') || /^package(?:-lock)?\.json$/.test(f) || f.startsWith('migrations/') || f === 'src/server/db/schema.ts') {
      full = true; reasons.push(`high-blast-radius path: ${f}`);
    }
  }

  if (!production) return { changed_files: changed, mode: 'docs-only', requires_full_ci: false, commands: [], reasons: ['no production-code path changed'] };

  if (python) {
    const tests = changed.filter(f => f.startsWith('src/engine/') && /(?:test_.*\.py|.*_test\.py)$/i.test(path.basename(f)));
    if (tests.length) commands.add(`python -m pytest ${tests.join(' ')} -q --tb=short`);
    else { commands.add('python -m pytest src/engine/ -q --tb=short'); reasons.push('python production change: conservative engine fallback'); }
  }

  if (ts) {
    const direct = relatedVitest(repoRoot, changed);
    commands.add('npx tsc --noEmit');
    if (direct.length) commands.add(`npx vitest run ${direct.join(' ')}`);
    else { commands.add('npm run test:full-fleet'); reasons.push('no direct Vitest basename match: full-fleet fallback'); }
  }

  if (scripts) {
    if (packageHasScript(repoRoot, 'test:scripts')) commands.add('npm run test:scripts');
    else { commands.add('npm run test:full-fleet'); reasons.push('test:scripts unavailable: full-fleet fallback'); }
  }

  if (full) {
    commands.add('npx tsc --noEmit');
    commands.add('npm run test:full-fleet');
  }

  return { changed_files: changed, mode: full ? 'full-gate-required' : 'focused-safe', requires_full_ci: full, commands: [...commands], reasons: [...new Set(reasons)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const files = process.argv.slice(2);
    console.log(JSON.stringify(classifyChangedFiles(files), null, 2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
