import { createHash } from "node:crypto";
import { EMBLEM_BUCKET, EMBLEM_MAX_BYTES, emblemPublicUrl } from "@/lib/emblem-image";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recognises the image formats we accept from their first bytes (never trusts the declared type). */
function sniff(b: Uint8Array): { ext: string; type: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: "gif", type: "image/gif" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

/**
 * Stores a nation image in Supabase Storage and returns its public URL, which the founder then writes on-chain as
 * the nation's metadataURI. Files are named by content hash, so the same image uploaded twice is stored once.
 */
export async function POST(req: Request) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return json({ error: "Image uploads are not configured on this deployment." }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > EMBLEM_MAX_BYTES + 64_000) {
    return json({ error: "Images must be 1 MB or smaller." }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "Send the image as a form upload named 'file'." }, { status: 400 });
  }
  if (!(file instanceof File)) return json({ error: "No image received." }, { status: 400 });
  if (file.size > EMBLEM_MAX_BYTES) return json({ error: "Images must be 1 MB or smaller." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return json({ error: "Use a PNG, JPEG, WebP or GIF image." }, { status: 415 });

  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${kind.ext}`;
  const res = await fetch(`${base}/storage/v1/object/${EMBLEM_BUCKET}/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": kind.type,
      "cache-control": "max-age=31536000",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    console.error("[emblem-image] storage upload failed", res.status, (await res.text()).slice(0, 300));
    return json({ error: "The image could not be stored. Try again in a moment." }, { status: 502 });
  }
  return json({ url: emblemPublicUrl(name) });
}
