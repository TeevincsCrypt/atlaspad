import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { decodeEmblem, formatCompact, formatWif } from "@atlaspad/shared";
import { getSql } from "@/lib/server/db";
import { getSellPnl, type SellPnl } from "@/lib/server/queries";
import { emblemImage } from "@/lib/emblem-image";
import { publicEnv } from "@/lib/env";
import { formatHeld, formatPnlPct, formatPrice, pnlTagline } from "@/lib/pnl";

export const runtime = "nodejs";

const W = 1200;
const H = 675;
const UP = "#3ee08f";
const DOWN = "#ff4d5e";
const GOLD = "#e2bd72";

let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 700; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all(
    ([500, 700] as const).map(async (weight) => ({
      name: "Unbounded",
      data: await readFile(join(process.cwd(), "assets/fonts", `unbounded-latin-${weight}-normal.woff`)),
      weight,
      style: "normal" as const,
    })),
  );
  return fonts;
}

/** Deterministic pixel mosaic, denser toward the right edge, seeded by the transaction hash. */
function mosaic(seed: string) {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619) >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cell = 45;
  const cells: { x: number; y: number }[] = [];
  for (let cx = 0; cx < 13; cx++) {
    for (let cy = 0; cy < 15; cy++) {
      const edge = cx / 12;
      const nearTop = cy < 3 ? 0.25 : 0;
      if (rnd() < 0.08 + edge * 0.55 + nearTop) cells.push({ x: cx * cell, y: cy * cell });
    }
  }
  return { cell, cells };
}

function card(p: SellPnl, host: string) {
  const e = decodeEmblem(p.emblem);
  const img = emblemImage(p.metadataUri);
  const pct = p.pnlPct;
  const up = (p.pnlWif ?? 0) >= 0;
  const tone = pct === null ? GOLD : up ? UP : DOWN;
  const headline = pct === null ? `+${formatWif(p.wifReceived)}` : formatPnlPct(pct);
  const { cell, cells } = mosaic(p.txHash);
  const label = { display: "flex", fontSize: 17, color: "#7c859b", letterSpacing: 1 } as const;
  const value = { display: "flex", fontSize: 27, color: "#eef0f6", marginTop: 6 } as const;

  return (
    <div style={{ width: W, height: H, display: "flex", background: "#030305", fontFamily: "Unbounded", color: "#eef0f6", position: "relative", overflow: "hidden" }}>
      {/* art side */}
      <div style={{ position: "absolute", right: 0, top: 0, width: 585, height: H, display: "flex" }}>
        {cells.map((c, i) => (
          <div key={i} style={{ position: "absolute", left: c.x, top: c.y, width: cell, height: cell, background: e.primary }} />
        ))}
        <div style={{ position: "absolute", left: 0, top: 0, width: 585, height: H, display: "flex", background: "linear-gradient(90deg, #030305 0%, rgba(3,3,5,0.55) 30%, rgba(3,3,5,0) 60%)" }} />
        {/* the nation's flag, tilted, with a trend arrow */}
        <div style={{ position: "absolute", left: 150, top: 150, width: 360, height: 360, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: `radial-gradient(circle, ${tone}55 0%, ${tone}00 65%)` }} />
        {img ? (
          <img src={img} width={300} height={300} style={{ position: "absolute", left: 180, top: 170, borderRadius: 36, objectFit: "cover", border: "6px solid #030305", transform: "rotate(-6deg)" }} alt="" />
        ) : (
          <div style={{ position: "absolute", left: 160, top: 210, width: 340, height: 228, display: "flex", borderRadius: 20, overflow: "hidden", border: "6px solid #030305", transform: "rotate(-6deg)", boxShadow: `0 0 90px ${e.primary}aa` }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ flex: 1, background: e.primary }} />
              <div style={{ flex: 1, background: e.secondary }} />
            </div>
            <div style={{ position: "absolute", left: 0, top: 0, width: 340, height: 228, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 130, fontWeight: 700, color: e.accent }}>
              {p.ticker.slice(0, 1)}
            </div>
          </div>
        )}
        <svg width="150" height="150" viewBox="0 0 24 24" style={{ position: "absolute", left: 400, top: up ? 90 : 430 }}>
          <path d={up ? "M12 2 22 13h-6v9H8v-9H2Z" : "M12 22 2 11h6V2h8v9h6Z"} fill={tone} stroke="#030305" strokeWidth="1.2" />
        </svg>
        <div style={{ position: "absolute", right: 34, bottom: 30, display: "flex", padding: "10px 16px", borderRadius: 12, background: "#030305", border: `2px solid ${UP}`, color: UP, fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
          VERIFIED ON-CHAIN
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginLeft: 8 }}>
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4Z" fill={UP} />
          </svg>
        </div>
      </div>

      {/* text side */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 0 48px 64px", width: 680 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 20, color: "#cfd4e0" }}>
          <span style={{ color: GOLD, marginRight: 4 }}>[</span>
          <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginRight: 8 }}>
            <path d="M12 0 14.2 9.8 24 12 14.2 14.2 12 24 9.8 14.2 0 12 9.8 9.8Z" fill={GOLD} />
          </svg>
          atlaspad
          <span style={{ color: GOLD, marginLeft: 4 }}>]</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 54 }}>
          <div style={{ display: "flex", width: 46, height: 32, borderRadius: 6, overflow: "hidden", marginRight: 16, flexDirection: "column" }}>
            <div style={{ flex: 1, background: e.primary }} />
            <div style={{ flex: 1, background: e.secondary }} />
          </div>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>{`$${p.ticker}`}</div>
        </div>
        <div style={{ display: "flex", fontSize: headline.length > 9 ? 84 : 104, fontWeight: 700, color: tone, lineHeight: 1.05, marginTop: 6, letterSpacing: -2 }}>{headline}</div>
        <div style={{ display: "flex", fontSize: 24, color: tone, marginTop: 2 }}>
          {p.pnlWif === null ? `received for ${formatCompact(p.tokensSold)} $${p.ticker}` : `${p.pnlWif >= 0 ? "+" : "−"}${formatWif(Math.abs(p.pnlWif))} realized`}
        </div>

        <div style={{ display: "flex", marginTop: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 230 }}>
            <div style={label}>Entry price</div>
            <div style={value}>{formatPrice(p.entryPriceWif)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 230 }}>
            <div style={label}>Exit price</div>
            <div style={value}>{formatPrice(p.exitPriceWif)}</div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 230 }}>
            <div style={label}>Held</div>
            <div style={value}>{formatHeld(p.heldSeconds)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 230 }}>
            <div style={label}>Sold for</div>
            <div style={value}>{formatWif(p.wifReceived)}</div>
          </div>
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, fontWeight: 500, color: "#eef0f6" }}>{`— ${pnlTagline(pct)}`}</div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 16, color: "#7c859b" }}>
          {`${host} · prices in $WIF · tx ${p.txHash.slice(0, 10)}…${p.txHash.slice(-6)}`}
        </div>
      </div>
    </div>
  );
}

/** A shareable PnL card for one sale, built only from that transaction's indexed on-chain trades. */
export async function GET(req: Request, { params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return new Response("invalid tx", { status: 400 });
  const sql = getSql();
  if (!sql) return new Response("data unavailable", { status: 503 });
  let pnl: SellPnl | null;
  try {
    pnl = await getSellPnl(sql, tx);
  } catch (err) {
    console.error("[pnl-card]", err);
    return new Response("data unavailable", { status: 503 });
  }
  if (!pnl) return new Response("not indexed yet", { status: 404, headers: { "Cache-Control": "no-store" } });
  const host = publicEnv.siteUrl.replace(/^https?:\/\//, "");
  const download = new URL(req.url).searchParams.has("download");
  return new ImageResponse(card(pnl, host), {
    width: W,
    height: H,
    fonts: await loadFonts(),
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      ...(download ? { "Content-Disposition": `attachment; filename="atlaspad-${pnl.ticker}-pnl.png"` } : {}),
    },
  });
}
