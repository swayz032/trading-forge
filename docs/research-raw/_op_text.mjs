import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const files = ["op01.json","op02.json","op03.json","op04.json"];
for (const f of files) {
  if (!fs.existsSync(path.join(dir, f))) continue;
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  console.log(`\n========== ${f} (${j.url}) ==========`);
  const text = (j.text ?? "").replace(/\s+/g, " ").trim();
  console.log(`[FULL LEN=${text.length}]`);
  // Show first 8000 chars
  console.log(text.slice(0, 8000));
  console.log("\n...[MID-MARKER]...");
  // Middle
  const mid = Math.floor(text.length / 2);
  console.log(text.slice(mid, mid + 3000));
  console.log("\n...[END-MARKER]...");
  // Last 3000
  console.log(text.slice(-3000));
}
