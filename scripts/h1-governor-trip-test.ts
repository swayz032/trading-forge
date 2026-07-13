/**
 * h1-governor-trip-test.ts — ENGAGEMENT PROOF for the extraction token governor.
 *
 * Per the frontier pre-reg Addendum 3: "nothing calls OpenAI until the governor
 * demonstrably trips on a synthetic budget." This script proves the WALL trips —
 * fail-closed — on every dangerous path, BEFORE any real metered call exists.
 *
 * Run: npx tsx scripts/h1-governor-trip-test.ts   (exit 0 = proven, non-0 = FAIL)
 */
import {
  evaluateExtractionBudget,
  assertExtractionBudgetOrThrow,
  resolveExtractionPartition,
  resolvePoolPartition,
  getExtractionTokensSpentToday,
  measured7DayPull,
  startOfUtcDay,
  EXTRACTION_DAILY_PARTITION_DEFAULT,
  POOLS,
} from "../src/server/lib/extraction-token-governor";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    failures++;
  }
}

async function main() {
  console.log("=== EXTRACTION TOKEN GOVERNOR — synthetic trip test ===");

  // 1. WITHIN budget -> allow
  const ok = evaluateExtractionBudget({ tokensSpentToday: 500_000, requestedTokens: 100_000, partitionCap: 1_000_000 });
  check("within-budget allows", ok.allow === true && ok.remaining === 400_000);

  // 2. THE TRIP: synthetic tiny budget, request that breaches -> REFUSE (the wall)
  const trip = evaluateExtractionBudget({ tokensSpentToday: 90, requestedTokens: 20, partitionCap: 100 });
  check("synthetic-budget TRIP refuses (90+20 > 100)", trip.allow === false && /fail-closed wall/.test(trip.reason));

  // 3. EXACT-boundary is allowed (<=, not <)
  const edge = evaluateExtractionBudget({ tokensSpentToday: 80, requestedTokens: 20, partitionCap: 100 });
  check("exact-boundary allowed (100/100)", edge.allow === true && edge.remaining === 0);

  // 4. FAIL-CLOSED: cap <= 0 means STOP, never "unlimited"
  check("cap=0 refuses (disabled=stop)", evaluateExtractionBudget({ tokensSpentToday: 0, requestedTokens: 1, partitionCap: 0 }).allow === false);

  // 5. FAIL-CLOSED: non-finite / negative inputs refuse
  check("NaN spend refuses", evaluateExtractionBudget({ tokensSpentToday: NaN, requestedTokens: 1, partitionCap: 100 }).allow === false);
  check("negative request refuses", evaluateExtractionBudget({ tokensSpentToday: 0, requestedTokens: -5, partitionCap: 100 }).allow === false);

  // 6. The WALL throws on breach
  let threw = false;
  try { assertExtractionBudgetOrThrow({ tokensSpentToday: 999_999, requestedTokens: 100, partitionCap: 1_000_000 }); }
  catch { threw = true; }
  check("assert wall THROWS on breach", threw);

  // 7. malformed env override resolves to 0 (fail-closed), not the big default
  const saved = process.env.TF_EXTRACTION_DAILY_TOKEN_CAP;
  process.env.TF_EXTRACTION_DAILY_TOKEN_CAP = "not-a-number";
  check("malformed env cap -> 0 (fail-closed)", resolveExtractionPartition() === 0);
  delete process.env.TF_EXTRACTION_DAILY_TOKEN_CAP;
  check("absent env cap -> default 1M", resolveExtractionPartition() === EXTRACTION_DAILY_PARTITION_DEFAULT);
  if (saved !== undefined) process.env.TF_EXTRACTION_DAILY_TOKEN_CAP = saved;

  // 8. DB reader FAIL-CLOSED: a throwing query propagates (never proceeds on unknown spend)
  const now = new Date(Date.UTC(2026, 6, 13, 15, 0, 0));
  let readerThrew = false;
  try { await getExtractionTokensSpentToday(async () => { throw new Error("db down"); }, now); }
  catch { readerThrew = true; }
  check("spend-reader propagates DB error (fail-closed)", readerThrew);

  // 9. DB reader FAIL-CLOSED: null result throws
  let nullThrew = false;
  try { await getExtractionTokensSpentToday(async () => null, now); }
  catch { nullThrew = true; }
  check("spend-reader null-result throws (fail-closed)", nullThrew);

  // 10. DB reader happy path + correct UTC-day boundary
  const spend = await getExtractionTokensSpentToday(async (sinceIso) => {
    check("reader queries from UTC start-of-day", sinceIso === startOfUtcDay(now).toISOString());
    return { totalTokens: 250_000 };
  }, now);
  check("reader returns measured spend", spend === 250_000);

  // 11. TWO-PATH: designed (7 x cap) vs measured 7-day pull
  const report = await measured7DayPull(async () => ({ totalTokens: 3_500_000 }), now, 1_000_000);
  check("two-path designed ceiling = 7M", report.designed7DayCeiling === 7_000_000);
  check("two-path measured within designed", report.measuredWithinDesigned === true && Math.abs(report.utilization - 0.5) < 1e-9);
  const over = await measured7DayPull(async () => ({ totalTokens: 9_000_000 }), now, 1_000_000);
  check("two-path ALARMS when measured > designed", over.measuredWithinDesigned === false);

  // 12. TWO POOLS: mini partition = 1M, gpt54 partition = 200K (reserve 50K held back)
  check("mini pool partition = 1M", resolvePoolPartition("mini") === 1_000_000);
  check("gpt54 pool partition = 200K", resolvePoolPartition("gpt54") === 200_000);
  check("gpt54 pool total = 250K, reserve = 50K (critique headroom)", POOLS.gpt54.poolDaily === 250_000 && POOLS.gpt54.reserve === 50_000);
  // extraction on gpt54 is walled at 200K even though the pool holds 250K -> reserve protected
  const gpt54Wall = evaluateExtractionBudget({ tokensSpentToday: 190_000, requestedTokens: 20_000, partitionCap: resolvePoolPartition("gpt54") });
  check("gpt54 extraction TRIPS at 200K, never touches 50K critique reserve", gpt54Wall.allow === false);
  // 13. FAIL-CLOSED: an env override trying to claim the reserve is clamped to pool-minus-reserve
  const savedG = process.env.TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP;
  process.env.TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP = "240000"; // > 200K, would eat reserve
  check("gpt54 override cannot claim critique reserve (clamped to 200K)", resolvePoolPartition("gpt54") === 200_000);
  process.env.TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP = "not-a-number";
  check("gpt54 malformed override -> 0 (fail-closed)", resolvePoolPartition("gpt54") === 0);
  if (savedG !== undefined) process.env.TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP = savedG;
  else delete process.env.TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP;

  console.log(failures === 0
    ? "\nGOVERNOR PROVEN — wall trips fail-closed on every dangerous path. Metered calls may now be wired behind it."
    : `\n${failures} CHECK(S) FAILED — governor NOT proven; no metered call may be wired.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
