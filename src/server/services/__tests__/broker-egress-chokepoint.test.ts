/**
 * broker-egress-chokepoint.test.ts — item 4 (R-349 §2)
 *
 * THE CLASS THIS CLOSES: broker egress happened at several call sites with
 * different gate sets. AR-320 enumerated them BY HAND — a snapshot, which the next
 * feature that adds a `fetch` to a broker host silently invalidates. This turns
 * "we counted them once" into "CI counts them on every push."
 *
 * ★ DERIVED FROM THE PROPERTY, NOT THE NAME. `exa-broker.ts`,
 * `brave-search-broker.ts` and `parallel-broker.ts` are SEARCH brokers: they fetch,
 * they have "broker" in the filename, and they are irrelevant. A name-based guard
 * flags all three and still misses a trading call in a file named anything else.
 *
 * ★ CONNECTION, NOT CO-OCCURRENCE. A first version of this predicate flagged any
 * file that mentioned a broker host AND contained a fetch. That produced a false
 * positive on `alert-service.ts`, which fetches localhost and merely NAMES a broker
 * in alert text. Two true facts in one file do not make a true link. The predicate
 * now requires the fetch ARGUMENT to be a broker-host literal, or a const in that
 * same file assigned one.
 *
 * ★ KNOWN COVERAGE BOUND, stated rather than discovered later: a module that
 * fetches a URL arriving as a PARAMETER or from CONFIG is invisible to a static
 * check. `network-failover.ts` and `prop-firm-health-service.ts` are that shape —
 * they do reach broker hosts at runtime and this guard does NOT police them. It
 * catches the direct form, which is the form every current egress point uses and
 * the form a new one is most likely to take.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * TIER 1 — may send a CREDENTIAL or an ORDER to a broker. Exactly one module.
 * This is where the broker gate stack lives; a second entry here means a second
 * set of gates to keep correct, which is the defect this guard exists to prevent.
 */
const CREDENTIAL_EGRESS_ALLOWLIST = ["src/server/integrations/traderspost/client.ts"];

/**
 * TIER 2 — REACHABILITY probes only: no credential, no order payload, no account
 * context. Listed explicitly WITH the reason rather than excluded silently, because
 * an unexplained exemption is how a real egress point hides in plain sight.
 *   exchange-status-service.ts — HEAD request to Tradovate's auth URL to decide
 *   whether the venue is reachable. Sends nothing and can place nothing.
 */
const REACHABILITY_ALLOWLIST = ["src/server/services/exchange-status-service.ts"];

const BROKER_HOST =
  /traderspost\.io|topstepx?\.com|tradovateapi|tradovate\.com|projectx\.|rithmic\.com/i;

const SERVER_ROOT = resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(p, out);
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

/** const NAME = "<...broker host...>" — including `?? fallback` forms. */
function brokerUrlConsts(src: string): string[] {
  const names: string[] = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) if (BROKER_HOST.test(m[2])) names.push(m[1]);
  return names;
}

/** Modules whose fetch/axios ARGUMENT resolves to a broker host. */
function findBrokerEgressModules(): string[] {
  const hits: string[] = [];
  for (const file of walk(SERVER_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (!BROKER_HOST.test(src)) continue;
    const consts = brokerUrlConsts(src);
    const args = [...src.matchAll(/\b(?:fetch|axios(?:\.\w+)?)\s*\(\s*([^,)]*)/g)].map((m) =>
      m[1].trim(),
    );
    const targeted = args.some(
      (a) => BROKER_HOST.test(a) || consts.some((c) => new RegExp(`\\b${c}\\b`).test(a)),
    );
    if (targeted) hits.push(file.split(sep).join("/").replace(/^.*?(src\/server\/)/, "$1"));
  }
  return hits.sort();
}

describe("broker egress chokepoint (item 4)", () => {
  it("no module outside the two allowlists reaches a trading-broker host", () => {
    const allowed = new Set([...CREDENTIAL_EGRESS_ALLOWLIST, ...REACHABILITY_ALLOWLIST]);
    const unexpected = findBrokerEgressModules().filter((f) => !allowed.has(f));

    expect(
      unexpected,
      `Module(s) reach a trading-broker host directly:\n` +
        unexpected.map((f) => `  - ${f}`).join("\n") +
        `\n\nRoute credential/order traffic through ${CREDENTIAL_EGRESS_ALLOWLIST[0]} — it is ` +
        `the single place the broker gate stack lives. If this is a credential-less ` +
        `REACHABILITY probe, add it to REACHABILITY_ALLOWLIST *with the reason*, so the ` +
        `exemption is visible rather than assumed.`,
    ).toEqual([]);
  });

  it("DISCRIMINATES: the credential-egress module is still detected", () => {
    // Without this, a predicate that silently stopped matching would make the test
    // above pass forever while policing nothing.
    expect(findBrokerEgressModules()).toContain(CREDENTIAL_EGRESS_ALLOWLIST[0]);
  });

  it("does not flag SEARCH brokers that merely have 'broker' in the filename", () => {
    const found = findBrokerEgressModules();
    for (const notATradingBroker of [
      "src/server/services/exa-broker.ts",
      "src/server/services/brave-search-broker.ts",
      "src/server/services/parallel-broker.ts",
    ]) {
      expect(found).not.toContain(notATradingBroker);
    }
  });

  it("does not flag a module that names a broker but fetches something else", () => {
    // alert-service.ts fetches localhost and mentions a broker in alert text — the
    // co-occurrence false positive the predicate was tightened to exclude.
    expect(findBrokerEgressModules()).not.toContain("src/server/services/alert-service.ts");
  });

  it("broker-router no longer performs its own broker egress (item 4 regression)", () => {
    const src = readFileSync(resolve(SERVER_ROOT, "services/broker-router.ts"), "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
