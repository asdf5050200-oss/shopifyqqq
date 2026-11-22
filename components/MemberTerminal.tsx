import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  FileText,
  Monitor,
  RefreshCw,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import type {
  AccountLedgerEntry,
  FuturesInstrument,
  InstrumentCode,
  MarketEngineHealth,
  MarketKline,
  MarketQuote,
  OrderSide,
  OrderType,
  Tenant,
  Timeframe,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradingAccount,
  User,
} from "../types";
import { api } from "../services/apiClient";
import { FuturesChart } from "./FuturesChart";
import { InfoTip, getClassificationDisplay } from "./InfoCollapse";

interface MemberTerminalProps {
  currentUser: User;
  currentTenant: Tenant | null;
  quotes: MarketQuote[];
  feedHealth: MarketEngineHealth | null;
  lastTickSignal: number;
}

type BlotterTab = "positions" | "pending" | "history" | "executions" | "ledger";
type MobileNavTab = "market" | "trade" | "positions" | "account";

function fmtUsd(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "$0.00";
  const sign = val < 0 ? "-" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const MemberTerminal: React.FC<MemberTerminalProps> = ({
  currentUser,
  currentTenant,
  quotes,
  feedHealth,
  lastTickSignal,
}) => {
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [instruments, setInstruments] = useState<FuturesInstrument[]>([]);
  const [positions, setPositions] = useState<TradePosition[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [ledger, setLedger] = useState<AccountLedgerEntry[]>([]);

  const [selectedCode, setSelectedCode] = useState<InstrumentCode>("WTI");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [klines, setKlines] = useState<MarketKline[]>([]);

  // Order ticket state
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPriceInput, setLimitPriceInput] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // UI view controls
  const [blotterTab, setBlotterTab] = useState<BlotterTab>("positions");
  const [mobilePreview, setMobilePreview] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );
  const [mobileTab, setMobileTab] = useState<MobileNavTab>("trade");
  const [mobileOrderSheetSide, setMobileOrderSheetSide] = useState<OrderSide | null>(null);
  const [mobileContractSheetOpen, setMobileContractSheetOpen] = useState<boolean>(false);

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await api.getMemberWorkspace();
      setAccount(data.account);
      setInstruments(data.instruments);
      setPositions(data.positions);
      setOrders(data.orders);
      setExecutions(data.executions);
      setLedger(data.ledger);
      if (data.instruments.length > 0 && !data.instruments.some((i) => i.code === selectedCode)) {
        setSelectedCode(data.instruments[0].code);
      }
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "加载失败" });
    }
  }, [selectedCode]);

  const loadKlines = useCallback(async () => {
    try {
      const res = await api.getKlines(selectedCode, timeframe);
      setKlines(res.klines);
    } catch {
      // ignore transient poll error
    }
  }, [selectedCode, timeframe]);

  useEffect(() => {
    loadWorkspace();
  }, [currentUser.id, loadWorkspace]);

  useEffect(() => {
    loadKlines();
  }, [loadKlines, lastTickSignal]);

  useEffect(() => {
    if (lastTickSignal > 0) {
      loadWorkspace();
    }
  }, [lastTickSignal, loadWorkspace]);

  const quoteMap = useMemo(() => new Map(quotes.map((q) => [q.instrumentCode, q])), [quotes]);

  const activeInstrument = useMemo(
    () => instruments.find((i) => i.code === selectedCode) ?? instruments[0] ?? null,
    [instruments, selectedCode]
  );

  const activeQuote = activeInstrument ? quoteMap.get(activeInstrument.code) : undefined;

  useEffect(() => {
    if (orderType === "LIMIT" && activeQuote && activeQuote.lastPrice !== null && !limitPriceInput) {
      setLimitPriceInput(activeQuote.lastPrice.toFixed(activeInstrument?.pricePrecision ?? 2));
    }
  }, [orderType, activeQuote, activeInstrument, limitPriceInput]);

  const estimatedOrder = useMemo(() => {
    if (!activeInstrument || !activeQuote || activeQuote.lastPrice === null) return { margin: 0, fee: 0, total: 0 };
    const refPrice =
      orderType === "LIMIT" && Number(limitPriceInput) > 0 ? Number(limitPriceInput) : activeQuote.lastPrice;
    const lots = Math.max(1, Math.floor(quantity || 1));
    const margin = refPrice * activeInstrument.multiplier * lots * activeInstrument.initialMarginRate;
    const fee = activeInstrument.feePerLot * lots;
    return { margin, fee, total: margin + fee };
  }, [activeInstrument, activeQuote, orderType, limitPriceInput, quantity]);

  const handleOpenOrder = async (side: OrderSide) => {
    if (!activeInstrument || submitting) return;
    setSubmitting(true);
    setFeedback(null);
    const key = `ord-${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await api.submitOrder({
        instrumentCode: activeInstrument.code,
        orderType,
        side,
        positionEffect: "OPEN",
        quantity: Math.max(1, Math.floor(quantity || 1)),
        limitPrice: orderType === "LIMIT" ? Number(limitPriceInput) : null,
        idempotencyKey: key,
      });
      setAccount(res.account);
      setFeedback({
        type: "success",
        text:
          res.order.status === "FILLED"
            ? `${activeInstrument.activeContract} ${side === "BUY" ? "买多" : "卖空"} ${res.order.quantity}手 @ ${res.order.avgFillPrice?.toFixed(activeInstrument.pricePrecision)}`
            : `${activeInstrument.activeContract} 限价挂单 ${res.order.quantity}手 @ ${res.order.limitPrice}`,
      });
      await loadWorkspace();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "下单失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClosePosition = async (pos: TradePosition) => {
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    const key = `close-${pos.id}-${Date.now()}`;
    try {
      const side: OrderSide = pos.direction === "LONG" ? "SELL" : "BUY";
      const res = await api.submitOrder({
        instrumentCode: pos.instrumentCode,
        orderType: "MARKET",
        side,
        positionEffect: "CLOSE",
        quantity: pos.quantity,
        idempotencyKey: key,
      });
      setAccount(res.account);
      setFeedback({
        type: "success",
        text: `${pos.contractCode} 已平仓 ${pos.quantity}手 · 盈亏 ${fmtUsd(res.execution?.realizedPnl)}`,
      });
      await loadWorkspace();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "平仓失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setFeedback(null);
    try {
      await api.cancelOrder(orderId);
      setFeedback({ type: "success", text: `已撤单 ${orderId}` });
      await loadWorkspace();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "撤单失败" });
    }
  };

  const pendingOrders = orders.filter((o) => o.status === "PENDING" || o.status === "PARTIAL_FILLED");
  const equity = account ? account.balance + account.unrealizedPnl : 0;

  const renderOrderTicket = () => (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-sm font-semibold text-slate-100 truncate">
            {activeInstrument ? `${activeInstrument.name} · ${activeInstrument.activeContract}` : "--"}
          </div>
          {activeInstrument && (
            <InfoTip
              text={`${activeInstrument.multiplier.toLocaleString()} ${activeInstrument.unitLabel} · 初始保证金 ${(activeInstrument.initialMarginRate * 100).toFixed(1)}% · 手续费 $${activeInstrument.feePerLot.toFixed(2)}/手`}
              label="合约参数"
            />
          )}
        </div>
        <span className="text-xs font-mono text-slate-400 shrink-0">模拟委托</span>
      </div>

      {/* Order Type Segmented Switch */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B0F17] rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setOrderType("MARKET")}
          className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            orderType === "MARKET" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          市价
        </button>
        <button
          type="button"
          onClick={() => {
            setOrderType("LIMIT");
            if (activeQuote && activeQuote.lastPrice !== null && activeInstrument) {
              setLimitPriceInput(activeQuote.lastPrice.toFixed(activeInstrument.pricePrecision));
            }
          }}
          className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            orderType === "LIMIT" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          限价
        </button>
      </div>

      {/* Price Input */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>{orderType === "MARKET" ? "盘口价" : "限价 (USD)"}</span>
          {activeQuote && activeInstrument && (
            <span className="font-mono tabular-nums text-slate-300">
              买一 {activeQuote.bidPrice !== null ? activeQuote.bidPrice.toFixed(activeInstrument.pricePrecision) : "--"} / 卖一{" "}
              {activeQuote.askPrice !== null ? activeQuote.askPrice.toFixed(activeInstrument.pricePrecision) : "--"}
            </span>
          )}
        </div>
        {orderType === "MARKET" ? (
          <div className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs font-mono tabular-nums text-slate-300">
            最优盘口成交
          </div>
        ) : (
          <input
            type="number"
            step={activeInstrument?.tickSize ?? 0.01}
            value={limitPriceInput}
            onChange={(e) => setLimitPriceInput(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 focus:border-blue-500 focus:outline-none text-sm font-mono tabular-nums text-slate-100"
          />
        )}
      </div>

      {/* Quantity Input */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>手数</span>
          <span className="font-mono tabular-nums">限 {activeInstrument?.maxLotsPerOrder ?? 50} 手</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="px-3 py-2 bg-[#0B0F17] border border-slate-700 rounded-lg text-slate-200 hover:bg-slate-800 text-sm font-mono cursor-pointer"
          >
            -
          </button>
          <input
            type="number"
            min={1}
            max={activeInstrument?.maxLotsPerOrder ?? 50}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="flex-1 px-3 py-2 text-center rounded-lg bg-[#0B0F17] border border-slate-700 focus:border-blue-500 focus:outline-none text-sm font-mono tabular-nums text-slate-100"
          />
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(activeInstrument?.maxLotsPerOrder ?? 50, q + 1))}
            className="px-3 py-2 bg-[#0B0F17] border border-slate-700 rounded-lg text-slate-200 hover:bg-slate-800 text-sm font-mono cursor-pointer"
          >
            +
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5 mt-2">
          {[1, 2, 5, 10].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setQuantity(preset)}
              className={`py-1 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
                quantity === preset
                  ? "bg-slate-800 border-blue-500 text-blue-300"
                  : "bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {preset} 手
            </button>
          ))}
        </div>
      </div>

      {/* Margin & Fee Summary */}
      <div className="border-t border-slate-800 pt-3 space-y-1.5 text-xs">
        <div className="flex justify-between text-slate-400">
          <span>保证金</span>
          <span className="font-mono tabular-nums text-slate-200">{fmtUsd(estimatedOrder.margin)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>手续费</span>
          <span className="font-mono tabular-nums text-slate-200">{fmtUsd(estimatedOrder.fee)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>可用资金</span>
          <span className="font-mono tabular-nums text-blue-400">{fmtUsd(account?.availableFunds)}</span>
        </div>
      </div>

      {/* Buy / Sell Action Buttons */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <button
          type="button"
          disabled={submitting || !activeInstrument || !activeQuote || activeQuote.lastPrice === null}
          onClick={() => handleOpenOrder("BUY")}
          className="py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex flex-col items-center cursor-pointer"
        >
          <span>买入开多</span>
          <span className="text-[11px] font-mono tabular-nums opacity-90">
            {activeQuote && activeInstrument && (activeQuote.askPrice ?? activeQuote.lastPrice) !== null
              ? (activeQuote.askPrice ?? activeQuote.lastPrice)!.toFixed(activeInstrument.pricePrecision)
              : "--"}
          </span>
        </button>
        <button
          type="button"
          disabled={submitting || !activeInstrument || !activeQuote || activeQuote.lastPrice === null}
          onClick={() => handleOpenOrder("SELL")}
          className="py-2.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex flex-col items-center cursor-pointer"
        >
          <span>卖出开空</span>
          <span className="text-[11px] font-mono tabular-nums opacity-90">
            {activeQuote && activeInstrument && (activeQuote.bidPrice ?? activeQuote.lastPrice) !== null
              ? (activeQuote.bidPrice ?? activeQuote.lastPrice)!.toFixed(activeInstrument.pricePrecision)
              : "--"}
          </span>
        </button>
      </div>
    </div>
  );

  const cycleInstrument = (delta: number) => {
    if (instruments.length <= 1) return;
    const idx = instruments.findIndex((i) => i.code === activeInstrument?.code);
    const nextIdx = (idx + delta + instruments.length) % instruments.length;
    setSelectedCode(instruments[nextIdx].code);
    setLimitPriceInput("");
  };

  // Mobile-First Native App View (Red-Up / Green-Down)
  if (mobilePreview) {
    const isUp = (activeQuote?.change ?? 0) >= 0;
    const priceTone = isUp ? "text-[#D93025]" : "text-[#16A34A]";

    return (
      <div className="max-w-7xl mx-auto px-0 sm:px-4 py-0 sm:py-4">
        <div className="hidden sm:flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-xs text-slate-400">
            <span>{currentTenant?.brandName || "汇通财经"}</span>
            <span className="mx-2">·</span>
            <span className="font-mono">{account?.accountNo || "--"}</span>
          </div>
          <button
            type="button"
            onClick={() => setMobilePreview(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>桌面终端</span>
          </button>
        </div>

        <div className="w-full sm:max-w-[420px] sm:mx-auto bg-white text-slate-900 sm:border sm:border-slate-300 sm:shadow-2xl sm:rounded-[24px] overflow-hidden flex flex-col min-h-[calc(100dvh-3.5rem)] sm:min-h-[780px] relative">
          {/* App Top Bar */}
          {mobileTab === "trade" && activeInstrument ? (
            <div className="px-3 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMobileTab("market")}
                className="p-1.5 text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
                aria-label="行情"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => cycleInstrument(-1)}
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  aria-label="上一品种"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center leading-tight">
                  <div className="text-[15px] font-bold text-slate-900">{activeInstrument.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {activeInstrument.activeContract} · {activeInstrument.marketSymbol}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cycleInstrument(1)}
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  aria-label="下一品种"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setMobileContractSheetOpen(true)}
                className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
              >
                合约
              </button>
            </div>
          ) : (
            <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {currentTenant?.brandName || "汇通财经"}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {currentUser.name} · 净值 {fmtUsd(equity)}
                </div>
              </div>
              <button
                type="button"
                onClick={loadWorkspace}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
                aria-label="刷新"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}

          {feedback && (
            <div
              className={`mx-3 mt-2 px-3 py-2 rounded text-xs flex items-center justify-between ${
                feedback.type === "error"
                  ? "bg-red-50 border border-red-200 text-[#D93025]"
                  : "bg-emerald-50 border border-emerald-200 text-emerald-700"
              }`}
            >
              <span>{feedback.text}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="ml-2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Mobile Content Body */}
          <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
            {mobileTab === "market" && (
              <div className="bg-white divide-y divide-slate-100">
                <div className="px-4 py-2 bg-[#F8FAFC] border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                  <span>品种</span>
                  <span>最新价 · 涨跌</span>
                </div>
                {instruments.map((inst) => {
                  const q = quoteMap.get(inst.code);
                  const up = (q?.changePct ?? 0) >= 0;
                  return (
                    <button
                      key={inst.code}
                      type="button"
                      onClick={() => {
                        setSelectedCode(inst.code);
                        setLimitPriceInput("");
                        setMobileTab("trade");
                      }}
                      className="w-full px-4 py-3.5 hover:bg-slate-50 flex items-center justify-between text-left cursor-pointer"
                    >
                      <div>
                        <div className="text-sm font-bold text-slate-900">{inst.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {inst.activeContract} · {inst.exchangeLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 font-mono tabular-nums">
                        <div className={`text-[15px] font-bold ${up ? "text-[#D93025]" : "text-[#16A34A]"}`}>
                          {q && q.lastPrice !== null ? q.lastPrice.toFixed(inst.pricePrecision) : "--"}
                        </div>
                        <div
                          className={`min-w-[68px] py-1 px-2 rounded text-right text-xs font-semibold text-white ${
                            q && q.lastPrice !== null ? (up ? "bg-[#D93025]" : "bg-[#16A34A]") : "bg-slate-400"
                          }`}
                        >
                          {q && q.lastPrice !== null ? `${up ? "+" : ""}${q.changePct.toFixed(2)}%` : "--"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {mobileTab === "trade" && activeInstrument && (
              <div className="flex flex-col bg-white">
                <div className="px-4 pt-3 pb-2.5 flex items-center justify-between">
                  <div
                    className={`text-[32px] leading-none font-bold font-mono tabular-nums flex items-baseline gap-1 ${
                      activeQuote?.lastPrice !== null ? priceTone : "text-slate-400"
                    }`}
                  >
                    <span>
                      {activeQuote && activeQuote.lastPrice !== null
                        ? activeQuote.lastPrice.toFixed(activeInstrument.pricePrecision)
                        : "--"}
                    </span>
                    {activeQuote?.lastPrice !== null && <span className="text-base">{isUp ? "↑" : "↓"}</span>}
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className={`text-sm font-semibold flex items-center justify-end gap-2.5 ${priceTone}`}>
                      <span>
                        {activeQuote && activeQuote.lastPrice !== null
                          ? `${activeQuote.change >= 0 ? "+" : ""}${activeQuote.change.toFixed(
                              activeInstrument.pricePrecision
                            )}`
                          : "--"}
                      </span>
                      <span>
                        {activeQuote && activeQuote.lastPrice !== null
                          ? `${activeQuote.changePct >= 0 ? "+" : ""}${activeQuote.changePct.toFixed(2)}%`
                          : "--"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {getClassificationDisplay(activeQuote?.dataClassification ?? feedHealth?.feedState).label} ·{" "}
                      {activeQuote?.sourceTimestamp ? new Date(activeQuote.sourceTimestamp).toLocaleTimeString() : "--:--:--"}
                    </div>
                  </div>
                </div>

                {/* 4-Column OHLC Bar */}
                <div className="grid grid-cols-4 border-t border-slate-100 bg-[#F8FAFC] py-2 px-2 text-center">
                  <div>
                    <div className="text-[11px] text-slate-500">开盘</div>
                    <div className="text-xs font-mono font-semibold tabular-nums text-slate-800 mt-0.5">
                      {activeQuote && activeQuote.openPrice !== null ? activeQuote.openPrice.toFixed(activeInstrument.pricePrecision) : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">最高</div>
                    <div className="text-xs font-mono font-semibold tabular-nums text-[#D93025] mt-0.5">
                      {activeQuote && activeQuote.highPrice !== null ? activeQuote.highPrice.toFixed(activeInstrument.pricePrecision) : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">最低</div>
                    <div className="text-xs font-mono font-semibold tabular-nums text-[#16A34A] mt-0.5">
                      {activeQuote && activeQuote.lowPrice !== null ? activeQuote.lowPrice.toFixed(activeInstrument.pricePrecision) : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">昨收</div>
                    <div className="text-xs font-mono font-semibold tabular-nums text-slate-800 mt-0.5">
                      {activeQuote && activeQuote.prevClose !== null ? activeQuote.prevClose.toFixed(activeInstrument.pricePrecision) : "--"}
                    </div>
                  </div>
                </div>

                <FuturesChart
                  instrument={activeInstrument}
                  klines={klines}
                  quote={activeQuote}
                  timeframe={timeframe}
                  onTimeframeChange={setTimeframe}
                  height={350}
                  themeMode="light-cn"
                  compactMobile={true}
                />

                {/* Quick Buy / Sell Bar */}
                <div className="p-3 bg-white border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                    <span>可用 {fmtUsd(account?.availableFunds)}</span>
                    <span>
                      持仓 {positions.filter((p) => p.instrumentCode === activeInstrument.code).reduce((s, p) => s + p.quantity, 0)} 手
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={submitting || !activeQuote || activeQuote.lastPrice === null}
                      onClick={() => setMobileOrderSheetSide("BUY")}
                      className="py-2.5 px-3 rounded-lg bg-[#D93025] hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>买入开多</span>
                      <span className="font-mono tabular-nums text-[12px]">
                        {activeQuote && (activeQuote.askPrice ?? activeQuote.lastPrice) !== null
                          ? (activeQuote.askPrice ?? activeQuote.lastPrice)!.toFixed(activeInstrument.pricePrecision)
                          : "--"}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !activeQuote || activeQuote.lastPrice === null}
                      onClick={() => setMobileOrderSheetSide("SELL")}
                      className="py-2.5 px-3 rounded-lg bg-[#16A34A] hover:bg-green-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>卖出开空</span>
                      <span className="font-mono tabular-nums text-[12px]">
                        {activeQuote && (activeQuote.bidPrice ?? activeQuote.lastPrice) !== null
                          ? (activeQuote.bidPrice ?? activeQuote.lastPrice)!.toFixed(activeInstrument.pricePrecision)
                          : "--"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mobileTab === "positions" && (
              <div className="p-3 space-y-2.5">
                <div className="text-xs font-semibold text-slate-600">持仓 ({positions.length})</div>
                {positions.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded-lg">
                    暂无持仓
                  </div>
                ) : (
                  positions.map((pos) => (
                    <div key={pos.id} className="p-3 rounded-lg bg-white border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold ${
                              pos.direction === "LONG" ? "text-[#D93025]" : "text-[#16A34A]"
                            }`}
                          >
                            {pos.direction === "LONG" ? "多" : "空"}
                          </span>
                          <span className="text-sm font-bold text-slate-900">{pos.contractCode}</span>
                          <span className="text-xs font-mono text-slate-500">{pos.quantity} 手</span>
                        </div>
                        <span
                          className={`text-sm font-mono font-bold tabular-nums ${
                            pos.unrealizedPnl >= 0 ? "text-[#D93025]" : "text-[#16A34A]"
                          }`}
                        >
                          {pos.unrealizedPnl >= 0 ? "+" : ""}
                          {fmtUsd(pos.unrealizedPnl)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                        <span>开 {pos.avgOpenPrice} · 现 {pos.markPrice}</span>
                        <button
                          type="button"
                          onClick={() => handleClosePosition(pos)}
                          className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs cursor-pointer"
                        >
                          平仓
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <div className="text-xs font-semibold text-slate-600 pt-2">挂单 ({pendingOrders.length})</div>
                {pendingOrders.map((ord) => (
                  <div key={ord.id} className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-slate-900 font-semibold">
                        {ord.contractCode} · {ord.side === "BUY" ? "买" : "卖"} {ord.quantity}手
                      </div>
                      <div className="text-slate-500 font-mono">限价 {ord.limitPrice}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancelOrder(ord.id)}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-red-50 text-slate-700 border border-slate-200 cursor-pointer"
                    >
                      撤单
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mobileTab === "account" && account && (
              <div className="p-3 space-y-3">
                <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">动态净值</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">{fmtUsd(equity)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">可用资金</span>
                    <span className="font-mono font-semibold text-blue-600 tabular-nums">{fmtUsd(account.availableFunds)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">保证金 / 冻结</span>
                    <span className="font-mono text-slate-800 tabular-nums">
                      {fmtUsd(account.usedMargin)} / {fmtUsd(account.frozenFunds)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">风险率</span>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                      {account.usedMargin > 0 ? `${account.riskRatio.toFixed(1)}%` : "安全"}
                    </span>
                  </div>
                </div>

                <div className="text-xs font-semibold text-slate-600">资金流水</div>
                <div className="space-y-1.5">
                  {ledger.slice(0, 8).map((entry) => (
                    <div key={entry.id} className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between text-xs">
                      <div className="min-w-0 pr-2">
                        <div className="text-slate-800 truncate">{entry.remark}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 ${
                          entry.amount >= 0 ? "text-[#D93025]" : "text-[#16A34A]"
                        }`}
                      >
                        {entry.amount >= 0 ? "+" : ""}
                        {fmtUsd(entry.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mobile Bottom Navigation */}
          <div className="grid grid-cols-4 border-t border-slate-200 bg-white pb-safe sticky bottom-0 z-20">
            {(
              [
                { id: "market", label: "行情", Icon: FileText },
                { id: "trade", label: "图表", Icon: BarChart2 },
                { id: "positions", label: `持仓(${positions.length})`, Icon: Briefcase },
                { id: "account", label: "资产", Icon: Wallet },
              ] as { id: MobileNavTab; label: string; Icon: React.ComponentType<{ className?: string }> }[]
            ).map(({ id, label, Icon }) => {
              const active = mobileTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMobileTab(id)}
                  className={`py-2 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                    active ? "text-[#D93025]" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Mobile Order Drawer Sheet */}
          {mobileOrderSheetSide && activeInstrument && (
            <div className="absolute inset-0 z-40 bg-black/45 flex items-end">
              <div className="w-full bg-white rounded-t-2xl p-4 space-y-3 border-t border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {activeInstrument.name} · {mobileOrderSheetSide === "BUY" ? "买入开多" : "卖出开空"}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {activeInstrument.activeContract} · 模拟盘
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOrderSheetSide(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-md">
                  <button
                    type="button"
                    onClick={() => setOrderType("MARKET")}
                    className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                      orderType === "MARKET" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    市价
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType("LIMIT");
                      if (activeQuote && activeQuote.lastPrice !== null) {
                        setLimitPriceInput(activeQuote.lastPrice.toFixed(activeInstrument.pricePrecision));
                      }
                    }}
                    className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                      orderType === "LIMIT" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    限价
                  </button>
                </div>

                {orderType === "LIMIT" ? (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">限价 (USD)</label>
                    <input
                      type="number"
                      step={activeInstrument.tickSize}
                      value={limitPriceInput}
                      onChange={(e) => setLimitPriceInput(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 text-sm font-mono tabular-nums text-slate-900"
                    />
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-600 flex justify-between">
                    <span>盘口价</span>
                    <span className="font-semibold text-slate-900">
                      {activeQuote && (mobileOrderSheetSide === "BUY" ? (activeQuote.askPrice ?? activeQuote.lastPrice) : (activeQuote.bidPrice ?? activeQuote.lastPrice)) !== null
                        ? (mobileOrderSheetSide === "BUY" ? (activeQuote.askPrice ?? activeQuote.lastPrice) : (activeQuote.bidPrice ?? activeQuote.lastPrice))!.toFixed(
                            activeInstrument.pricePrecision
                          )
                        : "--"}
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>手数</span>
                    <span>限 {activeInstrument.maxLotsPerOrder} 手</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 font-mono cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={activeInstrument.maxLotsPerOrder}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="flex-1 px-3 py-1.5 text-center rounded border border-slate-300 text-sm font-mono tabular-nums text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.min(activeInstrument.maxLotsPerOrder, q + 1))}
                      className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 font-mono cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[1, 2, 5, 10].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setQuantity(preset)}
                        className={`py-1 text-xs font-mono rounded border cursor-pointer ${
                          quantity === preset
                            ? "border-[#D93025] bg-red-50 text-[#D93025] font-semibold"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {preset}手
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-2 space-y-1 text-xs font-mono tabular-nums">
                  <div className="flex justify-between text-slate-500">
                    <span>保证金 / 手续费</span>
                    <span className="text-slate-900">
                      {fmtUsd(estimatedOrder.margin)} / {fmtUsd(estimatedOrder.fee)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>可用资金</span>
                    <span className="text-blue-600 font-semibold">{fmtUsd(account?.availableFunds)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    const side = mobileOrderSheetSide;
                    await handleOpenOrder(side);
                    setMobileOrderSheetSide(null);
                  }}
                  className={`w-full py-2.5 rounded-lg text-white text-sm font-bold cursor-pointer ${
                    mobileOrderSheetSide === "BUY"
                      ? "bg-[#D93025] hover:bg-red-700"
                      : "bg-[#16A34A] hover:bg-green-700"
                  }`}
                >
                  {submitting
                    ? "提交中..."
                    : `确认${mobileOrderSheetSide === "BUY" ? "买入开多" : "卖出开空"} ${quantity}手`}
                </button>
              </div>
            </div>
          )}

          {/* Contract Specification Sheet */}
          {mobileContractSheetOpen && activeInstrument && (
            <div className="absolute inset-0 z-40 bg-black/45 flex items-end">
              <div className="w-full bg-white rounded-t-2xl p-4 space-y-2.5 border-t border-slate-200 text-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-sm font-bold text-slate-900">
                    {activeInstrument.name} 合约参数
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileContractSheetOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">合约 / 交易所</span>
                  <span className="font-mono text-slate-900">
                    {activeInstrument.activeContract} · {activeInstrument.exchangeLabel}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">乘数 / 跳动</span>
                  <span className="font-mono text-slate-900">
                    {activeInstrument.multiplier} {activeInstrument.unitLabel} / {activeInstrument.tickSize}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">初始 / 维持保证金</span>
                  <span className="font-mono text-slate-900">
                    {(activeInstrument.initialMarginRate * 100).toFixed(1)}% /{" "}
                    {(activeInstrument.maintenanceMarginRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">交易时段</span>
                  <span className="font-mono text-slate-900">{activeInstrument.sessionLabel}</span>
                </div>
                <div className="text-[11px] text-slate-500 pt-1">模拟盘 · 虚拟资金</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop Institutional Trading Terminal
  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4 space-y-3">
      {/* Account Summary Strip */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-xs">
          <div>
            <div className="text-slate-400">代理商</div>
            <div className="text-sm font-semibold text-slate-100 mt-0.5">
              {currentTenant?.brandName || "--"}
            </div>
          </div>
          <div>
            <div className="text-slate-400">动态净值</div>
            <div className="text-sm font-mono font-semibold text-slate-100 tabular-nums mt-0.5">
              {fmtUsd(equity)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">可用资金</div>
            <div className="text-sm font-mono font-semibold text-blue-400 tabular-nums mt-0.5">
              {fmtUsd(account?.availableFunds)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">占用保证金</div>
            <div className="text-sm font-mono font-medium text-slate-200 tabular-nums mt-0.5">
              {fmtUsd(account?.usedMargin)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">浮动盈亏</div>
            <div
              className={`text-sm font-mono font-semibold tabular-nums mt-0.5 ${
                (account?.unrealizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(account?.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
              {fmtUsd(account?.unrealizedPnl)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">风险率</div>
            <div
              className={`text-sm font-mono font-semibold tabular-nums mt-0.5 ${
                account && account.usedMargin > 0 && account.riskRatio < 140
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {account && account.usedMargin > 0 ? `${account.riskRatio.toFixed(1)}%` : "安全"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400 hidden xl:inline">模拟盘</span>
          <button
            type="button"
            onClick={() => setMobilePreview(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>手机视图</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs flex items-center justify-between ${
            feedback.type === "error"
              ? "bg-red-950/70 border border-red-800 text-red-200"
              : "bg-emerald-950/70 border border-emerald-800 text-emerald-200"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100 ml-4 cursor-pointer"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main 3-Column Workstation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Watchlist */}
        <div className="lg:col-span-3 xl:col-span-2 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">交易品种</span>
            <span className="text-[11px] font-mono text-slate-500">{instruments.length}</span>
          </div>
          <div className="divide-y divide-slate-800/70">
            {instruments.map((inst) => {
              const q = quoteMap.get(inst.code);
              const isSelected = inst.code === activeInstrument?.code;
              const up = (q?.changePct ?? 0) >= 0;
              return (
                <button
                  key={inst.code}
                  type="button"
                  onClick={() => {
                    setSelectedCode(inst.code);
                    setLimitPriceInput("");
                  }}
                  className={`w-full px-3 py-2.5 text-left transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected ? "bg-blue-600/15" : "hover:bg-slate-800/50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">{inst.name}</div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {inst.activeContract} · {inst.marketSymbol}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0 ml-2">
                    <div
                      className={`text-xs font-semibold ${
                        q?.lastPrice !== null ? (up ? "text-emerald-400" : "text-red-400") : "text-slate-400"
                      }`}
                    >
                      {q && q.lastPrice !== null ? q.lastPrice.toFixed(inst.pricePrecision) : "--"}
                    </div>
                    <div
                      className={`text-[11px] ${
                        q?.lastPrice !== null ? (up ? "text-emerald-400" : "text-red-400") : "text-slate-500"
                      }`}
                    >
                      {q && q.lastPrice !== null ? `${up ? "+" : ""}${q.changePct.toFixed(2)}%` : "--"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Header + K-Line Chart */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-3">
          {activeInstrument && (
            <>
              <div className="bg-[#111827] border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-100">{activeInstrument.name}</h2>
                    <span className="text-xs font-mono text-slate-400">
                      {activeInstrument.activeContract} · {activeInstrument.exchangeLabel}
                    </span>
                    <InfoTip
                      text={`${activeInstrument.sessionLabel} · 最小跳动 ${activeInstrument.tickSize}`}
                      label="交易时段"
                    />
                  </div>
                  <div className="text-xs mt-0.5 font-mono">
                    <span className={getClassificationDisplay(activeQuote?.dataClassification ?? feedHealth?.feedState).toneClass}>
                      {getClassificationDisplay(activeQuote?.dataClassification ?? feedHealth?.feedState).label}
                    </span>
                  </div>
                </div>

                {activeQuote && (
                  <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums">
                    <div>
                      <div
                        className={`text-xl font-bold flex items-center gap-1 ${
                          activeQuote.lastPrice === null
                            ? "text-slate-400"
                            : activeQuote.change >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {activeQuote.lastPrice !== null ? activeQuote.lastPrice.toFixed(activeInstrument.pricePrecision) : "--"}
                        {activeQuote.lastPrice !== null &&
                          (activeQuote.change >= 0 ? (
                            <ArrowUpRight className="w-4 h-4" />
                          ) : (
                            <ArrowDownRight className="w-4 h-4" />
                          ))}
                      </div>
                      <div
                        className={`text-xs ${
                          activeQuote.lastPrice === null
                            ? "text-slate-500"
                            : activeQuote.change >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {activeQuote.lastPrice !== null
                          ? `${activeQuote.change >= 0 ? "+" : ""}${activeQuote.change.toFixed(activeInstrument.pricePrecision)} (${activeQuote.changePct.toFixed(2)}%)`
                          : "--"}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 space-y-0.5">
                      <div>高 {activeQuote.highPrice !== null ? activeQuote.highPrice.toFixed(activeInstrument.pricePrecision) : "--"}</div>
                      <div>低 {activeQuote.lowPrice !== null ? activeQuote.lowPrice.toFixed(activeInstrument.pricePrecision) : "--"}</div>
                    </div>
                    <div className="text-xs text-slate-400 space-y-0.5">
                      <div>昨收 {activeQuote.prevClose !== null ? activeQuote.prevClose.toFixed(activeInstrument.pricePrecision) : "--"}</div>
                      <div>量 {activeQuote.volume !== null ? activeQuote.volume.toLocaleString() : "--"}</div>
                    </div>
                  </div>
                )}
              </div>

              <FuturesChart
                instrument={activeInstrument}
                klines={klines}
                quote={activeQuote}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                height={430}
              />
            </>
          )}
        </div>

        {/* Order Ticket */}
        <div className="lg:col-span-3 xl:col-span-3">{renderOrderTicket()}</div>
      </div>

      {/* Bottom Tabbed Blotter */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-800 overflow-x-auto">
          {(
            [
              { id: "positions", label: `持仓 (${positions.length})` },
              { id: "pending", label: `挂单 (${pendingOrders.length})` },
              { id: "history", label: `委托 (${orders.length})` },
              { id: "executions", label: `成交 (${executions.length})` },
              { id: "ledger", label: `账本 (${ledger.length})` },
            ] as { id: BlotterTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBlotterTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                blotterTab === tab.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {blotterTab === "positions" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 text-left">
                  <th className="py-2.5 px-4 font-medium">合约</th>
                  <th className="py-2.5 px-4 font-medium">方向</th>
                  <th className="py-2.5 px-4 font-medium text-right">手数</th>
                  <th className="py-2.5 px-4 font-medium text-right">开仓价</th>
                  <th className="py-2.5 px-4 font-medium text-right">现价</th>
                  <th className="py-2.5 px-4 font-medium text-right">保证金</th>
                  <th className="py-2.5 px-4 font-medium text-right">浮盈</th>
                  <th className="py-2.5 px-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      暂无持仓
                    </td>
                  </tr>
                ) : (
                  positions.map((pos) => (
                    <tr key={pos.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 font-medium text-slate-100">
                        {pos.contractCode} <span className="text-slate-400 font-normal">· {pos.instrumentCode}</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={pos.direction === "LONG" ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                          {pos.direction === "LONG" ? "多" : "空"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.quantity} 手</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.avgOpenPrice}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.markPrice}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(pos.usedMargin)}</td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                          pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {pos.unrealizedPnl >= 0 ? "+" : ""}
                        {fmtUsd(pos.unrealizedPnl)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleClosePosition(pos)}
                          className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer"
                        >
                          平仓
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {blotterTab === "pending" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 text-left">
                  <th className="py-2.5 px-4 font-medium">时间</th>
                  <th className="py-2.5 px-4 font-medium">合约</th>
                  <th className="py-2.5 px-4 font-medium">方向</th>
                  <th className="py-2.5 px-4 font-medium text-right">限价</th>
                  <th className="py-2.5 px-4 font-medium text-right">手数</th>
                  <th className="py-2.5 px-4 font-medium text-right">冻结</th>
                  <th className="py-2.5 px-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {pendingOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      暂无挂单
                    </td>
                  </tr>
                ) : (
                  pendingOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 font-mono text-slate-400">
                        {new Date(ord.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-100">{ord.contractCode}</td>
                      <td className="py-2.5 px-4">
                        <span className={ord.side === "BUY" ? "text-emerald-400" : "text-red-400"}>
                          {ord.side === "BUY" ? "买" : "卖"}
                          {ord.positionEffect === "OPEN" ? "开" : "平"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{ord.limitPrice}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{ord.quantity} 手</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {fmtUsd(ord.frozenMargin + ord.frozenFee)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleCancelOrder(ord.id)}
                          className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-red-900/60 text-slate-200 border border-slate-700 cursor-pointer"
                        >
                          撤单
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {blotterTab === "history" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 text-left">
                  <th className="py-2.5 px-4 font-medium">时间</th>
                  <th className="py-2.5 px-4 font-medium">合约</th>
                  <th className="py-2.5 px-4 font-medium">方向</th>
                  <th className="py-2.5 px-4 font-medium text-right">手数</th>
                  <th className="py-2.5 px-4 font-medium text-right">均价</th>
                  <th className="py-2.5 px-4 font-medium">状态</th>
                  <th className="py-2.5 px-4 font-medium">单号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {new Date(ord.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-100">{ord.contractCode}</td>
                    <td className="py-2.5 px-4">
                      {ord.orderType === "MARKET" ? "市价" : "限价"} ·{" "}
                      <span className={ord.side === "BUY" ? "text-emerald-400" : "text-red-400"}>
                        {ord.side === "BUY" ? "买" : "卖"}
                        {ord.positionEffect === "OPEN" ? "开" : "平"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {ord.filledQuantity}/{ord.quantity}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {ord.avgFillPrice ?? ord.limitPrice ?? "--"}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={
                          ord.status === "FILLED"
                            ? "text-emerald-400"
                            : ord.status === "CANCELLED"
                            ? "text-slate-400"
                            : ord.status === "REJECTED"
                            ? "text-red-400"
                            : "text-blue-400"
                        }
                      >
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">{ord.idempotencyKey}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {blotterTab === "executions" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 text-left">
                  <th className="py-2.5 px-4 font-medium">时间</th>
                  <th className="py-2.5 px-4 font-medium">合约</th>
                  <th className="py-2.5 px-4 font-medium">方向</th>
                  <th className="py-2.5 px-4 font-medium text-right">手数</th>
                  <th className="py-2.5 px-4 font-medium text-right">成交价</th>
                  <th className="py-2.5 px-4 font-medium text-right">手续费</th>
                  <th className="py-2.5 px-4 font-medium text-right">盈亏</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {executions.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {new Date(ex.executedAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-100">{ex.contractCode}</td>
                    <td className="py-2.5 px-4">
                      <span className={ex.side === "BUY" ? "text-emerald-400" : "text-red-400"}>
                        {ex.side === "BUY" ? "买" : "卖"}
                        {ex.positionEffect === "OPEN" ? "开" : "平"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{ex.quantity} 手</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{ex.price}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                      {fmtUsd(ex.fee)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                        ex.realizedPnl > 0
                          ? "text-emerald-400"
                          : ex.realizedPnl < 0
                          ? "text-red-400"
                          : "text-slate-400"
                      }`}
                    >
                      {ex.realizedPnl !== 0 ? `${ex.realizedPnl > 0 ? "+" : ""}${fmtUsd(ex.realizedPnl)}` : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {blotterTab === "ledger" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 text-left">
                  <th className="py-2.5 px-4 font-medium">时间</th>
                  <th className="py-2.5 px-4 font-medium">类型</th>
                  <th className="py-2.5 px-4 font-medium">摘要</th>
                  <th className="py-2.5 px-4 font-medium text-right">金额</th>
                  <th className="py-2.5 px-4 font-medium text-right">变动前</th>
                  <th className="py-2.5 px-4 font-medium text-right">变动后</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ledger.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">{row.type}</td>
                    <td className="py-2.5 px-4 text-slate-200">{row.remark}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-medium tabular-nums ${
                        row.amount >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {row.amount >= 0 ? "+" : ""}
                      {fmtUsd(row.amount)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                      {fmtUsd(row.balanceBefore)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-100">
                      {fmtUsd(row.balanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
