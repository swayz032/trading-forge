// scripts/lib/__tests__/rails-switch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRailsSwitch } from "../rails-switch.cjs";

const q = (rows) => async () => rows;

test("no rows → armed (default-on)", async () => {
  assert.deepEqual(await readRailsSwitch(q([])), { mode: "armed", skipUntilMs: null });
});
test("rails_mode=0 → off", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_mode", current_value: "0" }]));
  assert.equal(r.mode, "off");
});
test("rails_mode=2 (any nonzero) → armed", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_mode", current_value: "2" }]));
  assert.equal(r.mode, "armed");
});
test("rails_skip_until in the future → skipUntilMs set", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_skip_until", current_value: "9999999999999" }]));
  assert.equal(r.skipUntilMs, 9999999999999);
});
test("query throws → mode null (fail-closed)", async () => {
  const r = await readRailsSwitch(async () => { throw new Error("db down"); });
  assert.deepEqual(r, { mode: null, skipUntilMs: null });
});
