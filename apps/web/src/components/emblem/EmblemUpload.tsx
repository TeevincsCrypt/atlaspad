"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { EMBLEM_ACCEPT, EMBLEM_MAX_BYTES, emblemImage, emblemUploadsEnabled } from "@/lib/emblem-image";
import { Button } from "../ui/Button";

/**
 * Lets a founder upload a picture for their nation. The picture is stored by the AtlasPad server and its URL is
 * written on-chain as the nation's metadataURI. The drawn flag stays as the fallback (and colors the nation on the map).
 */
export function EmblemUpload({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!emblemUploadsEnabled) return null;

  const upload = async (file: File) => {
    setError(null);
    if (!EMBLEM_ACCEPT.split(",").includes(file.type)) return setError("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > EMBLEM_MAX_BYTES) return setError("Images must be 1 MB or smaller.");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/emblem-image", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url || !emblemImage(data.url)) throw new Error(data.error ?? "The upload failed. Try again.");
      onChange(data.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-1 text-sm text-fg">Nation image (optional)</div>
      <p className="mb-3 text-xs leading-relaxed text-faint">
        Upload a logo or picture to use instead of the flag. PNG, JPEG, WebP or GIF, up to 1 MB. It is shown in a 3:2 frame
        and saved with your nation on-chain. Your flag colors still mark your territory on the map.
      </p>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {value ? "Replace image" : "Upload an image"}
        </Button>
        {value && !busy && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="size-4" /> Use the flag instead
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </div>
  );
}
