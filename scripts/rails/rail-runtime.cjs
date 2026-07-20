"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadEnvironment(repoDir) {
  // ONE shared resolver (scripts/lib/env-resolve.cjs): honours BOTH override names, covers
  // the NESTED canonical checkout, and — post-grade — accepts a candidate only when dotenv
  // reports no error AND DATABASE_URL is actually populated. Returns {path, loaded, reason,
  // tried} so a caller can REPORT which file won; paths and reason codes only, no values.
  const { loadEnvFile } = require("../lib/env-resolve.cjs");
  return loadEnvFile({
    cwd: repoDir,
    moduleDir: __dirname,
    preferVar: "RAILS_ENV_PATH",   // this job's own override outranks the sibling name
    requireVars: ["DATABASE_URL"], // a .env that cannot supply this is not the one we want
  });
}



function appendLedger(repoDir, rail, payload) {
  const dataDir = path.join(repoDir, "data", "rails");
  fs.mkdirSync(dataDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const file = path.join(dataDir, `${rail}-${date}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`);
  return file;
}

async function writeAudit(action, payload) {
  if (!process.env.DATABASE_URL) {
    return { ok: false, reason: "database_url_missing" };
  }
  let postgres;
  try {
    postgres = require("postgres");
  } catch (error) {
    return { ok: false, reason: `postgres_module_unavailable:${error.message}` };
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 8 });
  try {
    await sql`INSERT INTO audit_log (action, status, decision_authority, result)
              VALUES (${action}, 'success', 'scheduler', ${sql.json(payload)})`;
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `audit_insert_failed:${error.message}` };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function postDiscord(content) {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    return { ok: false, reason: "discord_webhook_missing" };
  }
  try {
    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { ok: false, reason: `discord_http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `discord_failed:${error.message}` };
  }
}

async function persistRailRun({ repoDir, rail, action, payload, message, notify, dryRun }) {
  const ledgerPayload = {
    recordedAt: new Date().toISOString(),
    dryRun,
    ...payload,
  };
  const ledgerFile = appendLedger(repoDir, rail, ledgerPayload);
  if (dryRun) {
    return { ok: true, ledgerFile, audit: { ok: true, dryRun: true }, discord: { ok: true, dryRun: true } };
  }

  loadEnvironment(repoDir);
  const audit = await writeAudit(action, ledgerPayload);
  let discord = { ok: true, skipped: true };
  if (notify) {
    discord = await postDiscord(message);
  }
  if (!audit.ok && process.env.DISCORD_WEBHOOK_URL) {
    await postDiscord(`RED Tower Rails persistence failure: ${audit.reason}`);
  }
  return { ok: audit.ok && discord.ok, ledgerFile, audit, discord };
}

module.exports = {
  appendLedger,
  loadEnvironment,
  persistRailRun,
  postDiscord,
  writeAudit,
};
