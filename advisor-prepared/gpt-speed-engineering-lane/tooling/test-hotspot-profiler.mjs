#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows must be a non-empty array');
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`row ${index} must be an object`);
    if (typeof row.name !== 'string' || row.name.trim() === '') throw new Error(`row ${index} name must be non-empty`);
    if (typeof row.duration_ms !== 'number' || !Number.isFinite(row.duration_ms) || row.duration_ms < 0) throw new Error(`row ${index} duration_ms must be a finite non-negative number`);
    return { name: row.name.trim(), duration_ms: row.duration_ms, status: row.status ?? null };
  });
}

export function profileTestHotspots(rows, { top = 20 } = {}) {
  rows = normalizeRows(rows);
  if (!Number.isInteger(top) || top < 1 || top > 200) throw new Error('top must be an integer from 1 to 200');
  const total = rows.reduce((sum, row) => sum + row.duration_ms, 0);
  const sorted = [...rows].sort((a, b) => b.duration_ms - a.duration_ms || a.name.localeCompare(b.name));
  let cumulative = 0;
  const hotspots = sorted.slice(0, top).map((row) => {
    cumulative += row.duration_ms;
    return {
      ...row,
      share_pct: total === 0 ? 0 : Number(((row.duration_ms / total) * 100).toFixed(2)),
      cumulative_pct: total === 0 ? 0 : Number(((cumulative / total) * 100).toFixed(2)),
    };
  });
  return {
    schema: 'gpt-test-hotspot-profile-v1',
    total_tests: rows.length,
    total_duration_ms: total,
    hotspots,
    note: 'Timing evidence identifies optimization candidates only. It does not authorize skipping, weakening, or reordering correctness coverage.',
  };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function main() {
  try {
    const input = arg('--input'); if (!input) throw new Error('--input timings.json is required');
    const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
    const result = profileTestHotspots(rows, { top: Number(arg('--top') ?? 20) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`test-hotspot-profiler: ${error.message}\n`); process.exitCode = 2; }
}
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
