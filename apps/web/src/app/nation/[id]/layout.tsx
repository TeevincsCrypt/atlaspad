import type { Metadata } from "next";
import { getSql, withTimeout } from "@/lib/server/db";

// The page title is looked up before any HTML is sent, so a slow database must never hold the page: give up quickly.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sql = getSql();
  if (!sql || !/^\d+$/.test(id)) return { title: "Nation" };
  try {
    const rows = await withTimeout(sql`SELECT name, ticker, description FROM nations WHERE id = ${Number(id)}`.then((r) => [...r]), 1500, null);
    if (!rows) return { title: "Nation" };
    const [n] = rows;
    if (!n) return { title: "Nation not found" };
    return { title: `${n.name} ($${n.ticker})`, description: (n.description as string) || `${n.name} — a nation on AtlasPad.` };
  } catch {
    return { title: "Nation" };
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
