import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FAST_WORKFLOW = ".github/workflows/fast.yml";

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("Fast Lane provisions, migrates, and cleans an isolated per-run database", () => {
  const workflow = readFileSync(FAST_WORKFLOW, "utf8");
  const provision = workflow.indexOf("Provision isolated PostgreSQL test database");
  const migrate = workflow.indexOf("Apply database migrations");
  const vitest = workflow.indexOf("Collect full Vitest report");
  const cleanup = workflow.indexOf("Remove isolated PostgreSQL test database");

  assert.match(workflow, /trading_forge_ci_\$\{\{ github\.run_id \}\}/);
  assert.ok(provision >= 0, "Fast Lane must provision its database");
  assert.ok(migrate > provision, "Fast Lane must migrate after provisioning");
  assert.ok(vitest > migrate, "Fast Lane must migrate before full Vitest");
  assert.ok(cleanup > vitest, "Fast Lane must clean the isolated database after tests");
  assert.match(workflow.slice(cleanup), /if: always\(\)/);
});

test("Fast Lane Python dependencies cover modules imported during pytest collection", () => {
  const requirements = readFileSync("ci/requirements-fast.txt", "utf8");
  assert.match(requirements, /^pytest(?:[<=>]|$)/m);
  assert.match(requirements, /^click(?:[<=>]|$)/m);
  assert.match(requirements, /^vectorbt(?:[<=>]|$)/m);
});

test("repository tests do not embed a developer-machine source path", () => {
  const offenders = filesBelow("src")
    .filter((path) => path.endsWith(".test.ts"))
    .filter((path) =>
      /[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/]Projects[\\/]trading-forge[\\/]/i.test(
        readFileSync(path, "utf8"),
      ),
    );

  assert.deepEqual(offenders, []);
});
