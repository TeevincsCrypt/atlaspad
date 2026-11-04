import { ImageIcon } from "lucide-react";
import { emblemImage } from "@/lib/emblem-image";

/** A nation's uploaded image as a rounded square token logo (or an empty placeholder). */
export function TokenImage({ src, size = 48, glow, className = "" }: { src: string | null | undefined; size?: number; glow?: string; className?: string }) {
  const img = emblemImage(src);
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[24%] border border-white/15 bg-black/40 ${className}`}
      style={{ width: size, height: size, boxShadow: glow ? `0 0 ${Math.round(size / 2.5)}px ${glow}66` : undefined }}
    >
      {img ? (
        <img src={img} alt="" className="size-full object-cover" />
      ) : (
        <ImageIcon className="text-faint" style={{ width: size * 0.36, height: size * 0.36 }} />
      )}
    </span>
  );
}
