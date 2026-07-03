/**
 * Office E2E — RISK TRUTH card: healthy render with "as of Xs ago" staleness,
 * degraded (grey + banner) when the tower feed fails, and stale-degrade when
 * data ages past the staleness ceiling. NEVER silent-frozen-green.
 */
import { test, expect } from "@playwright/test";
import { resetHarness, unlockOffice } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetHarness(page);
});

test("healthy feed renders plain-English risk rows with an as-of stamp", async ({ page }) => {
  await unlockOffice(page);

  const card = page.locator("#ofr-card");
  await expect(card).toBeVisible();

  // healthy → not degraded
  await expect(card).not.toHaveClass(/stale/, { timeout: 10_000 });
  await expect(page.locator("#ofr-asof")).toHaveText(/as of \d+s ago/);

  // plain-English rows fed by /api/production/status
  await expect(card.getByText("Is the bot allowed to trade?")).toBeVisible();
  await expect(card.getByText("Loss room left today")).toBeVisible();
  await expect(card.getByText("$813 (81% left)")).toBeVisible(); // 812.5 rounded, 18.75% used
  await expect(card.getByText("9 of 9 clear")).toBeVisible();
  await expect(card.getByText("Books verified clean")).toBeVisible();
  await expect(card.getByText("6h ago")).toBeVisible();
});

test("failed tower feed from the start degrades visibly — no silent green", async ({ page }) => {
  const res = await page.request.post("/__test__/production-status", { data: { mode: "fail" } });
  expect(res.ok()).toBe(true);

  await unlockOffice(page);

  const card = page.locator("#ofr-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/stale/);
  await expect(page.locator("#ofr-banner")).toContainText("NO TOWER DATA YET");
  await expect(page.locator("#ofr-asof")).toHaveText("no data from the tower yet");
});

test("data older than the staleness ceiling flips to TOWER DATA STALE — showing last known", async ({ page }) => {
  // Testability hooks in office-risk.js: shrink the stale ceiling to 2s and
  // stretch the poll so no refresh rescues the card inside the test window.
  await page.addInitScript(() => {
    (window as unknown as Record<string, number>).__OFFICE_RISK_STALE_MS = 2000;
    (window as unknown as Record<string, number>).__OFFICE_RISK_POLL_MS = 60_000;
  });
  await unlockOffice(page);

  const card = page.locator("#ofr-card");
  // first poll succeeds → healthy
  await expect(card).not.toHaveClass(/stale/, { timeout: 10_000 });
  // last-known data (numbers stay on screen — "showing last known")
  await expect(card.getByText("9 of 9 clear")).toBeVisible();

  // …then ages past the 2s ceiling with no fresh poll → visible degrade
  await expect(card).toHaveClass(/stale/, { timeout: 10_000 });
  await expect(page.locator("#ofr-banner")).toContainText("TOWER DATA STALE — showing last known");
  // last-known numbers remain visible under the banner
  await expect(card.getByText("9 of 9 clear")).toBeVisible();
});
