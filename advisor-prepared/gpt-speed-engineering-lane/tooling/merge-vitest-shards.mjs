import fs from 'node:fs';

function validate(report, label='report') {
  if (!report || !Array.isArray(report.testResults)) throw new Error(`${label}: testResults missing`);
  for (const file of report.testResults) if (!Array.isArray(file?.assertionResults)) throw new Error(`${label}: assertionResults missing`);
}

export function mergeVitestReports(reports) {
  if (!Array.isArray(reports) || reports.length < 2) throw new Error('at least two shard reports are required');
  reports.forEach((r,i)=>validate(r, `shard-${i+1}`));
  const seen = new Set();
  const testResults = [];
  for (const r of reports) {
    for (const file of r.testResults) {
      const key = String(file.name ?? file.testFilePath ?? '');
      if (!key) throw new Error('test result missing file identity');
      if (seen.has(key)) throw new Error(`duplicate test file across shards: ${key}`);
      seen.add(key); testResults.push(file);
    }
  }
  testResults.sort((a,b)=>String(a.name ?? a.testFilePath).localeCompare(String(b.name ?? b.testFilePath)));
  const sum = key => reports.reduce((n,r)=>n + (Number.isFinite(r[key]) ? r[key] : 0), 0);
  return {
    numTotalTestSuites: sum('numTotalTestSuites'),
    numPassedTestSuites: sum('numPassedTestSuites'),
    numFailedTestSuites: sum('numFailedTestSuites'),
    numPendingTestSuites: sum('numPendingTestSuites'),
    numTotalTests: sum('numTotalTests'),
    numPassedTests: sum('numPassedTests'),
    numFailedTests: sum('numFailedTests'),
    numPendingTests: sum('numPendingTests'),
    numTodoTests: sum('numTodoTests'),
    startTime: Math.min(...reports.map(r=>Number.isFinite(r.startTime)?r.startTime:Number.MAX_SAFE_INTEGER)),
    success: reports.every(r=>r.success === true),
    testResults
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const oi=process.argv.indexOf('--output');
  if (oi<0 || !process.argv[oi+1]) { console.error('usage: node merge-vitest-shards.mjs shard1.json shard2.json [...] --output merged.json'); process.exit(2); }
  const inputs=process.argv.slice(2,oi);
  try { const reports=inputs.map(p=>JSON.parse(fs.readFileSync(p,'utf8'))); fs.writeFileSync(process.argv[oi+1], JSON.stringify(mergeVitestReports(reports))); }
  catch(err){ console.error(err.message); process.exitCode=2; }
}
