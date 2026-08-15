import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVitestReports } from './merge-vitest-shards.mjs';
import { compareVitestEvidence } from './compare-vitest-evidence.mjs';

function file(name,status='passed'){return {name,assertionResults:[{fullName:`${name} case`,title:'case',status,failureMessages:[]}]};}
function report(files){const assertions=files.flatMap(f=>f.assertionResults);return {numTotalTestSuites:files.length,numPassedTestSuites:files.filter(f=>f.assertionResults.every(a=>a.status!=='failed')).length,numFailedTestSuites:files.filter(f=>f.assertionResults.some(a=>a.status==='failed')).length,numPendingTestSuites:0,numTotalTests:assertions.length,numPassedTests:assertions.filter(a=>a.status==='passed').length,numFailedTests:assertions.filter(a=>a.status==='failed').length,numPendingTests:assertions.filter(a=>a.status==='skipped').length,numTodoTests:0,startTime:1,success:assertions.every(a=>a.status!=='failed'),testResults:files};}

test('two shards merge to exact serial assertion evidence',()=>{
  const a=file('/repo/a.test.ts'); const b=file('/repo/b.test.ts','failed');
  const serial=report([a,b]); const merged=mergeVitestReports([report([a]),report([b])]);
  assert.equal(compareVitestEvidence(serial,merged).ok,true);
  assert.equal(merged.numTotalTests,2);
});

test('duplicate test file across shards fails closed',()=>{
  const a=file('/repo/a.test.ts');
  assert.throws(()=>mergeVitestReports([report([a]),report([a])]),/duplicate test file/);
});

test('missing assertionResults fails closed',()=>{
  assert.throws(()=>mergeVitestReports([{testResults:[{name:'a'}]},{testResults:[]}]),/assertionResults missing/);
});

test('status drift is detected even when file set matches',()=>{
  const serial=report([file('/repo/a.test.ts','passed')]);
  const changed=report([file('/repo/a.test.ts','failed')]);
  const r=compareVitestEvidence(serial,changed);
  assert.equal(r.ok,false); assert.equal(r.same_files,true); assert.equal(r.same_assertions,false);
});
