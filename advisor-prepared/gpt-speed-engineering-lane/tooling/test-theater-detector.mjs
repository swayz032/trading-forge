#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requireStringArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || x.length === 0)) throw new Error(`${name} must be an array of non-empty strings`);
  return value;
}

export function auditTestText({ text, critical = true, requiredImportTokens = [], forbiddenMockTokens = [], requireMutationEvidence = false, mutationEvidence = false }) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  requiredImportTokens = requireStringArray(requiredImportTokens, 'requiredImportTokens');
  forbiddenMockTokens = requireStringArray(forbiddenMockTokens, 'forbiddenMockTokens');

  const hardFailures = [];
  const reviewSignals = [];
  const skipTodo = [...text.matchAll(/\b(?:test|it|describe)\.(?:skip|todo)\s*\(/g)].map((m) => m[0]);
  if (critical && skipTodo.length > 0) hardFailures.push(`critical test contains ${skipTodo.length} skip/todo declaration(s)`);

  const missingImports = requiredImportTokens.filter((token) => !text.includes(token));
  if (missingImports.length > 0) reviewSignals.push(`required production import token(s) not visible: ${missingImports.join(', ')}`);

  const mockCalls = [...text.matchAll(/\b(?:vi|jest)\.mock\s*\(([^\n]*)/g)].map((m) => m[0]);
  for (const token of forbiddenMockTokens) {
    if (mockCalls.some((line) => line.includes(token))) hardFailures.push(`production dependency appears explicitly mocked: ${token}`);
  }

  if (requireMutationEvidence && mutationEvidence !== true) reviewSignals.push('required mutation/negative-control evidence was not supplied');

  const verdict = hardFailures.length > 0 ? 'BLOCK' : reviewSignals.length > 0 ? 'REVIEW_REQUIRED' : 'NO_STATIC_RISK_SIGNALS';
  return {
    schema: 'gpt-test-theater-detector-v1', verdict,
    ok: verdict === 'NO_STATIC_RISK_SIGNALS',
    hard_failures: hardFailures, review_signals: reviewSignals,
    observed: { skip_todo_count: skipTodo.length, mock_call_count: mockCalls.length },
    limitation: 'Static screening cannot prove a test reaches production behavior. NO_STATIC_RISK_SIGNALS still requires RED/GREEN, controls, and production-route review.',
  };
}

export function auditTestFile({ cwd = process.cwd(), testPath, ...options }) {
  if (!testPath || path.isAbsolute(testPath) || testPath.split(/[\\/]/).includes('..')) throw new Error('testPath must be a safe repository-relative path');
  const text = fs.readFileSync(path.join(cwd, testPath), 'utf8');
  return { test_path: testPath, ...auditTestText({ text, ...options }) };
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function main() {
  try {
    const input = arg('--input'); if (!input) throw new Error('--input config.json is required');
    const c = JSON.parse(fs.readFileSync(input, 'utf8'));
    const r = auditTestFile({ cwd: arg('--repo') || process.cwd(), testPath: c.test_path, critical: c.critical !== false, requiredImportTokens: c.required_import_tokens, forbiddenMockTokens: c.forbidden_mock_tokens, requireMutationEvidence: c.require_mutation_evidence === true, mutationEvidence: c.mutation_evidence === true });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); if (!r.ok) process.exitCode = 3;
  } catch (error) { process.stderr.write(`test-theater-detector: ${error.message}\n`); process.exitCode = 2; }
}
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
