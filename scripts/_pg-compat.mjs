/**
 * Tiny pg-compat shim for the W7a/W7b/W7c/W8 graduation scripts.
 *
 * Trading Forge uses postgres-js (postgres@^3.4.7), not node-pg.
 * Rather than rewrite every graduation script's pg.Client patterns, we expose
 * a minimal surface that mimics pg.Client over the postgres-js sql tag.
 *
 * Supported API (intentionally small):
 *   const client = new Client({ connectionString });
 *   await client.connect();                       // no-op, postgres-js connects lazily
 *   await client.query(text);                     // returns { rows }
 *   await client.query(text, [params]);           // returns { rows }
 *   await client.query("BEGIN" | "COMMIT" | "ROLLBACK");  // transaction control
 *   await client.end();                           // closes pool
 *
 * NOT supported: streaming queries, prepared statements, notification listeners.
 * If a graduation script grows beyond these patterns, switch it to postgres-js
 * directly.
 */
import postgres from "postgres";

class Client {
  constructor({ connectionString }) {
    if (!connectionString) {
      throw new Error("Client: connectionString is required");
    }
    this._sql = postgres(connectionString, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 30,
      onnotice: () => {},
    });
  }

  async connect() {
    return undefined;
  }

  async query(text, params = []) {
    if (Array.isArray(params) && params.length > 0) {
      const rows = await this._sql.unsafe(text, params);
      return { rows: Array.from(rows) };
    }
    const rows = await this._sql.unsafe(text);
    return { rows: Array.from(rows) };
  }

  async end() {
    if (this._sql) {
      await this._sql.end({ timeout: 5 });
      this._sql = null;
    }
  }
}

const pg = { Client };
export default pg;
export { Client };
