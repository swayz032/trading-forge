/**
 * carter-code.ts — Carter's code-draft capability (Wave B3).
 *
 * `save_code_draft` lets Carter (the EL GPT-5.4 brain) turn a proposed fix/improvement
 * into a REAL reviewable artifact: an isolated draft branch + draft PR — for the
 * operator to review. It NEVER merges, NEVER force-pushes, and NEVER touches a
 * protected branch or a protected path. The draft IS the review gate; nothing in the
 * live system changes until the operator reviews + merges on GitHub.
 *
 * SHARED-TREE SAFETY: the tower's main working tree is shared with the operator + other
 * sessions. This tool therefore does ALL its work in an ISOLATED `git worktree` off the
 * committed HEAD — it never `git checkout`s a branch in the live tree, so it can't
 * disturb in-flight work. The worktree is removed in a finally block.
 *
 * Tier: GREEN action, but the system prompt requires Carter to read back the plan and
 * get a spoken go-ahead before calling it (drafting code is the one action he always
 * confirms). Worst case if he doesn't: a harmless extra draft branch the operator
 * ignores or deletes.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

// src/server/lib/carter/carter-code.ts → repo root is four levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const PROTECTED_BRANCHES = new Set([
  "main", "master", "hardening/phase-0", "develop", "production", "release",
]);
const DRAFT_PREFIX = "carter/draft-";
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 256 * 1024; // 256 KB across all files
// Never let a draft write secrets, git internals, deps, or build output.
const FORBIDDEN_PATH =
  /(^|\/)\.git(\/|$)|(^|\/)node_modules(\/|$)|(^|\/)\.env|\.env$|(^|\/)data(\/|$)|\.(pem|key|p12|pfx)$|secret|credential/i;

interface DraftFile {
  path: string;
  content: string;
}
interface SaveCodeDraftParams {
  summary?: string;
  rationale?: string;
  files?: DraftFile[];
}

async function git(args: string[], cwd: string): Promise<string> {
  // `-c safe.directory=*` (per-invocation, not persisted) avoids git's "dubious
  // ownership" refusal — the TradingForgeAPI service can run as a different Windows
  // user than the repo owner, and worktrees live in TEMP. Read-only trust flag.
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c", "safe.directory=*",
      // The service account has no git identity; stamp drafts as Carter so the
      // commit author is clear and the commit doesn't fail with "unknown author".
      "-c", "user.name=Carter (Trading Forge voice agent)",
      "-c", "user.email=carter@trading-forge.local",
      // Push over HTTPS using gh's authenticated credential helper — the service
      // account has no SSH key/known_hosts, so the SSH `origin` fails host-key
      // verification. gh is logged in (keyring); this lets HTTPS pushes work.
      "-c", "credential.helper=!gh auth git-credential",
      ...args,
    ],
    { cwd, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "draft";
}

/**
 * save_code_draft — create an isolated draft branch + draft PR from Carter-authored
 * files. GREEN, reversible, never merges. Returns the branch + PR/compare URLs.
 */
async function saveCodeDraft(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as SaveCodeDraftParams;

  // ── validate ────────────────────────────────────────────────────────────────
  if (!p.summary || typeof p.summary !== "string") return { error: "summary is required" };
  if (!Array.isArray(p.files) || p.files.length === 0) return { error: "files (non-empty array) is required" };
  if (p.files.length > MAX_FILES) return { error: `too_many_files (max ${MAX_FILES})` };

  let totalBytes = 0;
  const cleanRelPaths: string[] = [];
  for (const f of p.files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
      return { error: "each file needs string {path, content}" };
    }
    const rel = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rel.includes("..")) return { error: `path_traversal_refused: ${f.path}` };
    if (FORBIDDEN_PATH.test(rel)) return { error: `forbidden_path: ${f.path}` };
    const abs = resolve(REPO_ROOT, rel);
    if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) {
      return { error: `path_outside_repo: ${f.path}` };
    }
    totalBytes += Buffer.byteLength(f.content, "utf8");
    cleanRelPaths.push(rel);
  }
  if (totalBytes > MAX_TOTAL_BYTES) return { error: `draft_too_large (${totalBytes} > ${MAX_TOTAL_BYTES} bytes)` };

  // ── branch + base ─────────────────────────────────────────────────────────────
  const branch = `${DRAFT_PREFIX}${slugify(p.summary)}-${Date.now().toString(36)}`;
  if (PROTECTED_BRANCHES.has(branch) || !branch.startsWith(DRAFT_PREFIX)) {
    return { error: "refused_unsafe_branch" };
  }
  let baseBranch = "hardening/phase-0";
  try {
    baseBranch = await git(["rev-parse", "--abbrev-ref", "HEAD"], REPO_ROOT);
  } catch {
    /* fall back to default base */
  }

  // ── isolated worktree (never touches the live tree) ─────────────────────────────
  let wt: string | null = null;
  try {
    wt = await mkdtemp(join(tmpdir(), "carter-draft-"));
    await git(["worktree", "add", "-b", branch, wt, "HEAD"], REPO_ROOT);

    for (let i = 0; i < p.files.length; i++) {
      const rel = cleanRelPaths[i];
      const dest = join(wt, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, p.files[i].content, "utf8");
      await git(["add", "--", rel], wt);
    }

    const body =
      `${p.rationale ?? ""}\n\n— Drafted by Carter (voice agent) for review. ` +
      `Do NOT merge without review. Nothing in the live system has changed.`;
    await git(["commit", "-m", `carter draft: ${p.summary}`, "-m", body, "--no-verify"], wt);
    await git(["push", "https://github.com/swayz032/trading-forge.git", branch], wt);

    // Draft PR (best-effort — branch is pushed regardless).
    let prUrl: string | null = null;
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr", "create", "--draft", "--head", branch, "--base", baseBranch,
          "--title", `Carter draft: ${p.summary}`, "--body", body,
        ],
        // GIT_CONFIG_* injects safe.directory=* into gh's internal git (same
        // dubious-ownership avoidance as the git() helper above).
        {
          cwd: wt,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" },
        },
      );
      prUrl = stdout.trim() || null;
    } catch {
      prUrl = null;
    }

    logger.info({ branch, base: baseBranch, files: cleanRelPaths.length }, "carter: code draft created");
    return {
      ok: true,
      branch,
      base: baseBranch,
      prUrl,
      compareUrl: `https://github.com/swayz032/trading-forge/compare/${baseBranch}...${branch}?expand=1`,
      filesWritten: cleanRelPaths,
      note:
        "Draft branch pushed for your review. It is NOT merged and nothing in the live " +
        "system changed. Review (and merge, if good) on GitHub.",
    };
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "carter: save_code_draft failed");
    return { error: "code_draft_failed", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  } finally {
    if (wt) {
      try { await git(["worktree", "remove", "--force", wt], REPO_ROOT); } catch { /* best effort */ }
      try { await rm(wt, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

/** Carter code-draft action handlers (merged into CARTER_ACTION_HANDLERS). */
export const CARTER_CODE_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  save_code_draft: saveCodeDraft,
};
