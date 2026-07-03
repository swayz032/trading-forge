/**
 * Office E2E — all 5 switches toggle through the real UI and an audit row
 * lands for every action (asserted via the harness audit endpoint).
 * Card order: 0 carter · 1 bot_power · 2 learning_loop · 3 vacation_mode ·
 * 4 recovery · 5 live_execution.
 */
import { test, expect, type Page } from "@playwright/test";
import { resetHarness, unlockOffice, auditRows, goToCard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetHarness(page);
  // Accept every confirm/prompt dialog the switch cards raise.
  page.on("dialog", (d) => void d.accept());
});

async function statusOf(card: ReturnType<Page["locator"]>) {
  return card.locator("[data-status]");
}

test("Bot Power toggles PAUSED → RUNNING and audits", async ({ page }) => {
  await unlockOffice(page);
  const card = await goToCard(page, 1);
  await expect(await statusOf(card)).toHaveText("PAUSED");

  await card.locator("[data-toggle]").click();
  await expect(await statusOf(card)).toHaveText("RUNNING");

  const rows = await auditRows(page);
  const row = rows.find(
    (r) => r.action === "slumhouse_admin.switch_toggled" && r.input?.switch === "bot_power",
  );
  expect(row).toBeTruthy();
  expect(row?.input?.on).toBe(true);
});

test("Learning Loop dial cycles OFF → OBSERVE → AUTOPILOT with audit per step", async ({ page }) => {
  await unlockOffice(page);
  const card = await goToCard(page, 2);
  await expect(await statusOf(card)).toHaveText("OFF");

  await card.locator("[data-toggle]").click(); // OFF → OBSERVE (no confirm)
  await expect(await statusOf(card)).toHaveText("OBSERVE");

  await card.locator("[data-toggle]").click(); // OBSERVE → AUTOPILOT (confirm accepted)
  await expect(await statusOf(card)).toHaveText("AUTOPILOT");

  const rows = await auditRows(page);
  const modes = rows
    .filter((r) => r.action === "slumhouse_admin.switch_toggled" && r.input?.switch === "learning_loop")
    .map((r) => r.input?.mode);
  expect(modes).toEqual([1, 2]);
});

test("Vacation Mode toggles HOME → AWAY and audits", async ({ page }) => {
  await unlockOffice(page);
  const card = await goToCard(page, 3);
  await expect(await statusOf(card)).toHaveText("HOME");

  await card.locator("[data-toggle]").click(); // dangerOn confirm accepted
  await expect(await statusOf(card)).toHaveText("AWAY");

  const rows = await auditRows(page);
  expect(
    rows.some(
      (r) =>
        r.action === "slumhouse_admin.switch_toggled" &&
        r.input?.switch === "vacation_mode" &&
        r.input?.on === true,
    ),
  ).toBe(true);
});

test("Recovery is MOMENTARY: clears a live safety halt, audits, and never sticks on", async ({ page }) => {
  // Arm a safety auto-halt before entering the Office.
  const res = await page.request.post("/__test__/set-pipeline-mode", {
    data: { mode: "AUTOPAUSE_DD_VELOCITY" },
  });
  expect(res.ok()).toBe(true);

  await unlockOffice(page);
  const card = await goToCard(page, 4);
  await expect(await statusOf(card)).toHaveText("HALTED");

  await card.locator("[data-toggle]").click(); // confirmAction accepted
  // Immediate response says CLEARED; the follow-up reload lands on ALL CLEAR.
  await expect(await statusOf(card)).toHaveText(/CLEARED|ALL CLEAR/);
  await expect(await statusOf(card)).toHaveText("ALL CLEAR", { timeout: 10_000 });

  // Momentary invariant: the toggle never renders as a persistent green "on".
  await expect(card.locator("[data-toggle]")).not.toHaveClass(/(^| )on( |$)/);

  const rows = await auditRows(page);
  const trig = rows.find((r) => r.action === "slumhouse_admin.recovery_triggered");
  expect(trig).toBeTruthy();
  expect((trig?.result as { cleared?: string[] })?.cleared).toEqual(["AUTOPAUSE_DD_VELOCITY"]);

  // Second press with nothing to clear: still audited, clears nothing.
  await card.locator("[data-toggle]").click();
  await expect(await statusOf(card)).toHaveText("ALL CLEAR");
  const rows2 = await auditRows(page);
  const trigs = rows2.filter((r) => r.action === "slumhouse_admin.recovery_triggered");
  expect(trigs.length).toBe(2);
  expect((trigs[1]?.result as { cleared?: string[] })?.cleared).toEqual([]);
});

test("Live Execution toggles PAPER → LIVE and audits", async ({ page }) => {
  await unlockOffice(page);
  const card = await goToCard(page, 5);
  await expect(await statusOf(card)).toHaveText("PAPER");

  await card.locator("[data-toggle]").click(); // dangerOn confirm accepted
  await expect(await statusOf(card)).toHaveText("LIVE");

  const rows = await auditRows(page);
  expect(
    rows.some(
      (r) =>
        r.action === "slumhouse_admin.live_execution_toggled" &&
        r.input?.switch === "live_execution" &&
        r.input?.on === true,
    ),
  ).toBe(true);
});
