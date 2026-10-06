import type { Metadata } from "next";
import { getSql } from "@/lib/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sql = getSql();
  if (!sql || !/^\d+$/.test(id)) return { title: "Nation" };
  try {
    const [n] = await sql`SELECT name, ticker, description FROM nations WHERE id = ${Number(id)}`;
    if (!n) return { title: "Nation not found" };
    return { title: `${n.name} ($${n.ticker})`, description: (n.description as string) || `${n.name} — a nation on AtlasPad.` };
  } catch {
    return { title: "Nation" };
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
