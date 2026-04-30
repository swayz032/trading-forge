// Side-effect module: must be imported BEFORE any other module that
// reads process.env. Runs dotenv with override:true so the file system
// is the source of truth — protects against stale PM2-cached env values
// after secrets are rotated in .env.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true });
