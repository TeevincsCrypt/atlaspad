import { ImageResponse } from "next/og";
import { nationSummaries } from "@atlaspad/db/queries";
import { TIERS, decodeEmblem, formatCompact, formatInt, formatWif, type NationSummary } from "@atlaspad/shared";
import { getSql } from "@/lib/server/db";
import { emblemImage } from "@/lib/emblem-image";
import { publicEnv } from "@/lib/env";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "A nation on AtlasPad";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#e2bd72";

async function load(id: number): Promise<NationSummary | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const [n] = await nationSummaries(sql, { ids: [id] });
    return n ?? null;
  } catch {
    return null;
  }
}

/** The share card shown when a nation link is posted on X, Telegram or Discord. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = /^\d+$/.test(id) ? await load(Number(id)) : null;
  const host = publicEnv.siteUrl.replace(/^https?:\/\//, "");

  if (!n) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#05060b", color: "#eef0f6" }}>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: 18 }}>ATLASPAD</div>
          <div style={{ fontSize: 32, color: GOLD, marginTop: 18 }}>Every token is a nation. Every nation runs on $WIF.</div>
        </div>
      ),
      size,
    );
  }

  const e = decodeEmblem(n.emblem);
  const img = emblemImage(n.metadataUri);
  const stats = [
    ["Market cap", formatWif(n.marketCapWif)],
    ["Citizens", formatInt(n.citizens)],
    ["Stage", TIERS[n.tier]?.name ?? "—"],
    ["$WIF burned", formatWif(n.wifBurned)],
  ];
  const change = n.change24h;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "56px 64px",
          color: "#eef0f6",
          background: `radial-gradient(circle at 18% 30%, ${e.primary}33 0%, transparent 45%), radial-gradient(circle at 85% 90%, rgba(226,189,114,0.16) 0%, transparent 40%), #05060b`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 22, color: "#8c95aa", letterSpacing: 6 }}>
          <div style={{ display: "flex", alignItems: "center", color: GOLD, fontWeight: 700 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" style={{ marginRight: 14 }}>
              <path d="M12 0 14.2 9.8 24 12 14.2 14.2 12 24 9.8 14.2 0 12 9.8 9.8Z" fill={GOLD} />
            </svg>
            ATLASPAD
          </div>
          <div style={{ display: "flex" }}>{n.graduated ? "GRADUATED · UNISWAP" : `BONDING CURVE · ${Math.round((n.curveProgress ?? 0) * 100)}%`}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 52 }}>
          {img ? (
            <img src={img} width={240} height={240} style={{ borderRadius: 28, objectFit: "cover", border: "2px solid rgba(255,255,255,0.15)" }} alt="" />
          ) : (
            <div style={{ display: "flex", position: "relative", width: 300, height: 200, borderRadius: 18, overflow: "hidden", border: "2px solid rgba(255,255,255,0.15)", boxShadow: `0 0 80px ${e.primary}66` }}>
              <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
                <div style={{ flex: 1, background: e.primary }} />
                <div style={{ flex: 1, background: e.secondary }} />
              </div>
              <div style={{ position: "absolute", left: 0, top: 0, width: 300, height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 110, fontWeight: 700, color: e.accent }}>
                {n.ticker.slice(0, 1)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 48, minWidth: 0 }}>
            <div style={{ fontSize: n.name.length > 14 ? 64 : 84, fontWeight: 700, lineHeight: 1, textTransform: "uppercase" }}>{n.name}</div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 18, fontSize: 34, color: "#9aa2b5" }}>
              <span style={{ color: GOLD }}>${n.ticker}</span>
              {change !== null && (
                <span style={{ marginLeft: 22, color: change >= 0 ? "#35d29a" : "#ff5a6e" }}>
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(1)}% 24h
                </span>
              )}
            </div>
            {n.description ? <div style={{ marginTop: 16, fontSize: 24, color: "#8c95aa", maxWidth: 720 }}>{n.description.slice(0, 110)}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", marginTop: "auto", gap: 18 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "20px 24px", borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div style={{ fontSize: 18, color: "#6f7891", letterSpacing: 4, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 38, fontWeight: 700, marginTop: 6, color: k === "$WIF burned" ? "#ffb489" : "#eef0f6" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26, fontSize: 22, color: "#8c95aa" }}>
          <div style={{ display: "flex" }}>Every token is a nation. Every nation runs on $WIF.</div>
          <div style={{ display: "flex", color: GOLD }}>
            {host}/nation/{n.id} · {formatCompact(n.trades24h)} trades 24h
          </div>
        </div>
      </div>
    ),
    size,
  );
}
