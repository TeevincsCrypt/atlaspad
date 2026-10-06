"use client";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-[#f3d58f] to-[#c79e52] text-[#1a1306] shadow-[0_0_0_1px_rgba(255,230,170,0.5),0_10px_30px_-10px_rgba(214,178,110,0.65)] hover:from-[#f8e0a6] hover:to-[#d4ab5f]",
  secondary: "bg-white/[0.06] text-fg border border-line-strong hover:bg-white/[0.1]",
  outline: "border border-gold/50 text-gold-bright hover:bg-gold/10",
  ghost: "text-dim hover:text-fg hover:bg-white/[0.05]",
  danger: "bg-down/15 text-down border border-down/40 hover:bg-down/25",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-sm gap-2.5 tracking-wide",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-[10px] font-medium transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});
