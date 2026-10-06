export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="13.5" stroke="url(#lg)" strokeWidth="1.6" />
      <ellipse cx="16" cy="16" rx="6" ry="13.5" stroke="url(#lg)" strokeWidth="1.2" opacity="0.8" />
      <path d="M3 16h26M5 9.5h22M5 22.5h22" stroke="url(#lg)" strokeWidth="1" opacity="0.55" />
      <circle cx="21.5" cy="10.5" r="2.2" fill="#f3d58f" />
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#f3d58f" />
          <stop offset="1" stopColor="#8a6a2f" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="font-display text-[13px] font-semibold tracking-[0.28em] text-fg">ATLASPAD</span>
    </span>
  );
}
