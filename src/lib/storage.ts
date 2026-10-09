// File storage for selfies and images.
// Uses an S3-compatible bucket when S3_BUCKET is set (AWS S3, Cloudflare R2,
// MinIO, DigitalOcean Spaces…), otherwise the local ./storage directory.
// Files are never public: they are streamed through /api/files/<key>, which
// checks the viewer's permissions first.

import { promises as fs } from "node:fs";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Runtime-configured directory; excluded from build-time file tracing.
const LOCAL_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "./storage");

let s3: S3Client | null = null;
function s3Client(): S3Client | null {
  if (!process.env.S3_BUCKET) return null;
  s3 ??= new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return s3;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

export function keyFromUrl(url: string): string | null {
  return url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null;
}

export async function putFile(key: string, body: Buffer, contentType: string): Promise<void> {
  assertSafeKey(key);
  const client = s3Client();
  if (client) {
    await client.send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }),
    );
    return;
  }
  const target = path.join(LOCAL_ROOT, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  assertSafeKey(key);
  const client = s3Client();
  if (client) {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return null;
      return { body: Buffer.from(bytes), contentType: res.ContentType || guessType(key) };
    } catch {
      return null;
    }
  }
  const target = path.join(LOCAL_ROOT, key);
  if (!target.startsWith(LOCAL_ROOT + path.sep)) return null;
  try {
    return { body: await fs.readFile(target), contentType: guessType(key) };
  } catch {
    return null;
  }
}

function guessType(key: string): string {
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".svg")) return "image/svg+xml"; // seed placeholders only; uploads are JPEG
  return "application/octet-stream";
}
