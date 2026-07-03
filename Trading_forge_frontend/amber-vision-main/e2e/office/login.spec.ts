/**
 * Office E2E — passcode login: success, failure, 5-fail lockout.
 * Auth crypto (passcode hash compare + HMAC session cookie) is the REAL
 * admin-session lib; the lockout policy mirrors admin.ts (MAX_FAILS=5 → 429).
 */
import { test, expect } from "@playwright/test";
import { PASSCODE, resetHarness, unlockOffice, auditRows } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetHarness(page);
});

test("locked shell renders and wrong passcode is refused with a plain message", async ({ page }) => {
  await page.goto("/slumhouse/office.html");
  await expect(page.locator("#of-lock")).toBeVisible();
  await expect(page.locator("#of-shell")).toBeHidden();

  await page.locator("#of-passcode").fill("000000");
  await page.locator("#of-submit").click();
  await expect(page.locator("#of-msg")).toHaveText("Wrong passcode.");
  await expect(page.locator("#of-shell")).toBeHidden();

  const rows = await auditRows(page);
  expect(rows.some((r) => r.action === "slumhouse_admin.auth_failed")).toBe(true);
});

test("correct passcode unlocks the Office and writes an auth_success audit row", async ({ page }) => {
  await unlockOffice(page);

  // switch cards render (Bot Power card exists)
  await expect(page.locator("#of-track .of-card3d")).toHaveCount(6);
  await expect(page.locator(".of-card-title", { hasText: "Bot Power" })).toBeVisible();

  const rows = await auditRows(page);
  expect(rows.some((r) => r.action === "slumhouse_admin.auth_success")).toBe(true);
});

test("5 wrong passcodes lock the Office out (429 message on the next attempt)", async ({ page }) => {
  await page.goto("/slumhouse/office.html");
  for (let i = 0; i < 5; i++) {
    await page.locator("#of-passcode").fill(`wrong-${i}`);
    await page.locator("#of-submit").click();
    await expect(page.locator("#of-msg")).toHaveText("Wrong passcode.");
  }

  // 6th attempt — even with the CORRECT passcode — must be locked out.
  await page.locator("#of-passcode").fill(PASSCODE);
  await page.locator("#of-submit").click();
  await expect(page.locator("#of-msg")).toHaveText(
    "Too many attempts — locked out, try again later.",
  );
  await expect(page.locator("#of-shell")).toBeHidden();

  const rows = await auditRows(page);
  expect(rows.filter((r) => r.action === "slumhouse_admin.auth_failed").length).toBe(5);
  expect(rows.some((r) => r.action === "slumhouse_admin.auth_locked_out")).toBe(true);
});
