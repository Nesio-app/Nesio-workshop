import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import {
  deleteObject,
  objectStorageConfigured,
  putObject,
  storageKeyFromUrl,
} from "@/lib/object-storage";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function saveMemorialImage(
  slug: string,
  file: File
): Promise<{ imageUrl: string; id: string }> {
  if (!ALLOWED.has(file.type)) {
    throw new Error("仅支持 JPG、PNG、WebP、GIF 格式");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("图片不能超过 4MB");
  }

  const id = randomBytes(8).toString("hex");
  const ext = EXT[file.type] || ".jpg";
  const filename = `${id}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (objectStorageConfigured()) {
    const key = `memorials/${slug}/${filename}`;
    const publicUrl = await putObject(key, buffer, file.type);
    return { id, imageUrl: publicUrl };
  }

  const dir = path.join(process.cwd(), "public", "uploads", "memorials", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);

  const imageUrl = `/uploads/memorials/${slug}/${filename}`;
  return { id, imageUrl };
}

/** Normalize stored URL to relative path for DB and clients. */
export function normalizeUploadPath(imageUrl: string | null | undefined): string {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("/uploads/")) return imageUrl;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }
  return imageUrl;
}

export async function deleteMemorialImage(imageUrl: string | null | undefined) {
  if (!imageUrl) return;

  const s3Key = storageKeyFromUrl(imageUrl);
  if (s3Key && objectStorageConfigured()) {
    await deleteObject(s3Key);
    return;
  }

  const rel = imageUrl.startsWith("/uploads/memorials/")
    ? imageUrl
    : null;
  if (!rel) return;
  const filePath = path.join(process.cwd(), "public", rel);
  try {
    await unlink(filePath);
  } catch {
    /* file may already be gone */
  }
}
