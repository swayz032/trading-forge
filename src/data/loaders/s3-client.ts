import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

// ─── S3 Key Helpers (pure functions) ─────────────────────────────

type OhlcvKeyParams = {
  symbol: string;
  kind: "raw" | "ratio_adj" | "panama_adj";
  timeframe: string;
  date: string; // YYYY-MM-DD
};

type RollCalendarKeyParams = {
  symbol: string;
  kind: "roll_calendar";
  year: string;
};

type S3KeyParams = OhlcvKeyParams | RollCalendarKeyParams;

type ParsedOhlcvKey = {
  symbol: string;
  kind: string;
  timeframe: string;
  year: string;
  month: string;
  day: string;
};

type ParsedRollCalendarKey = {
  symbol: string;
  kind: "roll_calendar";
  year: string;
};

type ParsedS3Key = ParsedOhlcvKey | ParsedRollCalendarKey;

export function buildS3Key(params: S3KeyParams): string {
  if (params.kind === "roll_calendar") {
    return `futures/${params.symbol}/roll_calendar/${params.year}.json`;
  }

  const [year, month, day] = params.date.split("-");
  return `futures/${params.symbol}/${params.kind}/${params.timeframe}/${year}/${month}/${day}.parquet`;
}

export function parseS3Key(key: string): ParsedS3Key {
  const parts = key.split("/");
  // futures/{symbol}/{kind}/...
  const symbol = parts[1];
  const kind = parts[2];

  if (kind === "roll_calendar") {
    const year = parts[3].replace(".json", "");
    return { symbol, kind: "roll_calendar", year };
  }

  const timeframe = parts[3];
  const year = parts[4];
  const month = parts[5];
  const day = parts[6].replace(".parquet", "");
  return { symbol, kind, timeframe, year, month, day };
}

// ─── S3 Service ──────────────────────────────────────────────────

export function createS3Service(config?: {
  region?: string;
  bucket?: string;
}) {
  const bucket = config?.bucket ?? process.env.S3_BUCKET ?? "trading-forge-data";
  const client = new S3Client({
    region: config?.region ?? process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  async function upload(key: string, body: Buffer | Readable): Promise<void> {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })
    );
  }

  async function download(key: string): Promise<Buffer> {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const stream = resp.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async function exists(key: string): Promise<boolean> {
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  return { upload, download, exists, listKeys, bucket, client };
}
