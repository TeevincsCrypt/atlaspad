const TONES = {
  neutral: "border-line-strong text-dim bg-white/[0.03]",
  gold: "border-gold/40 text-gold-bright bg-gold/10",
  up: "border-up/40 text-up bg-up/10",
  down: "border-down/40 text-down bg-down/10",
  warn: "border-warn/40 text-warn bg-warn/10",
  info: "border-info/40 text-info bg-info/10",
  war: "border-war/50 text-war bg-war/10",
} as const;

export function Badge({ tone = "neutral", children, className = "" }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
