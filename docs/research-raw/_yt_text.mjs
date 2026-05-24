#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const files = fs.readdirSync(dir).filter((f) => f.startsWith("yt") && f.endsWith(".json")).sort();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  console.log(`\n========== ${f} (${j.url}) ==========`);
  // text is full concat
  const text = (j.text ?? "").replace(/\s+/g, " ").trim();
  // Cap at ~6000 chars per video so we can read all 5 within budget
  console.log(text.slice(0, 6000));
  console.log(`...[truncated, total len=${text.length}]`);
}
