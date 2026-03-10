import { Database } from "duckdb-async";

// ─── Query Builder (pure function) ──────────────────────────────

export interface OhlcvQueryParams {
  symbol: string;
  timeframe: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  adjusted?: boolean;
  limit?: number;
}

export function buildOhlcvQuery(params: OhlcvQueryParams): string {
  const { symbol, timeframe, from, to, adjusted = true, limit } = params;
  const kind = adjusted ? "ratio_adj" : "raw";
  const bucket = process.env.S3_BUCKET ?? "trading-forge-data";

  // Parse date strings directly (avoid timezone issues with Date constructor)
  const [fromYear, fromMonth] = from.split("-");
  const [toYear, toMonth] = to.split("-");
  const sameYear = fromYear === toYear;
  const sameMonth = sameYear && fromMonth === toMonth;

  let globPath: string;
  if (sameMonth) {
    globPath = `futures/${symbol}/${kind}/${timeframe}/${fromYear}/${fromMonth}/*.parquet`;
  } else if (sameYear) {
    globPath = `futures/${symbol}/${kind}/${timeframe}/${fromYear}/*/*.parquet`;
  } else {
    globPath = `futures/${symbol}/${kind}/${timeframe}/*/*/*.parquet`;
  }

  const s3Url = `s3://${bucket}/${globPath}`;

  let sql = `SELECT ts_event, open, high, low, close, volume
FROM read_parquet('${s3Url}')
WHERE ts_event >= '${from}' AND ts_event <= '${to}'
ORDER BY ts_event`;

  if (limit) {
    sql += `\nLIMIT ${limit}`;
  }

  return sql;
}

// ─── DuckDB Service ─────────────────────────────────────────────

let db: Database | null = null;
let configured = false;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.create(":memory:");
  }

  if (!configured) {
    await db.exec("INSTALL httpfs; LOAD httpfs;");
    await db.exec(`
      SET s3_region='${process.env.AWS_REGION ?? "us-east-1"}';
      SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID ?? ""}';
      SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY ?? ""}';
    `);
    configured = true;
  }

  return db;
}

export interface OhlcvBar {
  ts_event: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function queryOhlcv(params: OhlcvQueryParams): Promise<OhlcvBar[]> {
  const database = await getDb();
  const sql = buildOhlcvQuery(params);
  const rows = await database.all(sql);
  return rows as OhlcvBar[];
}

export interface SymbolInfo {
  symbol: string;
  earliest: string;
  latest: string;
  totalBars: number;
}

export async function queryInfo(symbol: string): Promise<SymbolInfo> {
  const database = await getDb();
  const bucket = process.env.S3_BUCKET ?? "trading-forge-data";
  const sql = `
    SELECT
      MIN(ts_event) as earliest,
      MAX(ts_event) as latest,
      COUNT(*) as total_bars
    FROM read_parquet('s3://${bucket}/futures/${symbol}/ratio_adj/1min/*/*/*.parquet')
  `;

  const rows = await database.all(sql);
  const row = rows[0] as { earliest: string; latest: string; total_bars: number };

  return {
    symbol,
    earliest: String(row.earliest),
    latest: String(row.latest),
    totalBars: Number(row.total_bars),
  };
}

export async function listAvailableSymbols(): Promise<string[]> {
  const database = await getDb();
  const bucket = process.env.S3_BUCKET ?? "trading-forge-data";

  try {
    const sql = `
      SELECT DISTINCT split_part(filename, '/', 2) as symbol
      FROM read_parquet('s3://${bucket}/futures/*/ratio_adj/daily/*/*/*.parquet', filename=true)
      ORDER BY symbol
    `;
    const rows = await database.all(sql);
    return rows.map((r: { symbol: string }) => r.symbol);
  } catch {
    // Fallback: try listing via S3 prefix patterns
    return [];
  }
}
