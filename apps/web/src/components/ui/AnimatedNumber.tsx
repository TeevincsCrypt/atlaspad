"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion } from "motion/react";

/** Counts smoothly to `value`. `format` renders the number (keeps tabular alignment). */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
  className = "",
}: {
  value: number | null | undefined;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value ?? 0);
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  useLayoutEffect(() => {
    fmt.current = format;
  });

  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (ref.current) ref.current.textContent = "—";
      return;
    }
    if (reduce) {
      mv.set(value);
      if (ref.current) ref.current.textContent = fmt.current(value);
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = fmt.current(v);
      },
    });
    return () => controls.stop();
  }, [value, duration, mv, reduce]);

  return (
    <span ref={ref} className={`tabular ${className}`}>
      {value === null || value === undefined ? "—" : format(value)}
    </span>
  );
}
