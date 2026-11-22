import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { ChevronDown } from "lucide-react";
import type { FuturesInstrument, MarketKline, MarketQuote, Timeframe } from "../types";
import { calcBOLL, calcEMA, calcKDJ, calcMACD, calcRSI, calcSMA } from "../services/indicators";

export type OverlayIndicator = "MA" | "EMA" | "BOLL" | "NONE";
export type SubIndicator = "VOL" | "MACD" | "RSI" | "KDJ";

interface FuturesChartProps {
  instrument: FuturesInstrument;
  klines: MarketKline[];
  quote?: MarketQuote;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  height?: number;
  themeMode?: "dark" | "light-cn";
  compactMobile?: boolean;
}

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "tick", label: "分时" },
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
  { id: "1h", label: "1h" },
  { id: "4h", label: "4h" },
  { id: "1d", label: "日线" },
  { id: "1w", label: "周线" },
];

const MINUTE_OPTIONS: { id: Timeframe; label: string }[] = [
  { id: "1m", label: "1分钟" },
  { id: "5m", label: "5分钟" },
  { id: "15m", label: "15分钟" },
  { id: "30m", label: "30分钟" },
  { id: "1h", label: "1小时" },
  { id: "4h", label: "4小时" },
];

export const FuturesChart: React.FC<FuturesChartProps> = ({
  instrument,
  klines,
  quote,
  timeframe,
  onTimeframeChange,
  height = 440,
  themeMode = "dark",
  compactMobile = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<any>[]>([]);

  const [overlay, setOverlay] = useState<OverlayIndicator>("MA");
  const [subIndicator, setSubIndicator] = useState<SubIndicator>("MACD");
  const [hoverCandle, setHoverCandle] = useState<MarketKline | null>(null);
  const [minuteMenuOpen, setMinuteMenuOpen] = useState<boolean>(false);
  const [overlayMenuOpen, setOverlayMenuOpen] = useState<boolean>(false);

  const isLightCn = themeMode === "light-cn";
  const upColor = isLightCn ? "#D93025" : "#10B981";
  const downColor = isLightCn ? "#16A34A" : "#EF4444";

  const displayCandle = hoverCandle ?? klines[klines.length - 1] ?? null;

  const indicators = useMemo(() => {
    const macdPalette = isLightCn
      ? { up: "rgba(217, 48, 37, 0.78)", down: "rgba(22, 163, 74, 0.78)" }
      : { up: "rgba(16, 185, 129, 0.72)", down: "rgba(239, 68, 68, 0.72)" };

    return {
      ma5: calcSMA(klines, 5),
      ma10: calcSMA(klines, 10),
      ma20: calcSMA(klines, 20),
      ma40: calcSMA(klines, 40),
      ema12: calcEMA(klines, 12),
      ema26: calcEMA(klines, 26),
      boll: calcBOLL(klines, 20, 2),
      macd: calcMACD(klines, 12, 26, 9, macdPalette),
      rsi: calcRSI(klines, 14),
      kdj: calcKDJ(klines, 9, 3, 3),
    };
  }, [klines, isLightCn]);

  // Initialize chart instance once per container/height/theme
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: isLightCn ? "#FFFFFF" : "#0F141F" },
        textColor: isLightCn ? "#64748B" : "#94A3B8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: isLightCn ? 10 : 11,
      },
      grid: {
        vertLines: { color: isLightCn ? "rgba(15, 23, 42, 0.06)" : "rgba(148, 163, 184, 0.06)" },
        horzLines: { color: isLightCn ? "rgba(15, 23, 42, 0.06)" : "rgba(148, 163, 184, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isLightCn ? "rgba(100, 116, 139, 0.45)" : "rgba(148, 163, 184, 0.35)",
          labelBackgroundColor: isLightCn ? "#334155" : "#1E293B",
        },
        horzLine: {
          color: isLightCn ? "rgba(100, 116, 139, 0.45)" : "rgba(148, 163, 184, 0.35)",
          labelBackgroundColor: isLightCn ? "#334155" : "#1E293B",
        },
      },
      rightPriceScale: {
        borderColor: isLightCn ? "#E2E8F0" : "rgba(148, 163, 184, 0.14)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: isLightCn ? "#E2E8F0" : "rgba(148, 163, 184, 0.14)",
        timeVisible: true,
        secondsVisible: timeframe === "tick",
      },
    });

    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      seriesRefs.current = [];
      chart.remove();
      chartRef.current = null;
    };
  }, [height, timeframe, isLightCn]);

  // Rebuild series cleanly whenever instrument/timeframe/indicator config changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const s of seriesRefs.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // ignore if already removed
      }
    }
    seriesRefs.current = [];

    if (klines.length === 0) return;

    const priceFormat = {
      type: "price" as const,
      precision: instrument.pricePrecision,
      minMove: instrument.tickSize,
    };

    // Main series on Pane 0
    if (timeframe === "tick") {
      const area = chart.addSeries(
        AreaSeries,
        {
          lineColor: isLightCn ? "#2563EB" : "#3B82F6",
          topColor: isLightCn ? "rgba(37, 99, 235, 0.20)" : "rgba(59, 130, 246, 0.28)",
          bottomColor: isLightCn ? "rgba(37, 99, 235, 0.01)" : "rgba(59, 130, 246, 0.02)",
          lineWidth: 2,
          priceFormat,
        },
        0
      );
      area.setData(klines.map((k) => ({ time: k.time as Time, value: k.close })));
      seriesRefs.current.push(area);
    } else {
      const candles = chart.addSeries(
        CandlestickSeries,
        {
          upColor,
          downColor,
          borderUpColor: upColor,
          borderDownColor: downColor,
          wickUpColor: upColor,
          wickDownColor: downColor,
          priceFormat,
        },
        0
      );
      candles.setData(
        klines.map((k) => ({
          time: k.time as Time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }))
      );
      seriesRefs.current.push(candles);
    }

    // Overlay Indicators on Pane 0
    if (overlay === "MA") {
      const s5 = chart.addSeries(LineSeries, { color: isLightCn ? "#D97706" : "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const s10 = chart.addSeries(LineSeries, { color: isLightCn ? "#2563EB" : "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const s20 = chart.addSeries(LineSeries, { color: isLightCn ? "#9333EA" : "#A855F7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const s40 = chart.addSeries(LineSeries, { color: isLightCn ? "#BE185D" : "#EC4899", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      s5.setData(indicators.ma5.map((p) => ({ time: p.time as Time, value: p.value })));
      s10.setData(indicators.ma10.map((p) => ({ time: p.time as Time, value: p.value })));
      s20.setData(indicators.ma20.map((p) => ({ time: p.time as Time, value: p.value })));
      s40.setData(indicators.ma40.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(s5, s10, s20, s40);
    } else if (overlay === "EMA") {
      const e12 = chart.addSeries(LineSeries, { color: isLightCn ? "#D97706" : "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const e26 = chart.addSeries(LineSeries, { color: isLightCn ? "#2563EB" : "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      e12.setData(indicators.ema12.map((p) => ({ time: p.time as Time, value: p.value })));
      e26.setData(indicators.ema26.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(e12, e26);
    } else if (overlay === "BOLL") {
      const up = chart.addSeries(LineSeries, { color: isLightCn ? "#D97706" : "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const mid = chart.addSeries(LineSeries, { color: "#64748B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      const low = chart.addSeries(LineSeries, { color: isLightCn ? "#2563EB" : "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat }, 0);
      up.setData(indicators.boll.upper.map((p) => ({ time: p.time as Time, value: p.value })));
      mid.setData(indicators.boll.middle.map((p) => ({ time: p.time as Time, value: p.value })));
      low.setData(indicators.boll.lower.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(up, mid, low);
    }

    // Sub-pane Indicators on Pane 1
    if (subIndicator === "VOL") {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, 1);
      vol.setData(
        klines.map((k) => ({
          time: k.time as Time,
          value: k.volume,
          color:
            k.close >= k.open
              ? isLightCn
                ? "rgba(217, 48, 37, 0.52)"
                : "rgba(16, 185, 129, 0.48)"
              : isLightCn
              ? "rgba(22, 163, 74, 0.52)"
              : "rgba(239, 68, 68, 0.48)",
        }))
      );
      seriesRefs.current.push(vol);
    } else if (subIndicator === "MACD") {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
      const dif = chart.addSeries(LineSeries, { color: isLightCn ? "#D97706" : "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
      const dea = chart.addSeries(LineSeries, { color: isLightCn ? "#2563EB" : "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
      hist.setData(indicators.macd.histogram.map((p) => ({ time: p.time as Time, value: p.value, color: p.color })));
      dif.setData(indicators.macd.dif.map((p) => ({ time: p.time as Time, value: p.value })));
      dea.setData(indicators.macd.dea.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(hist, dif, dea);
    } else if (subIndicator === "RSI") {
      const rsi = chart.addSeries(LineSeries, { color: isLightCn ? "#9333EA" : "#A855F7", lineWidth: 2, priceLineVisible: false }, 1);
      rsi.setData(indicators.rsi.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(rsi);
    } else if (subIndicator === "KDJ") {
      const kLine = chart.addSeries(LineSeries, { color: isLightCn ? "#D97706" : "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
      const dLine = chart.addSeries(LineSeries, { color: isLightCn ? "#2563EB" : "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
      const jLine = chart.addSeries(LineSeries, { color: "#EC4899", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
      kLine.setData(indicators.kdj.k.map((p) => ({ time: p.time as Time, value: p.value })));
      dLine.setData(indicators.kdj.d.map((p) => ({ time: p.time as Time, value: p.value })));
      jLine.setData(indicators.kdj.j.map((p) => ({ time: p.time as Time, value: p.value })));
      seriesRefs.current.push(kLine, dLine, jLine);
    }

    const panes = chart.panes();
    if (panes[1]) {
      panes[1].setHeight(Math.max(88, Math.round(height * 0.25)));
    }

    const candleMap = new Map(klines.map((k) => [k.time, k]));
    const subHandler = (param: { time?: Time }) => {
      if (typeof param.time === "number") {
        setHoverCandle(candleMap.get(param.time) ?? null);
      } else {
        setHoverCandle(null);
      }
    };
    chart.subscribeCrosshairMove(subHandler);
    return () => {
      chart.unsubscribeCrosshairMove(subHandler);
    };
  }, [
    instrument.code,
    instrument.pricePrecision,
    instrument.tickSize,
    timeframe,
    overlay,
    subIndicator,
    klines,
    indicators,
    height,
    isLightCn,
    upColor,
    downColor,
  ]);

  const fmt = (val: number | undefined) =>
    val !== undefined ? val.toFixed(instrument.pricePrecision) : "--";

  const latestMa5 = indicators.ma5[indicators.ma5.length - 1]?.value;
  const latestMa10 = indicators.ma10[indicators.ma10.length - 1]?.value;
  const latestMa20 = indicators.ma20[indicators.ma20.length - 1]?.value;
  const latestMa40 = indicators.ma40[indicators.ma40.length - 1]?.value;
  const latestRsi = indicators.rsi[indicators.rsi.length - 1]?.value;
  const latestMacdDif = indicators.macd.dif[indicators.macd.dif.length - 1]?.value;
  const latestMacdDea = indicators.macd.dea[indicators.macd.dea.length - 1]?.value;

  const isMinuteTf = ["1m", "5m", "15m", "30m", "1h", "4h"].includes(timeframe);
  const activeMinuteLabel = MINUTE_OPTIONS.find((m) => m.id === timeframe)?.label ?? "分钟";

  // Compact Mobile Chinese Futures Chart Layout (matches app screenshot)
  if (compactMobile) {
    return (
      <div className="flex flex-col bg-white text-slate-900 border-y border-slate-200 relative">
        {/* Single-Row Clean Timeframe & MA Bar */}
        <div className="grid grid-cols-6 border-b border-slate-200 bg-white text-xs font-medium relative">
          <button
            type="button"
            onClick={() => {
              onTimeframeChange("tick");
              setMinuteMenuOpen(false);
              setOverlayMenuOpen(false);
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              timeframe === "tick"
                ? "text-[#D93025] font-semibold border-b-2 border-[#D93025]"
                : "text-slate-600"
            }`}
          >
            分时
          </button>
          <button
            type="button"
            onClick={() => {
              onTimeframeChange("5m");
              setMinuteMenuOpen(false);
              setOverlayMenuOpen(false);
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              timeframe === "5m"
                ? "text-[#D93025] font-semibold border-b-2 border-[#D93025]"
                : "text-slate-600"
            }`}
          >
            5分
          </button>

          {/* Minute Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMinuteMenuOpen((v) => !v);
                setOverlayMenuOpen(false);
              }}
              className={`w-full py-2.5 inline-flex items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                isMinuteTf && timeframe !== "5m"
                  ? "text-[#D93025] font-semibold border-b-2 border-[#D93025]"
                  : "text-slate-600"
              }`}
            >
              <span>{isMinuteTf && timeframe !== "5m" ? activeMinuteLabel : "分钟"}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {minuteMenuOpen && (
              <div className="absolute left-0 top-full z-30 w-28 bg-white border border-slate-200 shadow-lg rounded-b-md py-1">
                {MINUTE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onTimeframeChange(opt.id);
                      setMinuteMenuOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs cursor-pointer ${
                      timeframe === opt.id
                        ? "bg-red-50 text-[#D93025] font-semibold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onTimeframeChange("1d");
              setMinuteMenuOpen(false);
              setOverlayMenuOpen(false);
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              timeframe === "1d"
                ? "text-[#D93025] font-semibold border-b-2 border-[#D93025]"
                : "text-slate-600"
            }`}
          >
            日线
          </button>

          <button
            type="button"
            onClick={() => {
              onTimeframeChange("1w");
              setMinuteMenuOpen(false);
              setOverlayMenuOpen(false);
            }}
            className={`py-2.5 text-center transition-colors cursor-pointer ${
              timeframe === "1w"
                ? "text-[#D93025] font-semibold border-b-2 border-[#D93025]"
                : "text-slate-600"
            }`}
          >
            周线
          </button>

          {/* MA / Overlay Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setOverlayMenuOpen((v) => !v);
                setMinuteMenuOpen(false);
              }}
              className="w-full py-2.5 inline-flex items-center justify-center gap-0.5 text-slate-700 font-medium cursor-pointer"
            >
              <span>{overlay === "NONE" ? "裸K" : overlay}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {overlayMenuOpen && (
              <div className="absolute right-0 top-full z-30 w-24 bg-white border border-slate-200 shadow-lg rounded-b-md py-1">
                {(["MA", "EMA", "BOLL", "NONE"] as OverlayIndicator[]).map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => {
                      setOverlay(ind);
                      setOverlayMenuOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs cursor-pointer ${
                      overlay === ind
                        ? "bg-red-50 text-[#D93025] font-semibold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {ind === "NONE" ? "裸K" : ind}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top-left Moving Average / Crosshair Readout Strip */}
        <div className="px-2.5 py-1 bg-white border-b border-slate-100 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-mono tabular-nums text-slate-500">
          {overlay === "MA" && (
            <>
              <span className="text-slate-500 font-sans">MA</span>
              <span className="text-amber-600">MA5:{fmt(latestMa5)}</span>
              <span className="text-blue-600">MA10:{fmt(latestMa10)}</span>
              <span className="text-purple-600">MA20:{fmt(latestMa20)}</span>
              <span className="text-pink-700">MA40:{fmt(latestMa40)}</span>
            </>
          )}
          {overlay === "EMA" && (
            <>
              <span className="text-amber-600">EMA12:{fmt(indicators.ema12[indicators.ema12.length - 1]?.value)}</span>
              <span className="text-blue-600">EMA26:{fmt(indicators.ema26[indicators.ema26.length - 1]?.value)}</span>
            </>
          )}
          {overlay === "BOLL" && (
            <>
              <span className="text-amber-600">UP:{fmt(indicators.boll.upper[indicators.boll.upper.length - 1]?.value)}</span>
              <span className="text-slate-600">MID:{fmt(indicators.boll.middle[indicators.boll.middle.length - 1]?.value)}</span>
              <span className="text-blue-600">LOW:{fmt(indicators.boll.lower[indicators.boll.lower.length - 1]?.value)}</span>
            </>
          )}
          {hoverCandle && (
            <span className="text-slate-700 ml-auto">
              收 {fmt(hoverCandle.close)}
            </span>
          )}
        </div>

        {/* Main & Sub Chart Canvas */}
        <div ref={containerRef} className="w-full" style={{ height }} />

        {/* Bottom Sub-Indicator Switcher & Readout Bar (matches screenshot indicator row) */}
        <div className="px-2.5 py-1.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-1">
            {(["MACD", "RSI", "KDJ", "VOL"] as SubIndicator[]).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSubIndicator(sub)}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                  subIndicator === sub
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                {sub === "VOL" ? "成交量" : sub}
              </button>
            ))}
          </div>

          <div className="font-mono tabular-nums text-[10px] text-slate-600 truncate">
            {subIndicator === "MACD" && (
              <span>
                MACD(12,26,9) DIF:{latestMacdDif?.toFixed(3) ?? "--"} DEA:{latestMacdDea?.toFixed(3) ?? "--"}
              </span>
            )}
            {subIndicator === "RSI" && <span>RSI(14): {latestRsi ?? "--"}</span>}
            {subIndicator === "KDJ" && <span>KDJ(9,3,3)</span>}
            {subIndicator === "VOL" && (
              <span>量: {displayCandle?.volume?.toLocaleString() ?? "--"}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop Institutional Dark Terminal Chart Layout
  return (
    <div className="flex flex-col bg-[#0F141F] border border-slate-800 rounded-xl overflow-hidden">
      {/* Timeframe & Indicator Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 bg-[#111827]">
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => onTimeframeChange(tf.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                timeframe === tf.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border-r border-slate-800 pr-3">
            {(["MA", "EMA", "BOLL", "NONE"] as OverlayIndicator[]).map((ind) => (
              <button
                key={ind}
                type="button"
                onClick={() => setOverlay(ind)}
                className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  overlay === ind
                    ? "bg-slate-700 text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {ind === "NONE" ? "裸K" : ind}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {(["MACD", "RSI", "KDJ", "VOL"] as SubIndicator[]).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSubIndicator(sub)}
                className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  subIndicator === sub
                    ? "bg-slate-700 text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {sub === "VOL" ? "成交量" : sub}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Crosshair / OHLCV Readout Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-800/50 text-xs font-mono tabular-nums text-slate-400 bg-[#0D121C]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-200 font-semibold">{instrument.activeContract}</span>
          <span>开 {fmt(displayCandle?.open)}</span>
          <span>高 {fmt(displayCandle?.high)}</span>
          <span>低 {fmt(displayCandle?.low)}</span>
          <span
            className={
              displayCandle && displayCandle.close >= displayCandle.open
                ? "text-emerald-400"
                : "text-red-400"
            }
          >
            收 {fmt(displayCandle?.close)}
          </span>
          <span>量 {displayCandle?.volume?.toLocaleString() ?? "--"}</span>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          {overlay === "MA" && (
            <>
              <span className="text-amber-400">MA5 {fmt(latestMa5)}</span>
              <span className="text-sky-400">MA10 {fmt(latestMa10)}</span>
              <span className="text-purple-400">MA20 {fmt(latestMa20)}</span>
              <span className="text-pink-400">MA40 {fmt(latestMa40)}</span>
            </>
          )}
          {subIndicator === "RSI" && <span className="text-purple-400">RSI(14) {latestRsi ?? "--"}</span>}
          {subIndicator === "MACD" && <span className="text-amber-400">DIF {latestMacdDif?.toFixed(3) ?? "--"}</span>}
          {quote && <span className="text-slate-500">{quote.sourceName}</span>}
        </div>
      </div>

      {/* Lightweight Charts v5 Canvas */}
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  );
};
