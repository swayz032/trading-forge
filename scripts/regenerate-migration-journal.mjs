#!/usr/bin/env node
/**
 * Regenerate _journal.json to include every .sql file in src/server/db/migrations/.
 * Preserves existing entries and timestamps; appends missing ones with sequential timestamps.
 * Backs up the old journal before writing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "src/server/db/migrations");
const journalPath = path.join(migrationsDir, "meta/_journal.json");
const backupPath = path.join(migrationsDir, "meta/_journal.backup.json");

const sqlFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const existingByTag = new Map(journal.entries.map((e) => [e.tag, e]));

// Backup
fs.writeFileSync(backupPath, JSON.stringify(journal, null, 2));
console.log(`Backed up old journal -> ${backupPath}`);

const lastWhen = Math.max(...journal.entries.map((e) => e.when));
let nextWhen = lastWhen;

const newEntries = [];
let idx = 0;
for (const file of sqlFiles) {
  const tag = file.replace(/\.sql$/, "");
  if (existingByTag.has(tag)) {
    const e = existingByTag.get(tag);
    newEntries.push({ ...e, idx });
  } else {
    nextWhen += 10_000_000;
    newEntries.push({
      idx,
      version: "7",
      when: nextWhen,
      tag,
      breakpoints: true,
    });
    console.log(`+ added missing entry: ${tag} (idx=${idx}, when=${nextWhen})`);
  }
  idx++;
}

const newJournal = {
  version: "7",
  dialect: "postgresql",
  entries: newEntries,
};

fs.writeFileSync(journalPath, JSON.stringify(newJournal, null, 2));
console.log(`Wrote ${newEntries.length} entries to journal (was ${journal.entries.length})`);
