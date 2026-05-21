/**
 * C6 — Credential Loader (Bitwarden CLI vault integration)
 *
 * Loads sensitive credentials from the Bitwarden CLI vault at startup.
 * Falls back to environment variables when vault mode is disabled (default).
 *
 * Vault mode: set TF_VAULT_MODE=bitwarden in .env (the only key that MUST
 * remain in .env when vault is active). When vault mode is active, the
 * system FAILS CLOSED if the vault is unreachable — no silent env-var fallback
 * for secrets. Non-secret config (PORT, NODE_ENV, LOG_LEVEL, etc.) always
 * reads from env-vars regardless of vault mode.
 *
 * Bitwarden CLI setup: https://bitwarden.com/help/cli/
 *   bw login
 *   bw unlock  (sets BW_SESSION env var)
 *   bw get item "Trading Forge" --session $BW_SESSION
 *
 * Item structure expected in Bitwarden:
 *   Name: "Trading Forge — <credential-name>"
 *   Type: Login (username = credential key, password = credential value)
 *   OR
 *   Type: Secure Note with custom fields: key = credential name, value = secret
 *
 * For bulk load we use: bw list items --folderid <TRADING_FORGE_FOLDER_ID>
 * Each item must have a custom field named "key" and "value".
 *
 * SECURITY CONTRACT:
 * - This module NEVER logs credential values, only key names.
 * - BW_SESSION token is never written to any log or error message.
 * - On vault failure in vault mode: process.exit(1) with structured error.
 *   This is intentional fail-closed behavior — a degraded credential load
 *   is MORE dangerous than a clean shutdown.
 */

import { execFileSync, ExecFileSyncOptions } from "child_process";
import { logger as rootLogger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Vault loading modes */
export type VaultMode = "env" | "bitwarden";

/** Result of a vault credential load */
export type VaultLoadResult = {
  mode: VaultMode;
  loaded: number;            // count of credentials loaded from vault
  missing: string[];         // credentials that were expected but not found
  durationMs: number;
};

/** Bitwarden CLI item structure (simplified — only fields we use) */
interface BwItem {
  id: string;
  name: string;
  type: number;              // 1=login, 2=secureNote
  notes?: string | null;
  fields?: Array<{ name: string; value: string | null }>;
  login?: {
    username?: string | null;
    password?: string | null;
  };
}

// ─── Credential registry ─────────────────────────────────────────────────────

/**
 * Credentials that the vault should supply when in bitwarden mode.
 * Non-secret config (PORT, NODE_ENV, LOG_LEVEL, MAX_PYTHON_SUBPROCESSES, etc.)
 * is intentionally excluded — only API keys and connection strings are vaulted.
 *
 * Each entry: { envKey: string, bwFieldName: string, required: boolean }
 */
const VAULT_CREDENTIALS: ReadonlyArray<{
  envKey: string;
  bwFieldName: string;
  required: boolean;
}> = [
  // ─── Database ──────────────────────────────────────────────
  { envKey: "DATABASE_URL",           bwFieldName: "DATABASE_URL",           required: true  },

  // ─── AWS ──────────────────────────────────────────────────
  { envKey: "AWS_ACCESS_KEY_ID",      bwFieldName: "AWS_ACCESS_KEY_ID",      required: false },
  { envKey: "AWS_SECRET_ACCESS_KEY",  bwFieldName: "AWS_SECRET_ACCESS_KEY",  required: false },

  // ─── Data providers ────────────────────────────────────────
  { envKey: "DATABENTO_API_KEY",      bwFieldName: "DATABENTO_API_KEY",      required: false },
  { envKey: "ALPHA_VANTAGE_API_KEY",  bwFieldName: "ALPHA_VANTAGE_API_KEY",  required: false },
  { envKey: "MASSIVE_API_KEY",        bwFieldName: "MASSIVE_API_KEY",        required: false },

  // ─── AI / Cloud ────────────────────────────────────────────
  { envKey: "OPENAI_API_KEY",         bwFieldName: "OPENAI_API_KEY",         required: false },
  { envKey: "IBM_QUANTUM_TOKEN",      bwFieldName: "IBM_QUANTUM_TOKEN",      required: false },

  // ─── Scout / Search ────────────────────────────────────────
  { envKey: "BRAVE_API_KEY",          bwFieldName: "BRAVE_API_KEY",          required: false },
  { envKey: "BRAVE_SEARCH_API_KEY",   bwFieldName: "BRAVE_SEARCH_API_KEY",   required: false },
  { envKey: "TAVILY_API_KEY",         bwFieldName: "TAVILY_API_KEY",         required: false },
  { envKey: "EXA_API_KEY",            bwFieldName: "EXA_API_KEY",            required: false },
  { envKey: "PARALLEL_API_KEY",       bwFieldName: "PARALLEL_API_KEY",       required: false },
  { envKey: "OPENCLAW_GATEWAY_TOKEN", bwFieldName: "OPENCLAW_GATEWAY_TOKEN", required: false },

  // ─── Orchestration ─────────────────────────────────────────
  { envKey: "N8N_API_KEY",            bwFieldName: "N8N_API_KEY",            required: false },

  // ─── Discord ───────────────────────────────────────────────
  { envKey: "DISCORD_BOT_TOKEN",      bwFieldName: "DISCORD_BOT_TOKEN",      required: false },

  // ─── Auth gate ─────────────────────────────────────────────
  { envKey: "API_KEY",                bwFieldName: "API_KEY",                required: false },

  // ─── Macro data ────────────────────────────────────────────
  { envKey: "FRED_API_KEY",           bwFieldName: "FRED_API_KEY",           required: false },
  { envKey: "BLS_API_KEY",            bwFieldName: "BLS_API_KEY",            required: false },
  { envKey: "EIA_API_KEY",            bwFieldName: "EIA_API_KEY",            required: false },

  // ─── Supadata ──────────────────────────────────────────────
  { envKey: "SUPADATA_API_KEY",       bwFieldName: "SUPADATA_API_KEY",       required: false },
] as const;

// ─── Module-level state ──────────────────────────────────────────────────────

let _vaultLoadResult: VaultLoadResult | null = null;
let _vaultMode: VaultMode = "env";

// ─── Vault mode detection ────────────────────────────────────────────────────

/**
 * Determine the active vault mode from environment variables.
 * TF_VAULT_MODE=bitwarden activates Bitwarden CLI.
 * Any other value (or unset) → env mode (default, backwards-compatible).
 */
export function getVaultMode(): VaultMode {
  const raw = process.env.TF_VAULT_MODE?.toLowerCase().trim();
  if (raw === "bitwarden") return "bitwarden";
  return "env";
}

// ─── Bitwarden CLI helpers ────────────────────────────────────────────────────

/**
 * Execute a Bitwarden CLI command synchronously.
 * Returns stdout as string, throws on non-zero exit.
 *
 * SECURITY: BW_SESSION is passed via env, never via command args.
 * Timeout: 15 seconds — vault must respond promptly at startup.
 */
function execBw(args: string[], bwSession: string): string {
  const opts: ExecFileSyncOptions = {
    timeout: 15_000,
    env: {
      ...process.env,
      BW_SESSION: bwSession,   // credential passed via env, not args — never logged
    },
    // Don't inherit stdin — prevents interactive prompts from hanging startup
    stdio: ["pipe", "pipe", "pipe"],
  };

  try {
    const result = execFileSync("bw", args, opts);
    return result.toString("utf8").trim();
  } catch (err: unknown) {
    const exitErr = err as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer };
    // Strip BW_SESSION from any error message before logging
    const rawMsg = exitErr.message ?? "unknown bw error";
    const safeMsg = rawMsg.replace(/BW_SESSION=[^\s]*/gi, "BW_SESSION=[REDACTED]");
    throw new Error(`Bitwarden CLI error (${args[0] ?? "unknown"}): ${safeMsg}`);
  }
}

/**
 * Validate that the Bitwarden CLI is installed and accessible.
 * Returns the CLI version string on success.
 */
export function checkBitwarden(): string {
  try {
    return execFileSync("bw", ["--version"], {
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString("utf8").trim();
  } catch {
    throw new VaultUnavailableError(
      "Bitwarden CLI (bw) not found. Install from https://bitwarden.com/help/cli/ or via npm install -g @bitwarden/cli"
    );
  }
}

/**
 * Check vault lock status. Returns true if unlocked (session is valid).
 */
export function checkVaultUnlocked(bwSession: string): boolean {
  try {
    const status = execBw(["status"], bwSession);
    const parsed = JSON.parse(status) as { status: string };
    return parsed.status === "unlocked";
  } catch {
    return false;
  }
}

/**
 * Load all items from the Bitwarden vault folder designated for Trading Forge.
 * Returns a map of { envKey -> value } for all credentials found.
 *
 * Strategy: list all items in the TF_VAULT_FOLDER_ID folder, then extract
 * custom fields named by bwFieldName from VAULT_CREDENTIALS.
 *
 * Fallback strategy: if no folder is configured, search by item name prefix
 * "TradingForge." using list + filter.
 */
function loadFromBitwarden(bwSession: string): Map<string, string> {
  const folderId = process.env.TF_VAULT_FOLDER_ID;
  const credentials = new Map<string, string>();

  let items: BwItem[];

  try {
    let raw: string;
    if (folderId) {
      raw = execBw(["list", "items", "--folderid", folderId], bwSession);
    } else {
      // No folder configured — list all items and filter by name prefix
      raw = execBw(["list", "items", "--search", "TradingForge."], bwSession);
    }

    items = JSON.parse(raw) as BwItem[];
  } catch (err) {
    throw new VaultUnavailableError(
      `Failed to list Bitwarden items: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    // No items found is not necessarily an error in env mode,
    // but in vault mode it means the vault is empty/misconfigured.
    return credentials;
  }

  // Build a lookup: bwFieldName -> value, from all items' custom fields
  const fieldLookup = new Map<string, string>();

  for (const item of items) {
    if (Array.isArray(item.fields)) {
      for (const field of item.fields) {
        if (field.name && field.value !== null && field.value !== undefined) {
          fieldLookup.set(field.name, field.value);
        }
      }
    }

    // Also support Login items where username=key, password=value
    // Convention: item.name = "TradingForge.<FIELD_NAME>"
    if (item.type === 1 && item.login?.username && item.login.password) {
      fieldLookup.set(item.login.username, item.login.password);
    }

    // Also support Secure Note items with JSON body: { "key": "value", ... }
    if (item.type === 2 && item.notes) {
      try {
        const parsed = JSON.parse(item.notes) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === "string" && typeof v === "string") {
            fieldLookup.set(k, v);
          }
        }
      } catch {
        // Not JSON — skip, not all notes are key-value stores
      }
    }
  }

  // Map vault field names to process.env keys
  for (const { envKey, bwFieldName } of VAULT_CREDENTIALS) {
    const value = fieldLookup.get(bwFieldName);
    if (value !== undefined && value !== "") {
      credentials.set(envKey, value);
    }
  }

  return credentials;
}

// ─── Custom error ────────────────────────────────────────────────────────────

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

// ─── Primary API ──────────────────────────────────────────────────────────────

/**
 * Load credentials at startup.
 *
 * In "env" mode (default): no-op. process.env already populated by dotenv
 * in load-env.ts. Returns immediately.
 *
 * In "bitwarden" mode: reads all secrets from Bitwarden CLI, writes them
 * into process.env (overriding any stale env values). If the vault is
 * unavailable or any REQUIRED credential is missing, calls process.exit(1)
 * to enforce fail-closed behavior.
 *
 * Call this once, early in index.ts, BEFORE any module reads process.env
 * for a secret. It is safe to call multiple times (idempotent after first
 * successful load — subsequent calls return the cached result).
 *
 * @param options.exitOnFailure - default true. Set false in tests only.
 */
export async function loadCredentials(options: { exitOnFailure?: boolean } = {}): Promise<VaultLoadResult> {
  const { exitOnFailure = true } = options;
  const startMs = Date.now();

  _vaultMode = getVaultMode();

  if (_vaultMode === "env") {
    const result: VaultLoadResult = {
      mode: "env",
      loaded: 0,
      missing: [],
      durationMs: Date.now() - startMs,
    };
    _vaultLoadResult = result;
    rootLogger.info(
      { vault_mode: "env" },
      "credential-loader: env mode — credentials sourced from .env file"
    );
    return result;
  }

  // ─── Bitwarden mode ──────────────────────────────────────────────────────

  rootLogger.info({ vault_mode: "bitwarden" }, "credential-loader: bitwarden mode — loading from vault");

  // 1. Verify Bitwarden CLI is installed
  let bwVersion: string;
  try {
    bwVersion = checkBitwarden();
    rootLogger.info({ bw_version: bwVersion }, "credential-loader: Bitwarden CLI found");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rootLogger.error(
      { vault_mode: "bitwarden", error: msg },
      "credential-loader: FAIL-CLOSED — Bitwarden CLI unavailable"
    );
    if (exitOnFailure) process.exit(1);
    throw new VaultUnavailableError(msg);
  }

  // 2. BW_SESSION must be set (unlocked vault session token)
  const bwSession = process.env.BW_SESSION;
  if (!bwSession) {
    const msg = "BW_SESSION env var not set. Run: export BW_SESSION=$(bw unlock --raw)";
    rootLogger.error(
      { vault_mode: "bitwarden", error: "BW_SESSION_MISSING" },
      `credential-loader: FAIL-CLOSED — ${msg}`
    );
    if (exitOnFailure) process.exit(1);
    throw new VaultUnavailableError(msg);
  }

  // 3. Verify the session is still valid (vault is unlocked)
  if (!checkVaultUnlocked(bwSession)) {
    const msg = "Bitwarden vault is locked. Run: export BW_SESSION=$(bw unlock --raw)";
    rootLogger.error(
      { vault_mode: "bitwarden", error: "VAULT_LOCKED" },
      `credential-loader: FAIL-CLOSED — ${msg}`
    );
    if (exitOnFailure) process.exit(1);
    throw new VaultUnavailableError(msg);
  }

  // 4. Load credentials from vault
  let vaultCredentials: Map<string, string>;
  try {
    vaultCredentials = loadFromBitwarden(bwSession);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rootLogger.error(
      { vault_mode: "bitwarden", error: msg },
      "credential-loader: FAIL-CLOSED — vault item retrieval failed"
    );
    if (exitOnFailure) process.exit(1);
    throw new VaultUnavailableError(msg);
  }

  // 5. Write vault credentials into process.env, overriding stale .env values
  let loaded = 0;
  for (const [envKey, value] of vaultCredentials.entries()) {
    process.env[envKey] = value;
    loaded++;
  }

  // 6. Check required credentials are present
  const missing: string[] = [];
  for (const { envKey, required } of VAULT_CREDENTIALS) {
    if (required && !process.env[envKey]) {
      missing.push(envKey);
    }
  }

  if (missing.length > 0) {
    rootLogger.error(
      { vault_mode: "bitwarden", missing_credentials: missing },
      "credential-loader: FAIL-CLOSED — required credentials missing from vault"
    );
    if (exitOnFailure) process.exit(1);
    throw new VaultUnavailableError(
      `Required credentials missing from vault: ${missing.join(", ")}`
    );
  }

  const result: VaultLoadResult = {
    mode: "bitwarden",
    loaded,
    missing,
    durationMs: Date.now() - startMs,
  };
  _vaultLoadResult = result;

  // Log loaded key names only — NEVER log values
  const loadedKeys = [...vaultCredentials.keys()];
  rootLogger.info(
    {
      vault_mode: "bitwarden",
      credentials_loaded: loaded,
      credential_keys: loadedKeys,   // key names only, no values
      duration_ms: result.durationMs,
    },
    "credential-loader: vault credentials loaded successfully"
  );

  return result;
}

/**
 * Returns the cached vault load result.
 * null if loadCredentials() has not been called yet.
 */
export function getVaultLoadResult(): VaultLoadResult | null {
  return _vaultLoadResult;
}

/**
 * Returns the active vault mode.
 */
export function getActiveVaultMode(): VaultMode {
  return _vaultMode;
}

/**
 * Health signal for /api/health: vault subsystem status.
 * Returns structured object suitable for inclusion in the health response.
 */
export function getVaultHealth(): {
  mode: VaultMode;
  status: "ok" | "not_loaded" | "bitwarden_active";
  loaded?: number;
  durationMs?: number;
} {
  if (!_vaultLoadResult) {
    return { mode: _vaultMode, status: "not_loaded" };
  }
  if (_vaultLoadResult.mode === "env") {
    return { mode: "env", status: "ok" };
  }
  return {
    mode: "bitwarden",
    status: "bitwarden_active",
    loaded: _vaultLoadResult.loaded,
    durationMs: _vaultLoadResult.durationMs,
  };
}

// ─── Broker credential loader ─────────────────────────────────────────────────

/**
 * Load broker credentials for a specific broker_accounts row.
 *
 * Vault mode (TF_VAULT_MODE=bitwarden): uses the already-loaded process.env
 * entry that was hydrated by loadCredentials() at startup. The apiKeyVaultRef
 * column stores the Bitwarden field name which was mapped to process.env on
 * startup — so in both modes we read process.env[apiKeyVaultRef].
 *
 * Env mode: process.env[apiKeyVaultRef] is read directly from .env.
 *
 * Fail-CLOSED: missing credential throws — broker-router.ts catches this and
 * calls notifyCritical() + returns { success: false, reason: "credential_load_error" }.
 *
 * @param accountId - UUID from broker_accounts.account_id
 * @returns { apiKey: string } — the broker API key for this account
 */
export async function loadBrokerCredentials(
  accountId: string,
): Promise<{ apiKey: string }> {
  // Lazy import to avoid circular dependency at module-load time.
  // credential-loader.ts must remain importable without db being initialized.
  const { db: dbInstance } = await import("../db/index.js");
  const { brokerAccounts } = await import("../db/schema.js");
  const { eq } = await import("drizzle-orm");

  const rows = await dbInstance
    .select({
      apiKeyVaultRef: brokerAccounts.apiKeyVaultRef,
      firmId: brokerAccounts.firmId,
    })
    .from(brokerAccounts)
    .where(eq(brokerAccounts.accountId, accountId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`broker_account not found: ${accountId}`);
  }

  // apiKeyVaultRef holds the env var name (env mode) or Bitwarden field name
  // (vault mode — already hydrated into process.env by loadCredentials() at startup).
  const envKey = row.apiKeyVaultRef ?? `${row.firmId.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envKey];

  if (!apiKey) {
    throw new Error(
      `Broker credentials missing for account ${accountId} (firm: ${row.firmId}). ` +
        `Expected env var: ${envKey}. ` +
        `Vault mode: ${getActiveVaultMode()}.`,
    );
  }

  return { apiKey };
}

/**
 * TEST HELPER ONLY — resets internal state between test cases.
 * Never call from production code.
 */
export function _resetForTests(): void {
  _vaultLoadResult = null;
  _vaultMode = "env";
}

/**
 * TEST HELPER ONLY — override vault mode without process.env mutation.
 */
export function _setVaultModeForTests(mode: VaultMode): void {
  _vaultMode = mode;
}
