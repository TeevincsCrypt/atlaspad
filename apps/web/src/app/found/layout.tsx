import type { Metadata } from "next";

export const metadata: Metadata = { title: "Found a Nation" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
