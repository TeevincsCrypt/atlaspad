"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw } from "lucide-react";
import { encodeEmblem } from "@atlaspad/shared";
import { EMBLEM_ACCEPT, EMBLEM_MAX_BYTES, emblemImage, emblemUploadsEnabled } from "@/lib/emblem-image";

export interface UploadedImage {
  url: string;
  /** On-chain emblem value derived from the image's colors (it tints the nation's territory on the map). */
  emblem: bigint;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** Dominant vivid color of an image, plus a darker companion, read locally from the file before it is uploaded. */
async function paletteOf(file: File): Promise<[string, string, string]> {
  const fallback: [string, string, string] = ["#d6b26e", "#7a5a26", "#14100a"];
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext("2d");
    if (!ctx) return fallback;
    ctx.drawImage(bmp, 0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
      if (a < 128) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510, s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      if (s < 0.25 || l < 0.15 || l > 0.9) continue;
      let h = 0;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const key = Math.floor(h * 2); // 12 hue buckets
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
    }
    const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) return fallback;
    const [r, g, b] = [best.r / best.n, best.g / best.n, best.b / best.n];
    return [hex(r, g, b), hex(r * 0.5, g * 0.5, b * 0.5), hex(r * 0.15, g * 0.15, b * 0.15)];
  } catch {
    return fallback;
  }
}

export function emblemFromPalette([primary, secondary, accent]: [string, string, string]): bigint {
  return encodeEmblem({ glyph: "star", pattern: "solid", primary, secondary, accent });
}

/**
 * The nation's image: required when founding. Drop or pick a file; it is checked, stored by the AtlasPad server, and its
 * URL is written on-chain as the nation's metadataURI. The image's dominant color becomes the nation's map color.
 */
export function EmblemUpload({ value, onChange }: { value: string | null; onChange: (img: UploadedImage) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!emblemUploadsEnabled) {
    return (
      <div className="rounded-2xl border border-warn/30 bg-warn/[0.06] p-5 text-sm text-warn">
        Image uploads are not configured on this deployment (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY), so a nation can&apos;t be founded yet.
      </div>
    );
  }

  const upload = async (file: File) => {
    setError(null);
    if (!EMBLEM_ACCEPT.split(",").includes(file.type)) return setError("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > EMBLEM_MAX_BYTES) return setError("Images must be 1 MB or smaller.");
    setBusy(true);
    try {
      const palette = await paletteOf(file);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/emblem-image", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url || !emblemImage(data.url)) throw new Error(data.error ?? "The upload failed. Try again.");
      onChange({ url: data.url, emblem: emblemFromPalette(palette) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const img = emblemImage(value);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={EMBLEM_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        disabled={busy}
        className={`group relative flex w-full items-center gap-6 overflow-hidden rounded-2xl border border-dashed p-5 text-left transition sm:p-6 ${
          drag ? "border-gold bg-gold/10" : img ? "border-line-strong bg-white/[0.02] hover:border-gold/50" : "border-gold/40 bg-gold/[0.04] hover:border-gold/70 hover:bg-gold/[0.07]"
        }`}
      >
        <span className="relative grid size-32 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line-strong bg-black/40 sm:size-40">
          {img ? (
            <img src={img} alt="Your nation's image" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-10 text-gold/80 transition group-hover:scale-110" />
          )}
          {busy && (
            <span className="absolute inset-0 grid place-items-center bg-black/60">
              <Loader2 className="size-7 animate-spin text-gold-bright" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-lg text-fg">{busy ? "Uploading…" : img ? "Looking good." : "Drop your token image here"}</span>
          <span className="mt-1.5 block text-sm leading-relaxed text-dim">
            {img ? "This is your nation's face everywhere on AtlasPad." : "or click to choose a file."} PNG, JPEG, WebP or GIF, up to 1 MB. Square images look best.
          </span>
          {img && !busy && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim group-hover:text-fg">
              <RefreshCw className="size-3.5" /> Replace
            </span>
          )}
        </span>
      </button>
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </div>
  );
}
