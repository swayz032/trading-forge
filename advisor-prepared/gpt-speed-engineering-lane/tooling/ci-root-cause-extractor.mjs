#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function redact(line) {
  return line
    .replace(/(authorization:\s*bearer\s+)[^\s]+/ig, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s]+/ig, '$1[REDACTED]');
}

function isSignal(line) {
  return /\b(error|failed|failure|exception|fatal|panic|assert(?:ion)?|unhandled rejection|not ok)\b/i.test(line);
}

export function extractCiRootCause(logText, { context = 2, maxBlocks = 5 } = {}) {
  if (typeof logText !== 'string') throw new Error('logText must be a string');
  if (!Number.isInteger(context) || context < 0 || context > 10) throw new Error('context must be an integer from 0 to 10');
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 20) throw new Error('maxBlocks must be an integer from 1 to 20');

  const lines = logText.split(/\r?\n/).map(redact);
  const indices = [];
  for (let i = 0; i < lines.length; i += 1) if (isSignal(lines[i])) indices.push(i);

  const seen = new Set();
  const blocks = [];
  for (const index of indices) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const excerpt = lines.slice(start, end).join('\n').trim();
    if (!excerpt || seen.has(excerpt)) continue;
    seen.add(excerpt);
    blocks.push({ first_signal_line: index + 1, excerpt });
    if (blocks.length >= maxBlocks) break;
  }

  return {
    schema: 'gpt-ci-root-cause-extractor-v1',
    status: blocks.length > 0 ? 'SIGNALS_FOUND' : 'NO_ROOT_CAUSE_SIGNAL_FOUND',
    blocks,
    total_signal_lines: indices.length,
    truncated: blocks.length < indices.length,
    limitation: 'This extractor reduces log noise only. It cannot declare CI green, waive failures, or replace inspection of the complete failing job when context is insufficient.',
  };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function main() {
  try {
    const input = arg('--input'); if (!input) throw new Error('--input log.txt is required');
    const result = extractCiRootCause(fs.readFileSync(input, 'utf8'), { context: Number(arg('--context') ?? 2), maxBlocks: Number(arg('--max-blocks') ?? 5) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'SIGNALS_FOUND') process.exitCode = 3;
  } catch (error) { process.stderr.write(`ci-root-cause-extractor: ${error.message}\n`); process.exitCode = 2; }
}
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
