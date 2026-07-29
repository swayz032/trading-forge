import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Night Desk production contract", () => {
  it("uses the real admin-only data endpoint and a full-page Office frame", () => {
    const office = read("public/slumhouse/office.html");
    const page = read("public/slumhouse/night-desk.html");
    const route = read("src/server/routes/slumhouse/api/night-desk.ts");

    expect(office).toContain('id="imm-night"');
    expect(office).toContain('/slumhouse/night-desk.html?embed=1');
    expect(page).toContain("/slumhouse/api/night-desk");
    expect(page).toContain("Learning Loop switch");
    expect(route).toContain("requireAdminSession");
    expect(page).not.toContain("Example report");
  });

  it("routes the nightly analyst through Sol Flex with a stable 24-hour cache key", () => {
    const router = read("src/server/services/model-router.ts");
    expect(router).toContain('model: "gpt-5.6-sol"');
    expect(router).toContain('serviceTier: "flex"');
    expect(router).toContain('reasoningEffort: "medium"');
    expect(router).toContain('promptCacheKey: "trading-forge:nightly-review:v1"');
    expect(router).toContain('promptCacheRetention: "24h"');
  });

  it("captures actual cache hits and actual service tier from both API shapes", () => {
    const router = read("src/server/services/model-router.ts");
    const proxy = read("src/server/routes/openai-proxy.ts");
    expect(router).toContain("prompt_tokens_details?.cached_tokens");
    expect(router).toContain("input_tokens_details?.cached_tokens");
    expect(router).toContain("serviceTier: typeof raw?.service_tier");
    expect(proxy).toContain("cacheHitRatio");
    expect(proxy).toContain("actualServiceTier");
  });

  it("keeps the nightly job fail-closed behind the Learning Loop", () => {
    const service = read("src/server/services/nightly-critique-service.ts");
    expect(service).toContain("if (!loop.advisoryOn)");
    expect(service).toContain('reason: "learning_loop_off"');
  });

  it("keeps the desktop stage focused on one baby-mode selection at a time", () => {
    const page = read("public/slumhouse/night-desk.html");
    expect(page).toContain("Pick one thing");
    expect(page).toContain("Pick one trade");
    expect(page).toContain("Pick one change");
    expect(page).toContain("Quick score");
    expect(page).toContain("What went wrong");
    expect(page).toContain("How it ran");
    expect(page).toContain('id="day-strip"');
    expect(page).toContain("The bot tried to trade when price broke above or below the first part of the day.");
    expect(page).toContain("The bot kept making the same trade idea again and again.");
    expect(page).toContain("body{overflow:hidden");
    expect(page).toContain("height:100dvh");
    expect(page).not.toContain('<div class="score">');
    expect(page).not.toContain("Pattern radar");
    expect(page).not.toContain("first-gate pass rate");
  });

  it("locks both embedded premium rooms to the Office viewport", () => {
    const office = read("public/slumhouse/office.html");
    const night = read("public/slumhouse/night-desk.html");
    expect(office).toMatch(/\.rr-room\.rr-imm-mode \.rr-immersive \{ inset: 62px 0 0;[^}]*overflow: hidden/);
    expect(office).toMatch(/\.imm-screen\.vault-screen,[\s\S]*\.imm-screen\.night-screen \{ height: 100%; min-height: 0;/);
    expect(night).toContain(".shell.embed header>div:first-child{padding-left:112px}");
    expect(night).toContain(".hero-number b,.hero-number span{display:block}");
  });

  it("keeps the committed 3 AM workflow aligned with the same model contract", () => {
    const workflow = read("workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json");
    expect(workflow).toContain("gpt-5.6-sol");
    expect(workflow).toContain("service_tier");
    expect(workflow).toContain("reasoning_effort");
  });
});
