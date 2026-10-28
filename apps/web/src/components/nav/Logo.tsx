import { useId } from "react";

/** The AtlasPad compass star. Vector source: brand/src/compass.py (regenerate there, then paste). */
export function LogoMark({ size = 24 }: { size?: number }) {
  // Unique gradient ids: several marks can be on one page.
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden>
      <defs>
      <linearGradient id={`${id}ring`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#f8e9b8"/>
      <stop offset="0.5" stopColor="#dcb76c"/>
      <stop offset="1" stopColor="#9c7633"/>
      </linearGradient>
      <radialGradient id={`${id}core`} cx="50%" cy="50%" r="50%">
      <stop offset="0" stopColor="#fffdf4"/>
      <stop offset="0.35" stopColor="#fff3cc" stopOpacity="0.95"/>
      <stop offset="1" stopColor="#f6dc9a" stopOpacity="0"/>
      </radialGradient>
      </defs>
      <path d="M65.96 47.58 A62.5 62.5 0 0 1 134.04 47.58 L119.95 59.10 A45.5 45.5 0 0 0 80.05 59.10 Z" fill={`url(#${id}ring)`}/>
      <path d="M152.42 65.96 A62.5 62.5 0 0 1 152.42 134.04 L140.90 119.95 A45.5 45.5 0 0 0 140.90 80.05 Z" fill={`url(#${id}ring)`}/>
      <path d="M134.04 152.42 A62.5 62.5 0 0 1 65.96 152.42 L80.05 140.90 A45.5 45.5 0 0 0 119.95 140.90 Z" fill={`url(#${id}ring)`}/>
      <path d="M47.58 134.04 A62.5 62.5 0 0 1 47.58 65.96 L59.10 80.05 A45.5 45.5 0 0 0 59.10 119.95 Z" fill={`url(#${id}ring)`}/>
      <path d="M152.33 47.67 L100.00 89.00 L100.00 100.00 Z" fill="#efd796"/>
      <path d="M152.33 47.67 L111.00 100.00 L100.00 100.00 Z" fill="#b38c46"/>
      <path d="M152.33 152.33 L111.00 100.00 L100.00 100.00 Z" fill="#efd796"/>
      <path d="M152.33 152.33 L100.00 111.00 L100.00 100.00 Z" fill="#b38c46"/>
      <path d="M47.67 152.33 L100.00 111.00 L100.00 100.00 Z" fill="#efd796"/>
      <path d="M47.67 152.33 L89.00 100.00 L100.00 100.00 Z" fill="#b38c46"/>
      <path d="M47.67 47.67 L89.00 100.00 L100.00 100.00 Z" fill="#efd796"/>
      <path d="M47.67 47.67 L100.00 89.00 L100.00 100.00 Z" fill="#b38c46"/>
      <path d="M100.00 4.00 L90.81 90.81 L100.00 100.00 Z" fill="#fbeec4"/>
      <path d="M100.00 4.00 L109.19 90.81 L100.00 100.00 Z" fill="#c9a258"/>
      <path d="M196.00 100.00 L109.19 90.81 L100.00 100.00 Z" fill="#fbeec4"/>
      <path d="M196.00 100.00 L109.19 109.19 L100.00 100.00 Z" fill="#c9a258"/>
      <path d="M100.00 196.00 L109.19 109.19 L100.00 100.00 Z" fill="#fbeec4"/>
      <path d="M100.00 196.00 L90.81 109.19 L100.00 100.00 Z" fill="#c9a258"/>
      <path d="M4.00 100.00 L90.81 109.19 L100.00 100.00 Z" fill="#fbeec4"/>
      <path d="M4.00 100.00 L90.81 90.81 L100.00 100.00 Z" fill="#c9a258"/>
      <circle cx="100" cy="100" r="22" fill={`url(#${id}core)`}/>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={30} />
      <span className="font-display text-[13px] font-semibold tracking-[0.28em] text-fg">ATLASPAD</span>
    </span>
  );
}
