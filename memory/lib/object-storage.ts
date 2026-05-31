import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export function objectStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}

function client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "auto";
  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: Boolean(endpoint),
  });
}

function publicUrlForKey(key: string): string {
  const base = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (!base) {
    throw new Error("S3_PUBLIC_URL must be set when using object storage");
  }
  return `${base}/${key}`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const bucket = process.env.S3_BUCKET!;
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return publicUrlForKey(key);
}

export async function deleteObject(key: string): Promise<void> {
  if (!objectStorageConfigured()) return;
  const bucket = process.env.S3_BUCKET!;
  try {
    await client().send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch {
    /* object may already be gone */
  }
}

/** Extract S3 object key from stored URL or /uploads/... path */
export function storageKeyFromUrl(
  imageUrl: string | null | undefined
): string | null {
  if (!imageUrl) return null;
  const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (publicBase && imageUrl.startsWith(publicBase)) {
    return imageUrl.slice(publicBase.length + 1);
  }
  if (imageUrl.startsWith("/uploads/memorials/")) {
    return imageUrl.replace(/^\/uploads\//, "");
  }
  try {
    const u = new URL(imageUrl);
    if (publicBase && imageUrl.startsWith(publicBase)) {
      return u.pathname.replace(/^\//, "");
    }
    if (u.pathname.startsWith("/memorials/")) {
      return u.pathname.replace(/^\//, "");
    }
  } catch {
    /* relative */
  }
  return null;
}
