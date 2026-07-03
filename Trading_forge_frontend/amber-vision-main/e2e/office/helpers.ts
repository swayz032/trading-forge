/**
 * Shared helpers for the Office E2E specs.
 */
import { expect, type Page } from "@playwright/test";

export const PASSCODE = "1974test";

/** Reset ALL harness state (lockout, switches, audit rows, fixtures). */
export async function resetHarness(page: Page): Promise<void> {
  const res = await page.request.post("/__test__/reset");
  expect(res.ok()).toBe(true);
}

/** Navigate to the Office and unlock it with the test passcode. */
export async function unlockOffice(page: Page): Promise<void> {
  await page.goto("/slumhouse/office.html");
  await expect(page.locator("#of-lock")).toBeVisible();
  // office.html defensively wipes the passcode input 60ms + 400ms after the
  // lock screen renders (anti-autofill). Wait it out before typing, or the
  // late wipe can race a fast fill and submit an empty passcode.
  await page.waitForTimeout(600);
  await page.locator("#of-passcode").fill(PASSCODE);
  await page.locator("#of-submit").click();
  await expect(page.locator("#of-shell")).toBeVisible();
  await expect(page.locator("#of-lock")).toBeHidden();
}

/** Fetch the harness's in-memory audit rows. */
export async function auditRows(page: Page): Promise<Array<{ action: string; input?: Record<string, unknown>; status: string }>> {
  const res = await page.request.get("/__test__/audit");
  const body = await res.json();
  return body.rows;
}

/**
 * Bring the switch card with the given OF_CARDS index to the front of the
 * carousel by clicking its dot, and return the active card locator.
 * Card order: 0 carter · 1 bot_power · 2 learning_loop · 3 vacation_mode ·
 * 4 recovery · 5 live_execution.
 */
export async function goToCard(page: Page, index: number) {
  await page.locator("#of-dots .of-dot").nth(index).click();
  const card = page.locator("#of-track .of-card3d").nth(index);
  await expect(card).toHaveClass(/is-active/);
  return card;
}
