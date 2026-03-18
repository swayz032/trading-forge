import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=");
const sql = postgres(dbUrl);

try {
  // Delete ALL backtests and related data (clean slate)
  await sql`DELETE FROM monte_carlo_runs`;
  await sql`DELETE FROM stress_test_runs`;
  await sql`DELETE FROM backtest_trades`;
  await sql`UPDATE system_journal SET backtest_id = NULL WHERE backtest_id IS NOT NULL`;
  await sql`DELETE FROM backtests`;
  console.log("Cleaned all backtests + related data");
  await sql.end();
} catch (e) {
  console.error("Error:", e.message);
  await sql.end();
  process.exit(1);
}
