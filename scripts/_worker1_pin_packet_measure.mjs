import { execFileSync } from 'node:child_process';
import { makeRealIo, measureState } from './control-plane-bootstrap/bootstrap.mjs';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const io = makeRealIo(repoRoot);
const measured = measureState(io);
const out = {
  workerBranch: measured.workerBranch,
  workerHead: measured.workerHead,
  repoRemote: measured.repoRemote,
  queueSha256: measured.queueSha256,
  ready: measured.ready,
  spent: measured.spent,
  receiptsReadmeOnly: measured.receiptsReadmeOnly,
  receiptsGitTreeSha: measured.receiptsGitTreeSha,
  receiptsClean: measured.receiptsClean,
  gptAuthorityHead: measured.gptAuthorityHead,
  rulingId: measured.rulingId,
  isNewestRuling: measured.isNewestRuling,
  claimedAuthorizationIds: [...measured.claimedAuthorizationIds],
  bootstrapBundleSha256: measured.bootstrapBundleSha256,
  bootstrapBundleFiles: measured.bootstrapBundleFiles,
  existingControlPlaneBranches: measured.existingControlPlaneBranches,
  agentModelExecutions: measured.agentModelExecutions,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
