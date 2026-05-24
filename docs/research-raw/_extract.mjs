#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const lines = [];
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  lines.push(`\n=== ${f} ===`);
  if (data.query) lines.push(`query: ${data.query}`);
  // Web research format: { sources: [{source, items}] }
  if (data.sources) {
    for (const s of data.sources) {
      if (s.error) { lines.push(`  [${s.source}] ERROR: ${s.error.slice(0, 150)}`); continue; }
      const top = (s.items ?? []).slice(0, 8);
      for (const it of top) {
        const date = it.published_at?.slice(0, 10) ?? "no-date";
        const ttl = (it.title ?? "").slice(0, 110);
        const sn = (it.snippet ?? "").replace(/\s+/g, " ").slice(0, 220);
        lines.push(`  [${s.source}] ${date} | ${ttl}`);
        if (sn) lines.push(`         ${sn}`);
        lines.push(`         ${it.url}`);
        if (it.video_id) lines.push(`         VIDEO_ID=${it.video_id} CH=${it.channel ?? ""}`);
      }
    }
  }
  // Reddit format: { items: [...] }
  if (data.source === "reddit") {
    lines.push(`subreddit: r/${data.subreddit}`);
    const top = (data.items ?? []).slice(0, 10);
    for (const it of top) {
      const date = it.published_at?.slice(0, 10) ?? "no-date";
      const ttl = (it.title ?? "").slice(0, 110);
      const sn = (it.snippet ?? "").replace(/\s+/g, " ").slice(0, 260);
      lines.push(`  [reddit] ${date} score=${it.score} comments=${it.num_comments} | ${ttl}`);
      if (sn) lines.push(`         ${sn}`);
      lines.push(`         ${it.url}`);
    }
  }
}
console.log(lines.join("\n"));
