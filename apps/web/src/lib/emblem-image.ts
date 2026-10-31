/**
 * Uploaded nation images. A founder can upload a picture instead of (or on top of) the generated flag. The image
 * is stored in the deployment's Supabase Storage bucket and its public URL is written on-chain as the nation's
 * `metadataURI`. Only URLs from that bucket, with a content-hash file name, are ever displayed: anything else
 * written to `metadataURI` (which anyone can do by calling the contract directly) falls back to the flag.
 */
export const EMBLEM_BUCKET = "emblems";
export const EMBLEM_MAX_BYTES = 1_000_000;
export const EMBLEM_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const publicBase = supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/${EMBLEM_BUCKET}/` : null;
const FILE_NAME = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/;

/** True when this deployment has image uploads configured. */
export const emblemUploadsEnabled = publicBase !== null;

/** The image URL to display for a nation, or null to show its generated flag. */
export function emblemImage(metadataUri: string | null | undefined): string | null {
  if (!publicBase || !metadataUri || !metadataUri.startsWith(publicBase)) return null;
  return FILE_NAME.test(metadataUri.slice(publicBase.length)) ? metadataUri : null;
}

/** Public URL for a stored file name (server and client). */
export function emblemPublicUrl(fileName: string): string {
  return `${publicBase}${fileName}`;
}
