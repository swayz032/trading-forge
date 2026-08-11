import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

class NodeStub {
  children: NodeStub[] = [];
  attributes: Record<string, string> = {};
  className = "";
  textContent = "";
  innerHTML = "";
  constructor(public tagName = "div") {}
  appendChild(child: NodeStub) { this.children.push(child); return child; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener() {}
  focus() { this.attributes.focused = "true"; }
}

describe("Recipe premium instruments", () => {
  it("renders nine unique evidence-bound instruments and neutral null geometry", () => {
    const document = { createElement: (tag: string) => new NodeStub(tag) };
    const window = {} as Record<string, unknown>;
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", window);
    const source = fs.readFileSync(path.resolve("public/slumhouse/recipe-instruments.js"), "utf8");
    Function("window", "document", source)(window, document);
    const api = window.RecipeInstruments as { renderBacktest(r: unknown): NodeStub; renderGate(r: unknown, n: string): NodeStub };
    const recipe = { backtest: { equityCurve: [0, 4, 2] }, gateMetrics: Object.fromEntries([
      ["Surprise Test", { instrument: { kind: "walk-forward", folds: [0.7, 0.8] } }],
      ["Sloppy Bot Test", { instrument: { kind: "jitter-dials", sdr: 0.9 } }],
      ["Worst Day Test", { instrument: { kind: "crash", ruinProbability: 0.03 } }],
      ["Every Mood Test", { instrument: { kind: "regimes", regimes: { trend: 1.2 } } }],
      ["Real or Lucky", { instrument: { kind: "shuffle", p95Sharpe: 0.2 } }],
      ["Preseason", { instrument: { kind: "paper", pnl: 10 } }],
      ["Real-Time Match", { instrument: { kind: "drift", divergence: 0.018 } }],
      ["Plays Clean", { instrument: { kind: "compliance", passRate: 1 } }],
    ]) };
    expect(api.renderBacktest(recipe).attributes["data-instrument"]).toBe("backtest");
    const names = Object.keys(recipe.gateMetrics);
    expect(names.map((name) => api.renderGate(recipe, name).attributes["data-instrument"]))
      .toEqual(["walk-forward", "jitter-dials", "crash", "regimes", "shuffle", "paper", "drift", "compliance"]);
    const neutral = api.renderGate({ gateMetrics: { "Real or Lucky": { instrument: { kind: "shuffle", p95Sharpe: null } } } }, "Real or Lucky");
    expect(neutral.attributes["data-state"]).toBe("empty");
    expect(neutral.innerHTML).not.toContain("data-series");
    expect(api.renderGate({ gateMetrics: {} }, "Surprise Test").attributes["data-instrument"]).toBe("walk-forward");
  });

  it("wires the exact banner, accessible controls, renderer assets, and reduced motion", () => {
    const html = fs.readFileSync(path.resolve("public/slumhouse/recipe.html"), "utf8");
    const kitchen = fs.readFileSync(path.resolve("public/slumhouse/kitchen.html"), "utf8");
    const css = fs.readFileSync(path.resolve("public/slumhouse/recipe-instruments.css"), "utf8");
    expect(html).toContain("/slumhouse/images/slumdawg-recipe-counter.png");
    expect(html).toContain("/slumhouse/recipe-instruments.js");
    expect(html).toContain("/slumhouse/recipe-instruments.css");
    expect(html).toContain('aria-pressed');
    expect(html).toContain("r.identity.displayName || cleanName(r.identity.name)");
    expect(kitchen).not.toContain("&name=" + "' + encodeURIComponent(fam.title) + '");
    expect(html).toContain("resolveMenuDisplayName(id)");
    expect(html).toContain("Promise.allSettled");
    expect(html).toContain('class: "r-panel r-instrument-panel"');
    expect(html).not.toContain('class: "r-gate-body"');
    expect(html).not.toContain('el("div", { class: "r-bt-stats" }');
    expect(html).not.toContain('el("div", { class: "r-quant-row" }');
    expect(html).toContain("panel.appendChild(window.RecipeInstruments.renderGate(r, name))");
    expect(html).not.toContain("left.appendChild(instrument)");
    expect(html).toContain("panel.appendChild(window.RecipeInstruments.renderBacktest(r))");
    expect(css).toContain("appearance: none");
    expect(css).toContain("instrument-ghost");
    expect(css).toContain("instrument-ghost--backtest");
    expect(css).toContain(".instrument-ghost--backtest span { animation:none; }");
    expect(css).toContain("background:#000");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
