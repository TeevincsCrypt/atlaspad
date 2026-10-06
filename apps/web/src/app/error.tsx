"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-lg text-fg">Something went wrong</h1>
      <p className="mt-2 text-sm text-dim">This view failed to render. Your funds and on-chain state are unaffected.</p>
      <button onClick={reset} className="mt-6 rounded-lg border border-line-strong px-4 py-2 text-sm text-fg hover:bg-white/5">
        Try again
      </button>
    </div>
  );
}
