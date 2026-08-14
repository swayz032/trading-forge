import { test } from "node:test";
import assert from "node:assert/strict";
import { buildValidationPlan } from "../validate-agent-packet.mjs";

test("compiler profile includes the H1 conveyor/spec/role battery and all hard gates", () => {
  const commands = buildValidationPlan("compiler");
  assert.deepEqual(commands[0], {
    command: "python",
    args: ["-m", "pytest", "src/engine/tests/test_pilot_conveyor.py", "src/engine/tests/test_spec_producer.py", "src/engine/tests/test_svkm_role_execution.py", "-q", "--tb=short"],
  });
  assert.deepEqual(commands.slice(-4).map((entry) => entry.args.join(" ")), [
    "run build",
    "run check:production-isolation",
    "run check:2026-compliance",
    "run system-map:check",
  ]);
});

test("runtime profile includes PAPER, broker, fill, kill-switch, and watchdog tests", () => {
  const commands = buildValidationPlan("runtime");
  const commandText = commands.map((entry) => entry.args.join(" ")).join("\n");
  for (const required of [
    "broker-router.test.ts",
    "fill-reconciliation.test.ts",
    "paper-execution-service.double-close-idempotency.test.ts",
    "kill-switch.test.ts",
    "api-liveness-watchdog.test.mjs",
  ]) assert.match(commandText, new RegExp(required.replaceAll(".", "\\.")));
});

test("integration profile is the compiler and runtime batteries followed by one gate tail", () => {
  const compiler = buildValidationPlan("compiler");
  const runtime = buildValidationPlan("runtime");
  const integration = buildValidationPlan("integration");
  assert.equal(integration.filter((entry) => entry.args.join(" ") === "run build").length, 1);
  assert.equal(integration.length, compiler.length + runtime.length - 4);
});

test("unknown profiles fail closed", () => {
  assert.throws(() => buildValidationPlan("fast"), /invalid_validation_profile/);
});
