#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function secondsBetween(start, end, label) {
  const a = Date.parse(start ?? '');
  const b = Date.parse(end ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
    throw new Error(`invalid timing for ${label}`);
  }
  return Math.round((b - a) / 1000);
}

export function summarizeJobs(payload) {
  const jobs = Array.isArray(payload) ? payload : payload?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('jobs payload must contain at least one job');
  }

  return jobs.map((job) => {
    const jobSeconds = secondsBetween(job.started_at, job.completed_at, `job:${job.name ?? job.id}`);
    const steps = (job.steps ?? []).map((step) => ({
      name: step.name,
      conclusion: step.conclusion ?? null,
      seconds: secondsBetween(step.started_at, step.completed_at, `step:${step.name}`),
    }));
    return {
      id: job.id ?? null,
      name: job.name ?? null,
      conclusion: job.conclusion ?? null,
      seconds: jobSeconds,
      steps,
    };
  });
}

export function compareBudgets(summary, budgets) {
  if (!budgets || typeof budgets !== 'object') throw new Error('budgets must be an object');
  const warnings = [];
  for (const job of summary) {
    const budget = budgets.jobs?.[job.name];
    if (Number.isFinite(budget) && job.seconds > budget) {
      warnings.push({ type: 'job', name: job.name, actual_seconds: job.seconds, budget_seconds: budget });
    }
    for (const step of job.steps) {
      const key = `${job.name}::${step.name}`;
      const stepBudget = budgets.steps?.[key];
      if (Number.isFinite(stepBudget) && step.seconds > stepBudget) {
        warnings.push({ type: 'step', name: key, actual_seconds: step.seconds, budget_seconds: stepBudget });
      }
    }
  }
  return warnings;
}

async function loadPayload(args) {
  const inputIndex = args.indexOf('--input');
  if (inputIndex >= 0) {
    const path = args[inputIndex + 1];
    if (!path) fail('--input requires a path');
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  const runIndex = args.indexOf('--run-id');
  const repoIndex = args.indexOf('--repo');
  const runId = runIndex >= 0 ? args[runIndex + 1] : process.env.GITHUB_RUN_ID;
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!runId || !repo || !token) {
    fail('provide --input, or provide repo/run-id plus GITHUB_TOKEN');
  }
  const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) fail(`GitHub jobs API failed: ${res.status}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const budgetIndex = args.indexOf('--budgets');
  const outputIndex = args.indexOf('--output');
  const payload = await loadPayload(args);
  let summary;
  try {
    summary = summarizeJobs(payload);
  } catch (err) {
    fail(err.message);
  }

  let warnings = [];
  if (budgetIndex >= 0) {
    const path = args[budgetIndex + 1];
    if (!path) fail('--budgets requires a path');
    try {
      const budgets = JSON.parse(fs.readFileSync(path, 'utf8'));
      warnings = compareBudgets(summary, budgets);
    } catch (err) {
      fail(err.message);
    }
  }

  const result = {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    strict,
    over_budget: warnings.length > 0,
    warnings,
    jobs: summary,
  };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (outputIndex >= 0) {
    const path = args[outputIndex + 1];
    if (!path) fail('--output requires a path');
    fs.writeFileSync(path, text);
  }
  process.stdout.write(text);
  if (strict && warnings.length > 0) process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => fail(err?.stack ?? String(err)));
}
