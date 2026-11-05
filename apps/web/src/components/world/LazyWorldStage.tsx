"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// The 3D world (three.js) is large. Load it only on the pages that show it, and only after the page is interactive.
const WorldStage = dynamic(() => import("./WorldStage").then((m) => m.WorldStage), {
  ssr: false,
  loading: () => <div className="fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_center,#0d1424,#03040a_70%)]" />,
});

export function LazyWorldStage() {
  const path = usePathname();
  return path === "/" || path.startsWith("/world") ? <WorldStage /> : null;
}
