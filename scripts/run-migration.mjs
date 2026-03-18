import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=");
const sql = postgres(dbUrl);

const migration = readFileSync("src/server/db/migrations/0005_paper_signal_log.sql", "utf-8");

try {
  await sql.unsafe(migration);
  console.log("Migration 0005 applied successfully");
  await sql.end();
} catch (e) {
  console.error("Migration error:", e.message);
  await sql.end();
  process.exit(1);
}
