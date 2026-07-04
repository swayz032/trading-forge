/**
 * Handler-driven entry detector — shared between framework-overlay.ts's
 * direction="both" coercion guard and direct-bucket-graduator.ts's Gate 1
 * (auditBidirectionalCompleteness), and reused by spec-onboarding-service.ts
 * wherever it calls into Gate 1.
 *
 * WHY THIS EXISTS (2026-07-04 dispatch-marker bug fix):
 * Two independent call sites each grew their own ad-hoc "is this entry
 * handler-driven" check and drifted apart. framework-overlay.ts's coercion
 * guard only recognized the "high < low" sentinel + an `entry_indicator`
 * starting with "archetype:" — it did NOT know about spec-onboarding-service.ts's
 * newer dispatch markers (`archetype_dispatch:<key>` / `spec_conditions:<hash>`),
 * which `buildDirectionalEntries()` (spec-onboarding-service.ts:312-336) stamps
 * onto BOTH entry_long and entry_short when direction="both". Because the
 * coercion guard didn't recognize those markers, it treated
 * `entry_long === entry_short === <dispatch marker>` as a genuinely-ambiguous
 * duplicated grammar expression and silently coerced direction="both" down to
 * direction="long" (entry_short blanked to ""), amputating the short side of
 * every affected spec-onboarded strategy.
 *
 * VERIFIED handler-driven (Phase 1 audit, 2026-07-04): the engine genuinely
 * emits both long AND short signals for these markers — this is not cosmetic
 * preservation of a label.
 *   - `spec_conditions:<hash>` dispatches to SpecConditionStrategy. When
 *     `spec.direction == "both"`, `src/engine/spec_condition_compiler.py:356-368`
 *     computes `entry_long = entry_signal & wait_bias_bull` and
 *     `entry_short = entry_signal & ~wait_bias_bull` from a real EMA-slope bias
 *     proxy — both sides are genuinely evaluated per bar, not a single side
 *     duplicated under two names.
 *   - `archetype_dispatch:<key>` dispatches to an ARCHETYPE_CLASS_MAP strategy
 *     class via `src/engine/archetype_evaluator.py`. Those classes (e.g.
 *     `src/engine/strategies/bounce_off_level.py::compute()`) evaluate each
 *     side with its own bar-by-bar logic and gate on the handler's own
 *     `direction` field (`if self.direction in ("floor","both")` /
 *     `("ceiling","both")`) — so when direction is `"both"` BOTH sides fire,
 *     from independent per-bar signals rather than a duplicated boolean. Same
 *     contract as the pre-existing "archetype:" `entry_indicator` prefix this
 *     helper also recognizes.
 *
 * A "handler-driven" entry is one where the ENGINE (not grammar-text
 * comparison) determines which bar is long vs short at runtime. The compiler
 * layer cannot distinguish handler-driven identical-marker text from a
 * genuinely-ambiguous duplicated grammar entry (e.g. "close > sma_20" on both
 * sides) by looking at the string alone UNLESS it recognizes the marker
 * convention below. This helper is the single source of truth for that
 * recognition so the two guards can never drift apart again — any new
 * dispatch-marker convention must be added HERE, not independently in each
 * call site.
 */

const BIDIR_SENTINEL = "high < low";
const DISPATCH_MARKER_PREFIXES = ["archetype_dispatch:", "spec_conditions:"];

export function isHandlerDrivenEntry(
  entryLong: string | null | undefined,
  entryShort: string | null | undefined,
  entryIndicator?: string | null,
): boolean {
  const el = (entryLong ?? "").trim();
  const es = (entryShort ?? "").trim();

  // Archetype sentinel — the structural-detector handler emits real long AND
  // short signals at runtime; "high < low" on both sides is a deliberate
  // never-true placeholder (CLAUDE.md §2b pinned fact), not incoherence.
  if (el === BIDIR_SENTINEL && es === BIDIR_SENTINEL) return true;

  // entry_indicator explicitly names an archetype — handler owns detection.
  if (typeof entryIndicator === "string" && entryIndicator.startsWith("archetype:")) return true;

  // Dispatch markers — identical marker text on both sides is NOT grammar
  // ambiguity; it's the spec-onboarding convention meaning "the engine handler
  // (SpecConditionStrategy or an ARCHETYPE_CLASS_MAP strategy class) computes
  // entry_long and entry_short independently at runtime from
  // spec.direction=='both'", not a single duplicated boolean expression.
  if (el && es && el === es && DISPATCH_MARKER_PREFIXES.some((prefix) => el.startsWith(prefix))) {
    return true;
  }

  return false;
}
