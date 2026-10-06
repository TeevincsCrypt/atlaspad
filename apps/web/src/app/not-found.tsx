import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="font-display text-6xl text-gold-gradient text-gold-bright">404</div>
      <h1 className="mt-4 font-display text-lg text-fg">Uncharted territory</h1>
      <p className="mt-2 text-sm text-dim">This corner of the Atlas doesn&apos;t exist.</p>
      <Link href="/world" className="mt-6 rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold-bright hover:bg-gold/10">
        Return to the world
      </Link>
    </div>
  );
}
