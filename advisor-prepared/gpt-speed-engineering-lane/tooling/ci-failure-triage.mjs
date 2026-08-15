import fs from 'node:fs';

const TERMINAL_SUCCESS = new Set(['success', 'neutral', 'skipped']);
const INCOMPLETE = new Set([null, undefined, '', 'queued', 'in_progress', 'pending', 'requested', 'waiting']);

export function triageJobs(payload) {
  const jobs = Array.isArray(payload) ? payload : payload?.jobs;
  if (!Array.isArray(jobs)) throw new Error('payload must contain a jobs array');

  const failures = [];
  const incomplete = [];

  for (const job of jobs) {
    if (!job || typeof job.name !== 'string') throw new Error('every job must have a name');
    const conclusion = job.conclusion ?? null;
    const status = job.status ?? null;

    if (INCOMPLETE.has(conclusion) && status !== 'completed') {
      incomplete.push({ job: job.name, status, conclusion });
      continue;
    }

    if (!TERMINAL_SUCCESS.has(conclusion)) {
      const badSteps = Array.isArray(job.steps)
        ? job.steps
            .filter((s) => !TERMINAL_SUCCESS.has(s?.conclusion) && !INCOMPLETE.has(s?.conclusion))
            .map((s) => ({ name: s.name, conclusion: s.conclusion, number: s.number }))
        : [];
      failures.push({
        job: job.name,
        conclusion,
        failed_steps: badSteps,
        no_failed_step_exposed: badSteps.length === 0,
      });
    }
  }

  let state = 'GREEN';
  if (failures.length > 0) state = 'FAILED';
  else if (incomplete.length > 0) state = 'INCOMPLETE';

  return {
    state,
    ok: state === 'GREEN',
    job_count: jobs.length,
    failures,
    incomplete,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const input = arg('--input');
    if (!input) throw new Error('--input is required');
    const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
    const result = triageJobs(payload);
    console.log(JSON.stringify(result, null, 2));
    if (result.state === 'FAILED') process.exitCode = 3;
    if (result.state === 'INCOMPLETE') process.exitCode = 4;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
