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

export const ALLOWED_SYMBOLS = ["ES", "NQ", "CL", "MES", "MNQ", "MCL"];
export const ALLOWED_TIMEFRAMES = ["1min", "5min", "15min", "30min", "1hour", "4hour", "daily"];

export function buildOhlcvQuery(params: OhlcvQueryParams): string {
  const { symbol, timeframe, from, to, adjusted = true, limit } = params;

  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

  if (!ALLOWED_SYMBOLS.includes(symbol)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  if (!ALLOWED_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }
  if (from && !DATE_REGEX.test(from)) {
    throw new Error(`Invalid from date: ${from}`);
  }
  if (to && !DATE_REGEX.test(to)) {
    throw new Error(`Invalid to date: ${to}`);
  }
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

let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const db = await Database.create(":memory:");
    await db.exec("INSTALL httpfs; LOAD httpfs;");
    const sanitize = (v: string) => v.replace(/'/g, "");
    await db.exec(`
      SET s3_region='${sanitize(process.env.AWS_REGION ?? "us-east-1")}';
      SET s3_access_key_id='${sanitize(process.env.AWS_ACCESS_KEY_ID ?? "")}';
      SET s3_secret_access_key='${sanitize(process.env.AWS_SECRET_ACCESS_KEY ?? "")}';
    `);
    return db;
  })();

  return dbPromise;
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
  if (!ALLOWED_SYMBOLS.includes(symbol)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
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
  const row = rows[0] as { earliest: string | null; latest: string | null; total_bars: number };

  if (!row || row.earliest == null || row.latest == null) {
    return { symbol, earliest: "", latest: "", totalBars: 0 };
  }

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
    return rows.map((r) => (r as { symbol: string }).symbol);
  } catch {
    // Fallback: try listing via S3 prefix patterns
    return [];
  }
}
