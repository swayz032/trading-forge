import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });

const key = process.env.ANAM_API_KEY;
if (!key) { console.error("ANAM_API_KEY missing"); process.exit(1); }

const res = await fetch("https://api.anam.ai/v1/personas", {
  headers: { Authorization: `Bearer ${key}` },
});
const body = await res.text();
console.log(`HTTP ${res.status}`);
try {
  const j = JSON.parse(body);
  const arr = Array.isArray(j) ? j : (j.data ?? j.personas ?? j.items ?? []);
  if (!arr.length) { console.log("No personas returned. Raw:"); console.log(body.slice(0, 2000)); }
  else for (const p of arr) {
    console.log(`\nid:    ${p.id ?? p.personaId ?? "?"}`);
    console.log(`name:  ${p.name ?? p.displayName ?? "?"}`);
    if (p.brandName) console.log(`brand: ${p.brandName}`);
    if (p.createdAt) console.log(`created: ${p.createdAt}`);
  }
} catch {
  console.log(body.slice(0, 2000));
}
