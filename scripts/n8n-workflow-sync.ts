/**
 * n8n Workflow Sync — fetches active workflows from n8n API and writes
 * them to workflows/n8n/ with drift detection (added / modified / removed).
 *
 * Env: N8N_BASE_URL, N8N_API_KEY
 * Usage: npx tsx scripts/n8n-workflow-sync.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.resolve(__dirname, "../workflows/n8n");

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown[];
  connections: unknown;
  updatedAt: string;
  [key: string]: unknown;
}

interface N8nListResponse {
  data: N8nWorkflow[];
  nextCursor?: string;
}

async function fetchAllWorkflows(baseUrl: string, apiKey: string): Promise<N8nWorkflow[]> {
  const all: N8nWorkflow[] = [];
  let cursor: string | undefined;

  // Handle paginated n8n API responses
  do {
    const url = new URL(`${baseUrl}/api/v1/workflows`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url.toString(), {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as N8nListResponse;
    all.push(...body.data);
    cursor = body.nextCursor;
  } while (cursor);

  return all;
}

async function main() {
  const baseUrl = process.env.N8N_BASE_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error("N8N_BASE_URL and N8N_API_KEY required");
    process.exit(1);
  }

  // Fetch all workflows from n8n
  const workflows = await fetchAllWorkflows(baseUrl, apiKey);

  // Only sync active workflows (skip archived)
  const active = workflows.filter((w) => w.active);
  console.log(`Found ${active.length} active workflows (${workflows.length} total)`);

  // Ensure output directory exists
  if (!fs.existsSync(WORKFLOW_DIR)) fs.mkdirSync(WORKFLOW_DIR, { recursive: true });

  // Track what's on disk before sync
  const existingFiles = new Set(
    fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".json")),
  );
  const writtenFiles = new Set<string>();
  const changes = {
    added: [] as string[],
    modified: [] as string[],
    unchanged: [] as string[],
  };

  for (const wf of active) {
    const safeName = wf.name
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_");
    const filename = `${safeName}_${wf.id}.json`;
    const filepath = path.join(WORKFLOW_DIR, filename);
    writtenFiles.add(filename);

    const newContent = JSON.stringify(wf, null, 2);

    if (fs.existsSync(filepath)) {
      const oldContent = fs.readFileSync(filepath, "utf-8");
      if (oldContent !== newContent) {
        changes.modified.push(wf.name);
        fs.writeFileSync(filepath, newContent);
      } else {
        changes.unchanged.push(wf.name);
      }
    } else {
      changes.added.push(wf.name);
      fs.writeFileSync(filepath, newContent);
    }
  }

  // Detect removed workflows (on disk but not in n8n)
  const removed: string[] = [];
  for (const file of existingFiles) {
    if (!writtenFiles.has(file)) {
      removed.push(file);
    }
  }

  // Summary
  console.log("\n=== n8n Workflow Sync Summary ===");
  console.log(`Added:     ${changes.added.length}`);
  console.log(`Modified:  ${changes.modified.length}`);
  console.log(`Unchanged: ${changes.unchanged.length}`);
  console.log(`Removed (on disk only): ${removed.length}`);

  if (changes.added.length > 0) console.log("\nAdded:", changes.added);
  if (changes.modified.length > 0) console.log("\nModified:", changes.modified);
  if (removed.length > 0) console.log("\nRemoved:", removed);

  // Exit with code 0 — changes detected is informational, not an error
  if (
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    removed.length > 0
  ) {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("n8n sync failed:", err);
  process.exit(1);
});
