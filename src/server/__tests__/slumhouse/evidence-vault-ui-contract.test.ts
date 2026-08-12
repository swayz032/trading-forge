import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const page = fs.readFileSync(path.resolve("public/slumhouse/evidence-vault.html"), "utf8");
const office = fs.readFileSync(path.resolve("public/slumhouse/office.html"), "utf8");
const recipe = fs.readFileSync(path.resolve("public/slumhouse/recipe.html"), "utf8");
const agent = fs.readFileSync(path.resolve("src/server/routes/agent.ts"), "utf8");
const scout = fs.readFileSync(path.resolve("src/server/services/autonomous-scout-runner.ts"), "utf8");

describe("Media Evidence Vault production contract", () => {
  it("is a full Reporting Room toggle backed by the shared authenticated page", () => {
    for (const type of ["night", "soak", "ab", "rl", "paper", "vault"]) {
      expect(office).toContain(`data-rr-type="${type}"`);
    }
    expect(office).toContain('/slumhouse/evidence-vault.html?embed=1');
    expect(office).toContain("type === 'vault'");
  });

  it("shows daily intake, full transcript, source seals, and linked strategy receipts", () => {
    expect(page).toContain("The remote");
    expect(page).toContain('data-mode="today"');
    expect(page).toContain('data-mode="library"');
    expect(page).toContain('data-mode="workers"');
    expect(page).toContain('data-symbol="MES"');
    expect(page).toContain('data-symbol="MNQ"');
    expect(page).toContain('data-symbol="MCL"');
    expect(page).toContain("s.symbol===symbolFilter");
    expect(page).toContain("Today's strategies &amp; sources");
    expect(page).toContain("Full strategy library");
    expect(page).toContain("The real readers, judges, and local lane");
    expect(page).toContain('class="panel main-stage is-empty"');
    expect(page).toContain('class="panel right-rail"');
    expect(page).toContain(".main-stage{display:block");
    expect(page).not.toContain("grid-template-columns:minmax(285px,38%)");
    expect(page).not.toContain('id="today-only"');
    expect(page).toContain("Full transcript");
    expect(page).toContain("SHA-256 evidence seal");
    expect(page).toContain("maxresdefault.jpg");
    expect(page).toContain("readableTranscript(selected.transcript)");
    expect(page).toContain("Readable evidence copy");
    expect(page).toContain("Selected strategy");
    expect(page).toContain("strategies share this exact teaching source");
    expect(page).toContain("new AbortController()");
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
    expect(page).toContain("payload.stats.today");
    expect(page).toContain("Only extraction-system roles are shown");
    expect(page).toContain("legacy application-router roles are excluded");
    expect(page).not.toContain("canonical model router");
  });

  it("renders separate strategy-selection and Compiler View controls without nesting buttons", () => {
    const escSource = page.match(/function esc\(v\)\{.*?\n/)?.[0];
    const cardSource = page.match(/function strategyCard\(s\)\{.*?\n/)?.[0];
    expect(escSource).toBeTruthy();
    expect(cardSource).toBeTruthy();
    const strategyCard = vm.runInNewContext(
      `var selectedStrategyId='',activeCompilerStrategyId='';${escSource}${cardSource};strategyCard`,
    ) as (strategy: Record<string, unknown>) => string;
    const html = strategyCard({
      id: "strategy-1",
      name: "First Run Monarch",
      symbol: "MCL",
      timeframe: "5m",
      lifecycleState: "CANDIDATE",
      sourceVideoId: "dQw4w9WgXcQ",
      sourceTitle: "Volume Profile Strategy",
      transcriptStatus: "available",
      compilerView: { state: "uncompiled" },
    });

    expect(html).toContain('data-strategy="strategy-1"');
    expect(html).toContain('data-compiler-open="strategy-1"');
    expect(html).toContain("Compiler View");
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/s);
  });

  it("loads the local renderer and restores Media View through an owned lifecycle", () => {
    expect(page).toContain('/slumhouse/evidence-vault-compiler.css');
    expect(page).toContain("import('/slumhouse/evidence-vault-compiler.js')");
    expect(page).toContain("function openCompilerView(");
    expect(page).toContain("function closeCompilerView(");
    expect(page).toContain("compilerController.destroy()");
  });
});
