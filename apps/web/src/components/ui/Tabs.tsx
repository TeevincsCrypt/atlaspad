"use client";
import { motion } from "motion/react";
import { useId } from "react";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
  size = "md",
}: {
  tabs: { key: T; label: React.ReactNode }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" className={`flex items-center gap-1 overflow-x-auto ${className}`}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`relative shrink-0 rounded-lg px-3 ${size === "sm" ? "py-1.5 text-xs" : "py-2 text-[13px]"} font-medium transition-colors ${active ? "text-fg" : "text-faint hover:text-dim"}`}
          >
            {active && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-0 rounded-lg border border-line-strong bg-white/[0.06]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
