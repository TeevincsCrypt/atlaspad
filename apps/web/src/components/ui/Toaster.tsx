"use client";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: React.ReactNode;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === "error" ? 9000 : 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, body?: React.ReactNode) => useToasts.getState().push({ tone: "success", title, body }),
  error: (title: string, body?: React.ReactNode) => useToasts.getState().push({ tone: "error", title, body }),
  info: (title: string, body?: React.ReactNode) => useToasts.getState().push({ tone: "info", title, body }),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[90] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 sm:bottom-6">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="panel pointer-events-auto flex items-start gap-3 p-3.5"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
            ) : t.tone === "error" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-down" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-dim">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
