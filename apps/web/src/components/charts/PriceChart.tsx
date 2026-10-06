"use client";
import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleDTO } from "@atlaspad/shared";
import { formatSmall } from "@atlaspad/shared";

const baseOptions = {
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#5f6880", fontFamily: "JetBrains Mono Variable, monospace", fontSize: 10, attributionLogo: false },
  grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
  rightPriceScale: { borderColor: "rgba(255,255,255,0.07)" },
  timeScale: { borderColor: "rgba(255,255,255,0.07)", timeVisible: true, secondsVisible: false },
  crosshair: { mode: CrosshairMode.Normal },
};

/** Candlesticks + volume from indexed trades (prices in ETH per token). */
export function PriceChart({ candles, height = 320 }: { candles: CandleDTO[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ c: ISeriesApi<"Candlestick">; v: ISeriesApi<"Histogram"> } | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, { ...baseOptions, height, autoSize: true, localization: { priceFormatter: (p: number) => formatSmall(p, 4) } });
    const cs = c.addSeries(CandlestickSeries, {
      upColor: "#35d29a",
      downColor: "#ff5a6e",
      borderVisible: false,
      wickUpColor: "#35d29a",
      wickDownColor: "#ff5a6e",
      priceFormat: { type: "custom", formatter: (p: number) => formatSmall(p, 4), minMove: 1e-18 },
    });
    const vs = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(214,178,110,0.25)" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    series.current = { c: cs, v: vs };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!series.current) return;
    series.current.c.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    series.current.v.setData(
      candles.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "rgba(53,210,154,0.28)" : "rgba(255,90,110,0.28)" })),
    );
    chart.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={el} style={{ height }} className="w-full" />;
}

/** Small area chart for a single series (market cap, citizens, liquidity, …). */
export function AreaChart({
  points,
  color = "#d6b26e",
  height = 140,
  format = (v: number) => formatSmall(v, 3),
}: {
  points: { time: number; value: number }[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const s = useRef<ISeriesApi<"Area"> | null>(null);
  const c = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      ...baseOptions,
      height,
      autoSize: true,
      handleScroll: false,
      handleScale: false,
      timeScale: { ...baseOptions.timeScale, visible: false },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      localization: { priceFormatter: format },
    });
    s.current = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}55`,
      bottomColor: `${color}00`,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    c.current = chart;
    return () => chart.remove();
  }, [color, height, format]);
  useEffect(() => {
    s.current?.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    c.current?.timeScale().fitContent();
  }, [points]);
  return <div ref={el} style={{ height }} className="w-full" />;
}
