import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(path.resolve("public/slumhouse/evidence-vault.html"), "utf8");
const office = fs.readFileSync(path.resolve("public/slumhouse/office.html"), "utf8");
const recipe = fs.readFileSync(path.resolve("public/slumhouse/recipe.html"), "utf8");
const agent = fs.readFileSync(path.resolve("src/server/routes/agent.ts"), "utf8");
const scout = fs.readFileSync(path.resolve("src/server/services/autonomous-scout-runner.ts"), "utf8");

describe("Media Evidence Vault production contract", () => {
  it("is a full Reporting Room toggle backed by the shared authenticated page", () => {
    expect(office).toContain('data-rr-type="vault"');
    expect(office).toContain('/slumhouse/evidence-vault.html?embed=1');
    expect(office).toContain("type === 'vault'");
  });

  it("shows daily intake, full transcript, source seals, and linked strategy receipts", () => {
    expect(page).toContain("Today's intake");
    expect(page).toContain('class="panel main-stage"');
    expect(page).toContain('class="panel right-rail"');
    expect(page).toContain("Full transcript");
    expect(page).toContain("SHA-256 evidence seal");
    expect(page).toContain("/slumhouse/recipe.html?id=");
    expect(page).toContain("v.isToday");
  });

  it("Recipe links an exact YouTube video ID into the vault", () => {
    expect(recipe).toContain("Transcript &amp; evidence");
    expect(recipe).toContain("/slumhouse/evidence-vault.html?video=");
    expect(recipe).toMatch(/\[A-Za-z0-9_-\]\{11\}/);
  });

  it("archives evidence before n8n and autonomous extraction proceed", () => {
    const n8nArchive = agent.indexOf("await archiveYoutubeEvidence({");
    const n8nModel = agent.indexOf('callOpenAI("transcript_extractor"');
    expect(n8nArchive).toBeGreaterThan(0);
    expect(n8nArchive).toBeLessThan(n8nModel);
    expect(scout).toContain("extraction skipped so source evidence is not lost");
  });

  it("contains no seeded cards or fabricated archive totals", () => {
    expect(page).not.toMatch(/Math\.random|fixture|demo video|sample transcript/i);
    expect(page).toContain("payload.videos");
    expect(page).toContain("d.stats.today");
  });
});
