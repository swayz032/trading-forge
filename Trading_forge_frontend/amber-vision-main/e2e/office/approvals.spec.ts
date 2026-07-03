/**
 * Office E2E — go-live approval cards: plain-English evidence pills render,
 * Approve fires the authenticated endpoint (audit row asserted), the
 * missing-evidence strategy has Approve DISABLED (fail-closed), and Reject
 * requires + records a reason.
 *
 * The approvals list is a harness fixture (see e2e/office-test-server.mts —
 * the real promotion path is unit-tested in vitest); the UI under test is the
 * REAL office-approvals.js against the contract-identical endpoints.
 */
import { test, expect } from "@playwright/test";
import { resetHarness, unlockOffice, auditRows } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetHarness(page);
});

test("approval cards render plain-English evidence with raw values beneath", async ({ page }) => {
  await unlockOffice(page);

  const section = page.locator("#of-approvals");
  await expect(section).toBeVisible();
  await expect(section.locator(".ofa-card")).toHaveCount(2);

  const clean = section.locator('.ofa-card[data-sid="e2e-strat-clean"]');
  await expect(clean.locator(".ofa-name")).toHaveText("orb_mnq_15m");
  // verdict pills — plain English first…
  await expect(clean.getByText("Survived 34 market-regime tests")).toBeVisible();
  await expect(clean.getByText("2% chance the results are luck")).toBeVisible();
  await expect(clean.getByText("97% chance of surviving the firm's rules")).toBeVisible();
  // …raw value small beneath
  await expect(clean.getByText("PBO 0.020 · limit 0.15")).toBeVisible();
  await expect(clean.locator("[data-approve]")).toBeEnabled();
});

test("fail-closed: missing/stale evidence disables Approve and shows blockers", async ({ page }) => {
  await unlockOffice(page);

  const stale = page.locator('.ofa-card[data-sid="e2e-strat-stale"]');
  await expect(stale.locator("[data-approve]")).toBeDisabled();
  await expect(stale.locator(".ofa-blockers")).toContainText("Why Approve is locked");
  await expect(stale.locator(".ofa-blockers")).toContainText("44 days old");
  await expect(stale.locator(".ofa-blockers")).toContainText("Luck check (PBO) is missing");
  // Reject stays available — sending it back never needs evidence.
  await expect(stale.locator("[data-reject]")).toBeEnabled();
});

test("Approve fires the endpoint, audits with human authority, and removes the card", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await unlockOffice(page);

  const clean = page.locator('.ofa-card[data-sid="e2e-strat-clean"]');
  await clean.locator("[data-approve]").click(); // confirm accepted
  await expect(clean.locator("[data-msg]")).toHaveText("Approved — strategy is DEPLOYED.");

  // list refreshes without the approved strategy
  await expect(page.locator("#of-approvals .ofa-card")).toHaveCount(1, { timeout: 10_000 });

  const rows = await auditRows(page);
  const row = rows.find((r) => r.action === "slumhouse_admin.deploy_approved");
  expect(row).toBeTruthy();
  expect(row?.input?.strategyId).toBe("e2e-strat-clean");
});

test("Reject prompts for a reason and audits it", async ({ page }) => {
  page.on("dialog", (d) => void d.accept("needs another week of paper"));
  await unlockOffice(page);

  const stale = page.locator('.ofa-card[data-sid="e2e-strat-stale"]');
  await stale.locator("[data-reject]").click(); // prompt answered
  await expect(stale.locator("[data-msg]")).toHaveText("Sent back to paper.");
  await expect(page.locator("#of-approvals .ofa-card")).toHaveCount(1, { timeout: 10_000 });

  const rows = await auditRows(page);
  const row = rows.find((r) => r.action === "slumhouse_admin.deploy_rejected");
  expect(row).toBeTruthy();
  expect(row?.input?.reason).toBe("needs another week of paper");
});

test("approval endpoints refuse without the admin session cookie", async ({ page }) => {
  // No unlock — raw API contract check from the browser context.
  const list = await page.request.get("/slumhouse/admin/deploy-approvals");
  expect(list.status()).toBe(401);
  const approve = await page.request.post("/slumhouse/admin/deploy-approvals/e2e-strat-clean/approve");
  expect(approve.status()).toBe(401);
});
