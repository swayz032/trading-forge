// Side-effect module: must be imported BEFORE any other module that
// reads process.env. Runs dotenv with override:true so the file system
// is the source of truth — protects against stale PM2-cached env values
// after secrets are rotated in .env.
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// The service manager (NSSM) is the authority for NODE_ENV. dotenv override:true
// exists to keep rotated SECRETS fresh — it must not let a stale
// NODE_ENV=development in .env downgrade a production process and silently
// activate the auth dev bypass (deep-scan #13 CRITICAL).
const _preExistingNodeEnv = process.env["NODE_ENV"];

dotenvConfig({ override: true });

if (_preExistingNodeEnv) {
  process.env["NODE_ENV"] = _preExistingNodeEnv;
}

// H4: Override BW_SESSION from .bw-session-runtime if it exists.
// bitwarden-session-refresh-service writes this file after a successful refresh.
// Loaded AFTER dotenv so the runtime file wins over the stale value in .env,
// ensuring NSSM restarts pick up the latest valid session token rather than
// the expired one that was present when the service was last restarted.
const _runtimeBwSessionPath = join(process.cwd(), ".bw-session-runtime");
if (existsSync(_runtimeBwSessionPath)) {
  try {
    const _runtimeToken = readFileSync(_runtimeBwSessionPath, "utf8").trim();
    if (_runtimeToken) {
      process.env["BW_SESSION"] = _runtimeToken;
    }
  } catch {
    // Non-fatal; logger is not available yet. Fall back to whatever dotenv set.
  }
}
