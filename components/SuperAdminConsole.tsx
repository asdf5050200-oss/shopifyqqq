import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Cpu,
  Database,
  Globe,
  Layers,
  Lock,
  Monitor,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Smartphone,
} from "lucide-react";
import type {
  AccountLedgerEntry,
  AdminAuditLog,
  CanonicalUserRole,
  CommercialLicenseItem,
  ContractQuoteSnapshot,
  FuturesContract,
  FuturesInstrument,
  InstrumentCode,
  MarketDataLog,
  MarketDataSource,
  MarketEngineHealth,
  MarketKline,
  MarketQuote,
  MatchingRuleConfig,
  SmartControlDirective,
  Tenant,
  Timeframe,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradeRiskEvent,
  TradingAccount,
  User,
} from "../types";
import { api } from "../services/apiClient";
import { CollapsibleSection, InfoTip, getClassificationDisplay } from "./InfoCollapse";

interface SuperAdminConsoleProps {
  quotes: MarketQuote[];
  effectiveRole: CanonicalUserRole;
  permissions: string[];
  lastTickSignal: number;
}

type AdminSection =
  | "overview"
  | "tenants"
  | "market_sync"
  | "instruments"
  | "matching"
  | "members_ledger"
  | "audit_isolation";

function fmtUsd(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "$0.00";
  const sign = val < 0 ? "-" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const SuperAdminConsole: React.FC<SuperAdminConsoleProps> = ({
  quotes,
  effectiveRole,
  permissions,
  lastTickSignal,
}) => {
  const [section, setSection] = useState<AdminSection>("overview");
  const [appPreview, setAppPreview] = useState<boolean>(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [instruments, setInstruments] = useState<FuturesInstrument[]>([]);
  const [contracts, setContracts] = useState<FuturesContract[]>([]);
  const [contractQuotes, setContractQuotes] = useState<ContractQuoteSnapshot[]>([]);
  const [dataSources, setDataSources] = useState<MarketDataSource[]>([]);
  const [licenseChecklist, setLicenseChecklist] = useState<CommercialLicenseItem[]>([]);
  const [dataLogs, setDataLogs] = useState<MarketDataLog[]>([]);
  const [smartDirectives, setSmartDirectives] = useState<SmartControlDirective[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [positions, setPositions] = useState<TradePosition[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [ledger, setLedger] = useState<AccountLedgerEntry[]>([]);
  const [riskEvents, setRiskEvents] = useState<TradeRiskEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [matchingRules, setMatchingRules] = useState<MatchingRuleConfig | null>(null);
  const [health, setHealth] = useState<MarketEngineHealth | null>(null);

  const [collectorBusy, setCollectorBusy] = useState<string | null>(null);
  const [probingSources, setProbingSources] = useState<boolean>(false);
  const [historyInstrument, setHistoryInstrument] = useState<InstrumentCode>("WTI");
  const [historyTimeframe, setHistoryTimeframe] = useState<Timeframe>("1m");
  const [marketHistory, setMarketHistory] = useState<{
    klines: MarketKline[];
    quoteHistory: Array<{
      providerId: string;
      providerName: string;
      instrumentCode: InstrumentCode;
      contractCode: string;
      vendorSymbol: string;
      price: number;
      sourceTimestamp: string;
      receivedAt: string;
      processedAt: string;
      fetchLatencyMs: number;
      dataClassification: string;
      qualityStatus?: string;
    }>;
    rawHistory: Array<{
      contractCode: string;
      instrumentCode: InstrumentCode;
      providerId: string;
      providerName?: string;
      sourceUrl: string;
      sourceTimestamp: string;
      receivedAt: string;
      rawSummary: Record<string, unknown>;
    }>;
    errorLogs: Array<{
      timestamp: string;
      level: string;
      eventType: string;
      instrumentCode: string;
      message: string;
    }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Create Tenant Form
  const [tName, setTName] = useState("");
  const [tCode, setTCode] = useState("");
  const [tBrand, setTBrand] = useState("");
  const [tDomain, setTDomain] = useState("");
  const [tParentId, setTParentId] = useState<string>("");
  const [tCapital, setTCapital] = useState("50000");

  // Isolation verifier output
  const [isolationResult, setIsolationResult] = useState<{
    step1: string;
    step2Status: number;
    step2Message: string;
    isolated: boolean;
  } | null>(null);

  const loadAdmin = useCallback(async () => {
    try {
      const data = await api.getAdminOverview();
      setTenants(data.tenants);
      setUsers(data.users);
      setInstruments(data.instruments);
      setContracts(data.contracts);
      setContractQuotes(data.contractQuotes || []);
      setDataSources(data.dataSources);
      setLicenseChecklist(data.licenseChecklist);
      setDataLogs(data.dataLogs);
      setSmartDirectives(data.smartDirectives);
      setAccounts(data.accounts);
      setPositions(data.positions);
      setOrders(data.orders);
      setExecutions(data.executions);
      setLedger(data.ledger);
      setRiskEvents(data.riskEvents);
      setAuditLogs(data.auditLogs);
      setMatchingRules(data.matchingRules);
      setHealth(data.health);
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "加载失败" });
    }
  }, []);

  const loadMarketHistory = useCallback(async () => {
    try {
      const hist = await api.getMarketHistory(historyInstrument, historyTimeframe);
      setMarketHistory({
        klines: hist.klines,
        quoteHistory: hist.quoteHistory,
        rawHistory: hist.rawHistory,
        errorLogs: hist.errorLogs,
      });
    } catch {
      // ignore transient error
    }
  }, [historyInstrument, historyTimeframe]);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin]);

  useEffect(() => {
    if (section === "market_sync") {
      loadMarketHistory();
    }
  }, [section, loadMarketHistory, lastTickSignal]);

  useEffect(() => {
    if (lastTickSignal > 0) {
      loadAdmin();
    }
  }, [lastTickSignal, loadAdmin]);

  const tenantMap = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const platformSummary = useMemo(() => {
    const activeTenants = tenants.filter((t) => t.status === "ACTIVE").length;
    const totalMembers = users.filter((u) => u.role === "MEMBER").length;
    const totalEquity = accounts.reduce((s, a) => s + a.balance + a.unrealizedPnl, 0);
    const totalMargin = accounts.reduce((s, a) => s + a.usedMargin, 0);
    const openLots = positions.reduce((s, p) => s + p.quantity, 0);
    return { activeTenants, totalMembers, totalEquity, totalMargin, openLots };
  }, [tenants, users, accounts, positions]);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.createTenant({
        name: tName,
        code: tCode,
        brandName: tBrand || tName,
        domain: tDomain,
        parentId: tParentId || null,
        defaultInitialCapital: Number(tCapital),
        allowedInstruments: ["WTI", "BRENT", "GOLD"],
      });
      setTName("");
      setTCode("");
      setTBrand("");
      setTDomain("");
      setFeedback({
        type: "success",
        text: `已开通：${res.tenant.name} · ${res.adminUser.email}`,
      });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "创建失败" });
    }
  };

  const handleToggleTenant = async (t: Tenant) => {
    const nextStatus = t.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await api.setTenantStatus(t.id, nextStatus);
      setFeedback({ type: "success", text: `${t.name} 已设为 ${nextStatus}` });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "操作失败" });
    }
  };

  const handleToggleInstrumentTrading = async (inst: FuturesInstrument) => {
    try {
      await api.updateInstrumentRule(inst.code, { tradingEnabled: !inst.tradingEnabled });
      setFeedback({
        type: "success",
        text: `${inst.code} 已${!inst.tradingEnabled ? "恢复" : "停牌"}`,
      });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "更新失败" });
    }
  };

  const handleUpdateMarginRate = async (code: InstrumentCode, ratePct: number) => {
    try {
      await api.updateInstrumentRule(code, { initialMarginRate: ratePct / 100 });
      setFeedback({ type: "success", text: `${code} 保证金已设为 ${ratePct}%` });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "更新失败" });
    }
  };

  const handleSwitchProvider = async (providerId: string) => {
    try {
      const res = await api.switchMarketProvider(providerId);
      setFeedback({ type: "success", text: `已切至 ${res.activeSource.name}` });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "切换失败" });
    }
  };

  const handleProbeSources = async () => {
    setProbingSources(true);
    setFeedback(null);
    try {
      const res = await api.probeMarketSources();
      setDataSources(res.dataSources);
      setHealth(res.health);
      const connectedCount = res.dataSources.filter((s) => s.status === "CONNECTED" || s.status === "STALE").length;
      setFeedback({
        type: "success",
        text: `探测完成：${connectedCount} 个外部源可达`,
      });
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "探测失败" });
    } finally {
      setProbingSources(false);
    }
  };

  const handleCollectorAction = async (
    action: "start" | "stop" | "reconnect",
    instrument?: InstrumentCode
  ) => {
    const busyKey = `${action}:${instrument || "ALL"}`;
    setCollectorBusy(busyKey);
    setFeedback(null);
    try {
      const res =
        action === "start"
          ? await api.startCollector(instrument)
          : action === "stop"
          ? await api.stopCollector(instrument)
          : await api.reconnectCollector(instrument);
      setHealth(res.health);
      const targetLabel = instrument ? `${instrument}` : "采集中心";
      const actionLabel = action === "start" ? "已启动" : action === "stop" ? "已停止" : "已重连";
      setFeedback({ type: "success", text: `${targetLabel}${actionLabel}` });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "操作失败" });
    } finally {
      setCollectorBusy(null);
    }
  };

  const handleTestQuality = async (mode: "DEDUP" | "ANOMALY") => {
    try {
      const res = await api.testMarketQuality(mode);
      setFeedback({
        type: "success",
        text:
          mode === "DEDUP"
            ? `去重测试：首条 ${res.first?.status} · 重复 ${res.second?.status}`
            : `跳价测试：${res.spike?.note}`,
      });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "测试失败" });
    }
  };

  const handleExecuteDirective = async (dir: SmartControlDirective) => {
    try {
      const res = await api.executeSmartControl(dir.actionType);
      setFeedback({ type: "success", text: res.message });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "执行失败" });
    }
  };

  const handleToggleLicense = async (id: string) => {
    try {
      const res = await api.toggleLicenseChecklist(id);
      setLicenseChecklist(res.licenseChecklist);
      setFeedback({ type: "success", text: "合规状态已更新" });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "更新失败" });
    }
  };

  const handleCopyRfq = async () => {
    const rfq = `Subject: Commercial Trial & Multi-Agent Redistribution Quote Request (WTI CL & Brent BRN)\n\nHello,\nWe are developing a commercial online simulated crude oil futures trading platform (CME/NYMEX CL & ICE Futures Europe BRN) operating under one unified brand with multiple agents and end-user members. Target end-to-end latency < 1 second (WebSocket / Python SDK).\nPlease provide trial credentials, monthly/annual pricing, CME/ICE exchange licensing fees, and written confirmation for external redistribution and simulated trading.\nBest regards`;
    try {
      await navigator.clipboard.writeText(rfq);
      setFeedback({ type: "success", text: "已复制英文询价模板" });
    } catch {
      setFeedback({ type: "error", text: "复制失败" });
    }
  };

  const handleToggleMatchingRule = async (key: keyof MatchingRuleConfig, value: boolean | number) => {
    try {
      await api.updateMatchingRules({ [key]: value });
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "更新失败" });
    }
  };

  const handleRunIsolationProbe = async () => {
    setFeedback(null);
    try {
      const res = await api.verifyIsolation();
      setIsolationResult(res);
      await loadAdmin();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "验证失败" });
    }
  };

  const hasPerm = useCallback(
    (perm: string) => effectiveRole === "SUPER_ADMIN" || permissions.includes("*") || permissions.includes(perm),
    [effectiveRole, permissions]
  );

  const navItems = useMemo(() => {
    const all: { id: AdminSection; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }>; visible: boolean }[] = [
      { id: "overview", label: "总览", shortLabel: "总览", icon: Cpu, visible: true },
      { id: "tenants", label: `代理 (${tenants.length})`, shortLabel: "代理", icon: Building2, visible: hasPerm("tenants:manage") || hasPerm("tenants:read") },
      { id: "market_sync", label: "行情同步", shortLabel: "行情", icon: Radio, visible: hasPerm("market:internal:read") },
      { id: "instruments", label: "合约规则", shortLabel: "合约", icon: Layers, visible: hasPerm("instruments:read") },
      { id: "matching", label: "风控规则", shortLabel: "风控", icon: Sliders, visible: hasPerm("risk:read") || hasPerm("matching_rules:read") },
      { id: "members_ledger", label: "会员账本", shortLabel: "账本", icon: Database, visible: hasPerm("finance:ledger:read") || hasPerm("risk:read") },
      { id: "audit_isolation", label: "审计隔离", shortLabel: "审计", icon: Lock, visible: hasPerm("audit:read") },
    ];
    return all.filter((i) => i.visible);
  }, [hasPerm, tenants.length]);

  return (
    <div
      className={
        appPreview
          ? "max-w-[430px] mx-auto my-4 bg-[#0B0F17] border border-slate-700 rounded-[24px] shadow-2xl overflow-hidden flex flex-col min-h-[780px] relative"
          : "max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-5 pb-24 lg:pb-6 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start"
      }
    >
      {/* Left Sidebar Navigation */}
      {!appPreview && (
        <aside className="hidden lg:block lg:col-span-3 xl:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-2.5 space-y-1">
          <div className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-800 mb-1">
            平台总控
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800/70"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setAppPreview(true)}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-blue-400" />
              <span>手机视图</span>
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className={appPreview ? "p-3 space-y-4 flex-1 overflow-y-auto pb-20" : "lg:col-span-9 xl:col-span-10 space-y-4 sm:space-y-5"}>
        {/* Mobile / App-Preview Top Sub-Nav Strip */}
        <div className={`${appPreview ? "flex" : "flex lg:hidden"} items-center justify-between gap-2 bg-[#111827] border border-slate-800 rounded-xl px-3 py-2`}>
          <div className="flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {item.shortLabel}
                </button>
              );
            })}
          </div>
          {appPreview && (
            <button
              type="button"
              onClick={() => setAppPreview(false)}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 shrink-0 cursor-pointer"
              title="桌面视图"
            >
              <Monitor className="w-4 h-4" />
            </button>
          )}
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
            <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
              关闭
            </button>
          </div>
        )}

        {/* SECTION 1: Overview */}
        {section === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">代理商</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {platformSummary.activeTenants} / {tenants.length}
                </div>
                <div className="text-xs text-slate-500 mt-1">多级租户</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">模拟会员</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {platformSummary.totalMembers}
                </div>
                <div className="text-xs text-slate-500 mt-1">账户 {accounts.length}</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">托管净值</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {fmtUsd(platformSummary.totalEquity)}
                </div>
                <div className="text-xs text-slate-500 mt-1">保证金 {fmtUsd(platformSummary.totalMargin)}</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">持仓 / 成交</div>
                <div className="text-2xl font-mono font-bold text-blue-400 mt-1 tabular-nums">
                  {platformSummary.openLots}手 / {executions.length}
                </div>
                <div className="text-xs text-slate-500 mt-1">委托 {orders.length}</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">行情核验状态</div>
                <div className={`text-lg font-mono font-bold mt-1.5 ${getClassificationDisplay(health?.feedState).toneClass}`}>
                  {health?.feedState ?? "UNAVAILABLE"} · {health?.latencyMs ?? 0}ms
                </div>
                <div className="text-xs text-slate-400 font-mono mt-1 truncate">
                  {health?.liveVerified ? "实时已核验" : "未接通实时"} · {health?.mode === "DEV_TEST_SIM" ? "仿真" : "真实模式"}
                </div>
              </div>
            </div>

            {/* Smart Control Directives */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">风控调度</h2>
                <span className="text-xs font-mono text-slate-400">决策引擎</span>
              </div>
              <div className="divide-y divide-slate-800/70">
                {smartDirectives.map((dir) => (
                  <div key={dir.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1 max-w-3xl">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-mono font-semibold ${
                            dir.severity === "HIGH"
                              ? "text-red-400"
                              : dir.severity === "MEDIUM"
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {dir.severity === "HIGH" ? "高危" : dir.severity === "MEDIUM" ? "关注" : "正常"}
                        </span>
                        <span className="text-slate-500 font-mono">· {dir.category}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-100">{dir.title}</div>
                      <div className="text-xs text-slate-400">
                        {dir.reason} · {dir.impact}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExecuteDirective(dir)}
                      className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {dir.actionLabel}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Tenant Breakdown */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">代理商报表</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">代理商</th>
                      <th className="py-2.5 px-4 font-medium">层级</th>
                      <th className="py-2.5 px-4 font-medium text-right">会员</th>
                      <th className="py-2.5 px-4 font-medium text-right">净值</th>
                      <th className="py-2.5 px-4 font-medium text-right">保证金</th>
                      <th className="py-2.5 px-4 font-medium text-right">手续费</th>
                      <th className="py-2.5 px-4 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {tenants.map((t) => {
                      const tMembers = users.filter((u) => u.tenantId === t.id && u.role === "MEMBER").length;
                      const tAccs = accounts.filter((a) => a.tenantId === t.id);
                      const tEq = tAccs.reduce((s, a) => s + a.balance + a.unrealizedPnl, 0);
                      const tMargin = tAccs.reduce((s, a) => s + a.usedMargin, 0);
                      const tFees = tAccs.reduce((s, a) => s + a.totalFees, 0);
                      const parentName = t.parentId ? tenantMap.get(t.parentId)?.name : "一级代理";
                      return (
                        <tr key={t.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-100">{t.name}</div>
                            <div className="text-[11px] font-mono text-slate-400">{t.domain}</div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-300">{parentName}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{tMembers}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(tEq)}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(tMargin)}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-400">
                            {fmtUsd(tFees)}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={t.status === "ACTIVE" ? "text-emerald-400" : "text-red-400"}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: Tenants */}
        {section === "tenants" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <form
              onSubmit={handleCreateTenant}
              className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-3"
            >
              <h2 className="text-sm font-semibold text-slate-100 border-b border-slate-800 pb-2">
                开通代理商
              </h2>
              <div>
                <label className="block text-xs text-slate-400 mb-1">名称</label>
                <input
                  type="text"
                  required
                  placeholder="代理商名称"
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">编码</label>
                  <input
                    type="text"
                    required
                    placeholder="CODE"
                    value={tCode}
                    onChange={(e) => setTCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">上级代理</label>
                  <select
                    value={tParentId}
                    onChange={(e) => setTParentId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-xs text-slate-100"
                  >
                    <option value="">一级代理</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">品牌名</label>
                <input
                  type="text"
                  placeholder="品牌名称"
                  value={tBrand}
                  onChange={(e) => setTBrand(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">域名</label>
                <input
                  type="text"
                  placeholder="agent.meridian.local"
                  value={tDomain}
                  onChange={(e) => setTDomain(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">默认额度 (USD)</label>
                <input
                  type="number"
                  min={1000}
                  value={tCapital}
                  onChange={(e) => setTCapital(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm font-mono text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              >
                创建代理商
              </button>
            </form>

            <div className="lg:col-span-8 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">代理商列表 ({tenants.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">代理商</th>
                      <th className="py-2.5 px-4 font-medium">域名 / 品牌</th>
                      <th className="py-2.5 px-4 font-medium">品种</th>
                      <th className="py-2.5 px-4 font-medium">状态</th>
                      <th className="py-2.5 px-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {tenants.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-100">{t.name}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {t.code} · {t.parentId ? `上级 ${tenantMap.get(t.parentId)?.code}` : "一级"}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="text-slate-200">{t.brandName}</div>
                          <div className="text-[11px] font-mono text-slate-400">{t.domain}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300">{t.allowedInstruments.join(", ")}</td>
                        <td className="py-2.5 px-4">
                          <span className={t.status === "ACTIVE" ? "text-emerald-400" : "text-red-400"}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleTenant(t)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                          >
                            {t.status === "ACTIVE" ? "停用" : "启用"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: Market Sync Center */}
        {section === "market_sync" && (
          <div className="space-y-4">
            {/* Mode & License Strip */}
            <div
              className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
                health?.collector?.authorizedMemberChannelReady
                  ? "bg-emerald-950/40 border-emerald-800 text-emerald-200"
                  : "bg-amber-950/40 border-amber-800/80 text-amber-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span className={getClassificationDisplay(health?.feedState).toneClass}>
                  {getClassificationDisplay(health?.feedState).label}
                </span>
                <span>·</span>
                <span>{health?.mode === "DEV_TEST_SIM" ? "DEV_TEST_SIM" : "PRODUCTION_REAL"}</span>
                <span>·</span>
                <span>{health?.collector?.licenseStatus || "NON_COMMERCIAL_PUBLIC"}</span>
                <span>·</span>
                <span>{health?.collector?.authorizedMemberChannelReady ? "会员通道开放" : "只读采集"}</span>
              </div>
              <div className="font-mono text-xs text-slate-300">
                实时核验: {health?.liveVerified ? "PASS" : "NO"} · WS {health?.wsConnectedClients ?? 0}
              </div>
            </div>

            {/* Smart Crude Oil Collector Hub */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Globe className="w-4 h-4 text-blue-400" />
                    <span>国际原油采集同步中心</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {health?.collector?.engineState ?? "STOPPED"} · 成功率 {health?.collector?.overallSuccessRatePct ?? 0}% (
                    {health?.collector?.totalSuccess ?? 0}/{health?.collector?.totalAttempts ?? 0}) · 重连{" "}
                    {health?.collector?.reconnectCount ?? 0} · 切换 {health?.collector?.failoverCount ?? 0} · 去重{" "}
                    {health?.deduplicatedCount ?? 0} · 拦截 {health?.anomalyRejectedCount ?? 0}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={collectorBusy !== null}
                    onClick={() => handleCollectorAction("start")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                  >
                    全部启动
                  </button>
                  <button
                    type="button"
                    disabled={collectorBusy !== null}
                    onClick={() => handleCollectorAction("stop")}
                    className="px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900/80 disabled:opacity-50 text-red-200 border border-red-800 text-xs cursor-pointer"
                  >
                    全部停止
                  </button>
                  <button
                    type="button"
                    disabled={collectorBusy !== null}
                    onClick={() => handleCollectorAction("reconnect")}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                  >
                    全部重连
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestQuality("DEDUP")}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
                  >
                    去重测试
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestQuality("ANOMALY")}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
                  >
                    跳价测试
                  </button>
                </div>
              </div>

              {/* Persistence Store Telemetry */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
                <span>落库 {health?.collector?.persistencePath || "data/market-history-store.json"}</span>
                <span className="text-slate-400">
                  快照 {health?.collector?.persistedRawSnapshotsCount ?? 0} · 报价{" "}
                  {health?.collector?.persistedQuotesCount ?? 0} · K线 {health?.collector?.persistedKlinesCount ?? 0}{" "}
                  · 日志 {health?.collector?.persistedLogsCount ?? 0} · 异常{" "}
                  {health?.collector?.persistedErrorLogsCount ?? 0}
                </span>
              </div>

              {/* WTI & Brent Collector Cards */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {(["WTI", "BRENT"] as InstrumentCode[]).map((code) => {
                  const tel = health?.collector?.instruments?.[code];
                  const q = quotes.find((item) => item.instrumentCode === code);
                  const isRunning = tel?.collectorState === "RUNNING";
                  return (
                    <div key={code} className="bg-[#0B0F17] border border-slate-800 rounded-xl p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div>
                          <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                            <span>{code === "WTI" ? "WTI 原油" : "Brent 原油"}</span>
                            <span className="font-mono text-xs text-slate-400">
                              {tel?.primaryContract || (code === "WTI" ? "CL00" : "BRN00")} (
                              {tel?.vendorSymbol || (code === "WTI" ? "CL=F" : "BZ=F")})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate max-w-md">
                            {tel?.sourceName || "未连接"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={collectorBusy !== null || isRunning}
                            onClick={() => handleCollectorAction("start", code)}
                            className="px-2.5 py-1 rounded-md bg-emerald-800/80 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] cursor-pointer"
                          >
                            启动
                          </button>
                          <button
                            type="button"
                            disabled={collectorBusy !== null || !isRunning}
                            onClick={() => handleCollectorAction("stop", code)}
                            className="px-2.5 py-1 rounded-md bg-red-950/80 hover:bg-red-900 disabled:opacity-40 text-red-200 border border-red-800 text-[11px] cursor-pointer"
                          >
                            停止
                          </button>
                          <button
                            type="button"
                            disabled={collectorBusy !== null}
                            onClick={() => handleCollectorAction("reconnect", code)}
                            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-[11px] cursor-pointer"
                          >
                            重连
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                        <div>
                          <div className="text-slate-500">最新价</div>
                          <div className="font-mono font-bold text-base text-slate-100 tabular-nums mt-0.5">
                            {tel?.lastPrice !== null && tel?.lastPrice !== undefined
                              ? tel.lastPrice.toFixed(2)
                              : q?.lastPrice !== null && q?.lastPrice !== undefined
                              ? q.lastPrice.toFixed(2)
                              : "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">状态</div>
                          <div className="font-mono font-semibold mt-0.5">
                            <span className={isRunning ? "text-emerald-400" : "text-red-400"}>
                              {tel?.collectorState ?? "STOPPED"}
                            </span>
                            <span className="text-slate-500"> / </span>
                            <span
                              className={
                                tel?.connectionStatus === "CONNECTED"
                                  ? "text-emerald-400"
                                  : tel?.connectionStatus === "STALE"
                                  ? "text-amber-400"
                                  : "text-red-400"
                              }
                            >
                              {tel?.connectionStatus ?? "DISCONNECTED"}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">分类 / 质量</div>
                          <div className="font-mono mt-0.5">
                            <span className="text-amber-300">{tel?.dataClassification ?? "UNAVAILABLE"}</span>
                            <span className="text-slate-500"> · </span>
                            <span className="text-slate-200">{tel?.qualityStatus ?? "UNAVAILABLE"}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">延迟 / 周期</div>
                          <div className="font-mono text-slate-200 tabular-nums mt-0.5">
                            {tel?.fetchLatencyMs ?? 0}ms / {tel?.updateFrequencySec ?? 6}s
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                        <div className="truncate">
                          UTC {tel?.sourceTimestamp ? tel.sourceTimestamp : "--"}
                        </div>
                        <div className="truncate">
                          接收 {tel?.receivedAt ? tel.receivedAt.slice(11, 23) + "Z" : "--"} ({tel?.dataAgeSeconds ?? 0}s)
                        </div>
                        <div className="text-right">
                          {tel?.successRatePct ?? 0}% · 重连 {tel?.reconnectCount ?? 0} · 切换 {tel?.failoverCount ?? 0}
                        </div>
                      </div>

                      {tel?.sourceUrl && (
                        <div className="text-[11px] font-mono text-slate-500 truncate">{tel.sourceUrl}</div>
                      )}
                      {tel?.lastError && (
                        <div className="text-[11px] font-mono text-red-400 truncate">异常 {tel.lastError}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Secondary Instruments Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                {(["GOLD", "SILVER", "NG"] as InstrumentCode[]).map((code) => {
                  const tel = health?.collector?.instruments?.[code];
                  return (
                    <div
                      key={code}
                      className="bg-[#0B0F17] border border-slate-800/80 rounded-lg px-3 py-2 flex items-center justify-between font-mono"
                    >
                      <span className="text-slate-300">
                        {code} ({tel?.primaryContract || code})
                      </span>
                      <span className="text-slate-100 tabular-nums">
                        {tel?.lastPrice !== null && tel?.lastPrice !== undefined ? tel.lastPrice : "--"}
                      </span>
                      <span
                        className={
                          tel?.connectionStatus === "CONNECTED"
                            ? "text-emerald-400"
                            : tel?.connectionStatus === "STALE"
                            ? "text-amber-400"
                            : "text-red-400"
                        }
                      >
                        {tel?.dataClassification ?? "UNAVAILABLE"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Latency SLA (Collapsed by default) */}
            {health?.latencyStats && (
              <CollapsibleSection
                title="端到端延迟指标"
                badge={`P95 ${health.latencyStats.p95Ms}ms (<${health.latencyStats.slaTargetMs}ms)`}
                defaultOpen={false}
              >
                <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-400">1. 交易所 → 上游</div>
                    <div className="text-base font-mono font-semibold text-slate-100 mt-1 tabular-nums">
                      {health.latencyStats.seg1ExchangeToVendorMs}ms
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-400">2. 上游 → 采集</div>
                    <div className="text-base font-mono font-semibold text-slate-100 mt-1 tabular-nums">
                      {health.latencyStats.seg2VendorToIngestMs}ms
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-400">3. 标准化 → 落库</div>
                    <div className="text-base font-mono font-semibold text-slate-100 mt-1 tabular-nums">
                      {health.latencyStats.seg3NormalizeCacheMs}ms
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-400">4. WS → 终端</div>
                    <div className="text-base font-mono font-semibold text-slate-100 mt-1 tabular-nums">
                      {health.latencyStats.seg4WsPushMs}ms
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Contract Snapshots */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100">合约分离快照</h3>
                <span className="text-xs font-mono text-slate-400">{contractQuotes.length} 合约</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2 px-4 font-medium">合约</th>
                      <th className="py-2 px-4 font-medium">上游标识</th>
                      <th className="py-2 px-4 font-medium">类型</th>
                      <th className="py-2 px-4 font-medium text-right">最新价</th>
                      <th className="py-2 px-4 font-medium text-right">昨收</th>
                      <th className="py-2 px-4 font-medium">分类</th>
                      <th className="py-2 px-4 font-medium">UTC 时间</th>
                      <th className="py-2 px-4 font-medium text-right">延迟</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {contractQuotes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          等待采集...
                        </td>
                      </tr>
                    ) : (
                      contractQuotes.map((cq) => (
                        <tr key={cq.contractCode}>
                          <td className="py-2 px-4 font-mono font-semibold text-slate-100">{cq.contractCode}</td>
                          <td className="py-2 px-4 font-mono text-slate-300">{cq.vendorSymbol}</td>
                          <td className="py-2 px-4 text-slate-300">{cq.isContinuous ? "连续" : "交割月"}</td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-100">
                            {cq.price !== null ? cq.price.toFixed(2) : "--"}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-400">
                            {cq.prevClose !== null ? cq.prevClose.toFixed(2) : "--"}
                          </td>
                          <td className="py-2 px-4 font-mono text-amber-300">{cq.dataClassification}</td>
                          <td className="py-2 px-4 font-mono text-slate-400">
                            {cq.sourceTimestamp ? cq.sourceTimestamp : "--"}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-300">
                            {cq.fetchLatencyMs}ms
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Data Sources Table */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100">数据源通道</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={probingSources}
                    onClick={handleProbeSources}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs cursor-pointer"
                  >
                    {probingSources ? "探测中..." : "探测连通性"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyRfq}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
                  >
                    复制询价模板
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">通道</th>
                      <th className="py-2.5 px-4 font-medium">状态</th>
                      <th className="py-2.5 px-4 font-medium">授权</th>
                      <th className="py-2.5 px-4 font-medium text-right">延迟</th>
                      <th className="py-2.5 px-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {dataSources.map((src) => (
                      <tr key={src.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-100 inline-flex items-center gap-1.5">
                            <span>{src.name}</span>
                            <InfoTip text={src.pricingNote} label="通道说明" />
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {src.tierRank} · {src.protocol}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          <div
                            className={
                              src.status === "CONNECTED"
                                ? "text-emerald-400 font-semibold"
                                : src.status === "STALE"
                                ? "text-amber-400 font-semibold"
                                : "text-red-400"
                            }
                          >
                            {src.status}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {src.lastHeartbeatAt ? src.lastHeartbeatAt.slice(11, 19) + "Z" : "--"}
                            {src.lastError ? ` · ${src.lastError}` : ""}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          <div
                            className={
                              src.licenseStatus === "COMMERCIAL_AUTHORIZED"
                                ? "text-emerald-400"
                                : src.licenseStatus === "PENDING_KEY"
                                ? "text-amber-400"
                                : "text-sky-400"
                            }
                          >
                            {src.licenseStatus}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {src.redistributionAllowed ? "可对外分发" : "禁止对外分发"}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{src.latencyMs}ms</td>
                        <td className="py-2.5 px-4 text-right">
                          {src.isActive ? (
                            <span className="text-emerald-400 font-semibold">主源</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSwitchProvider(src.id)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                            >
                              {src.id === "src-benchmark" ? "切至仿真" : "设为主源"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Commercial License Checklist (Collapsed by default) */}
            <CollapsibleSection
              title="商业合规门禁"
              badge={`${licenseChecklist.filter((i) => i.verified).length}/${licenseChecklist.length}`}
              defaultOpen={false}
            >
              <div className="divide-y divide-slate-800/60">
                {licenseChecklist.map((item) => (
                  <div key={item.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-100">{item.title}</div>
                      <div className="text-slate-400 mt-0.5">{item.requirement}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleLicense(item.id)}
                      className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer ${
                        item.verified
                          ? "bg-emerald-950/70 border border-emerald-800 text-emerald-300"
                          : "bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {item.verified ? "已核验" : "待确认"}
                    </button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Live Quotes & Ingestion Logs */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-5 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-100">同步报价</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-left">
                        <th className="py-2 px-3 font-medium">合约</th>
                        <th className="py-2 px-3 font-medium text-right">最新价</th>
                        <th className="py-2 px-3 font-medium text-right">买 / 卖</th>
                        <th className="py-2 px-3 font-medium text-right">分类</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {quotes.map((q) => (
                        <tr key={q.instrumentCode}>
                          <td className="py-2 px-3 font-mono font-semibold text-slate-100">
                            {q.contractCode} <span className="text-slate-400 font-normal">({q.marketSymbol})</span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-100">
                            {q.lastPrice !== null ? q.lastPrice : "--"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                            {q.bidPrice !== null ? q.bidPrice : "--"} / {q.askPrice !== null ? q.askPrice : "--"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-amber-300">
                            {q.dataClassification ?? "UNAVAILABLE"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="xl:col-span-7 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-100">采集日志 (UTC)</h3>
                  <span className="text-[11px] font-mono text-slate-400">UTC</span>
                </div>
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-left">
                        <th className="py-2 px-3 font-medium">合约</th>
                        <th className="py-2 px-3 font-medium">时间</th>
                        <th className="py-2 px-3 font-medium">状态</th>
                        <th className="py-2 px-3 font-medium">说明</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {dataLogs.slice(0, 20).map((log) => (
                        <tr key={log.id}>
                          <td className="py-2 px-3 font-mono text-slate-100">
                            {log.contractCode} @ {log.price !== null ? log.price : "--"}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-400">
                            {log.sourceTimestamp ? `${log.sourceTimestamp.slice(11, 23)}Z` : "--"}
                          </td>
                          <td className="py-2 px-3 font-mono">
                            <span
                              className={
                                log.status === "ACCEPTED"
                                  ? "text-emerald-400"
                                  : log.status === "DEDUP_DROPPED"
                                  ? "text-amber-400"
                                  : "text-red-400"
                              }
                            >
                              {log.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-300">{log.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Collector Events Stream (Collapsed by default) */}
            <CollapsibleSection
              title="采集事件流"
              badge={`${health?.collector?.events?.length ?? 0} 条`}
              defaultOpen={false}
            >
              <div className="divide-y divide-slate-800/60 max-h-60 overflow-y-auto text-xs font-mono">
                {!health?.collector?.events?.length ? (
                  <div className="p-4 text-center text-slate-500">暂无事件</div>
                ) : (
                  health.collector.events.slice(0, 25).map((ev, i) => (
                    <div key={`${ev.timestamp}-${i}`} className="px-4 py-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={
                            ev.level === "ERROR"
                              ? "text-red-400"
                              : ev.level === "WARN"
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }
                        >
                          {ev.level}
                        </span>
                        <span className="text-sky-400">{ev.instrumentCode}</span>
                        <span className="text-slate-400">{ev.eventType}</span>
                        <span className="text-slate-200 truncate">{ev.message}</span>
                      </div>
                      <span className="text-slate-500 shrink-0">{ev.timestamp.slice(11, 19)}Z</span>
                    </div>
                  ))
                )}
              </div>
            </CollapsibleSection>

            {/* Persisted Historical Browser (Collapsed by default) */}
            <CollapsibleSection
              title="历史落库"
              badge={`${historyInstrument} · ${historyTimeframe}`}
              defaultOpen={false}
              headerRight={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={historyInstrument}
                    onChange={(e) => setHistoryInstrument(e.target.value as InstrumentCode)}
                    className="bg-[#0B0F17] border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-100"
                  >
                    <option value="WTI">WTI (CL)</option>
                    <option value="BRENT">BRENT (BRN)</option>
                    <option value="GOLD">GOLD (GC)</option>
                    <option value="SILVER">SILVER (SI)</option>
                    <option value="NG">NG</option>
                  </select>
                  <select
                    value={historyTimeframe}
                    onChange={(e) => setHistoryTimeframe(e.target.value as Timeframe)}
                    className="bg-[#0B0F17] border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-100"
                  >
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="1d">1d</option>
                  </select>
                  <button
                    type="button"
                    onClick={loadMarketHistory}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs cursor-pointer"
                  >
                    刷新
                  </button>
                </div>
              }
            >
              <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-800">
                <div className="overflow-x-auto max-h-72">
                  <div className="px-4 py-2 bg-[#0B0F17] border-b border-slate-800 text-[11px] font-mono text-slate-400">
                    {historyInstrument} · {historyTimeframe} K线 ({marketHistory?.klines?.length ?? 0})
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-left">
                        <th className="py-1.5 px-3 font-medium">UTC</th>
                        <th className="py-1.5 px-3 font-medium text-right">开</th>
                        <th className="py-1.5 px-3 font-medium text-right">高</th>
                        <th className="py-1.5 px-3 font-medium text-right">低</th>
                        <th className="py-1.5 px-3 font-medium text-right">收</th>
                        <th className="py-1.5 px-3 font-medium text-right">量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 font-mono">
                      {!marketHistory?.klines?.length ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-500">
                            暂无记录
                          </td>
                        </tr>
                      ) : (
                        marketHistory.klines.slice(0, 20).map((bar) => (
                          <tr key={bar.time}>
                            <td className="py-1.5 px-3 text-slate-300">
                              {new Date(bar.time * 1000).toISOString().replace("T", " ").slice(0, 19)}Z
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-slate-200">{bar.open}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-emerald-400">{bar.high}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-red-400">{bar.low}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-slate-100 font-semibold">{bar.close}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-slate-400">{bar.volume}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto max-h-72">
                  <div className="px-4 py-2 bg-[#0B0F17] border-b border-slate-800 text-[11px] font-mono text-slate-400">
                    {historyInstrument} 报价 {marketHistory?.quoteHistory?.length ?? 0} · 异常{" "}
                    {marketHistory?.errorLogs?.length ?? 0}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-left">
                        <th className="py-1.5 px-3 font-medium">合约</th>
                        <th className="py-1.5 px-3 font-medium text-right">价格</th>
                        <th className="py-1.5 px-3 font-medium">质量</th>
                        <th className="py-1.5 px-3 font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 font-mono">
                      {!marketHistory?.quoteHistory?.length ? (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-slate-500">
                            暂无记录
                          </td>
                        </tr>
                      ) : (
                        marketHistory.quoteHistory.slice(0, 15).map((hq, idx) => (
                          <tr key={`${hq.contractCode}-${hq.processedAt}-${idx}`}>
                            <td className="py-1.5 px-3 text-slate-200">
                              {hq.contractCode} <span className="text-slate-500">({hq.vendorSymbol})</span>
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-slate-100 font-semibold">
                              {hq.price}
                            </td>
                            <td className="py-1.5 px-3">
                              <span className="text-amber-300">{hq.dataClassification}</span>
                              <span className="text-slate-500"> / </span>
                              <span className="text-emerald-400">{hq.qualityStatus || "ACCEPTED"}</span>
                            </td>
                            <td className="py-1.5 px-3 text-[11px] text-slate-400">
                              {hq.sourceTimestamp.slice(11, 19)}Z → {hq.receivedAt.slice(11, 19)}Z
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* SECTION 4: Instruments & Contracts */}
        {section === "instruments" && (
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">品种规则</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">品种</th>
                      <th className="py-2.5 px-4 font-medium">主力合约</th>
                      <th className="py-2.5 px-4 font-medium text-right">乘数</th>
                      <th className="py-2.5 px-4 font-medium text-right">最小跳动</th>
                      <th className="py-2.5 px-4 font-medium text-right">保证金</th>
                      <th className="py-2.5 px-4 font-medium text-right">手续费</th>
                      <th className="py-2.5 px-4 font-medium text-right">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {instruments.map((inst) => (
                      <tr key={inst.code}>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-100">{inst.name}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {inst.code} · {inst.marketSymbol} · {inst.exchangeLabel}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-200">{inst.activeContract}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {inst.multiplier.toLocaleString()} {inst.unitLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{inst.tickSize}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          <select
                            value={Math.round(inst.initialMarginRate * 100)}
                            onChange={(e) => handleUpdateMarginRate(inst.code, Number(e.target.value))}
                            className="bg-[#0B0F17] border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-100"
                          >
                            {[4, 5, 6, 8, 10].map((pct) => (
                              <option key={pct} value={pct}>
                                {pct}% ({(100 / pct).toFixed(1)}x)
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">${inst.feePerLot.toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleInstrumentTrading(inst)}
                            className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                              inst.tradingEnabled
                                ? "bg-emerald-950/70 text-emerald-300 border border-emerald-800"
                                : "bg-red-950/70 text-red-300 border border-red-800"
                            }`}
                          >
                            {inst.tradingEnabled ? "交易中" : "已停牌"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-100">交割合约</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">合约</th>
                      <th className="py-2.5 px-4 font-medium">品种</th>
                      <th className="py-2.5 px-4 font-medium">类型</th>
                      <th className="py-2.5 px-4 font-medium">到期</th>
                      <th className="py-2.5 px-4 font-medium">换月</th>
                      <th className="py-2.5 px-4 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {contracts.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-100">{c.contractCode}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-300">{c.instrumentCode}</td>
                        <td className="py-2.5 px-4 text-slate-300">
                          {c.deliveryMonth} · {c.isContinuous ? "连续" : c.isMainContract ? "主力" : "远月"}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">{c.expiryDate}</td>
                        <td className="py-2.5 px-4 text-slate-400">{c.rolloverRule}</td>
                        <td className="py-2.5 px-4 font-mono">
                          <span className={c.status === "ROLLOVER_SOON" ? "text-amber-400" : "text-emerald-400"}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 5: Matching & Risk Rules */}
        {section === "matching" && matchingRules && (
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">撮合与风控规则</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-[#0B0F17] border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-100">断线停单</div>
                  <div className="text-slate-400 mt-0.5">延迟 &gt; {matchingRules.maxFeedStaleSeconds}s 或断开拒单</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleMatchingRule("pauseOnFeedDisconnect", !matchingRules.pauseOnFeedDisconnect)}
                  className={`px-3 py-1.5 rounded-lg font-medium shrink-0 cursor-pointer ${
                    matchingRules.pauseOnFeedDisconnect ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {matchingRules.pauseOnFeedDisconnect ? "开启" : "关闭"}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-[#0B0F17] border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-100">自动强平</div>
                  <div className="text-slate-400 mt-0.5">风险率 ≤ {matchingRules.liquidationRiskThresholdPct}% 强平</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleMatchingRule("autoLiquidationEnabled", !matchingRules.autoLiquidationEnabled)}
                  className={`px-3 py-1.5 rounded-lg font-medium shrink-0 cursor-pointer ${
                    matchingRules.autoLiquidationEnabled ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {matchingRules.autoLiquidationEnabled ? "开启" : "关闭"}
                </button>
              </div>
            </div>

            <div className="bg-[#0B0F17] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-200">
                风控事件 ({riskEvents.length})
              </div>
              <div className="divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {riskEvents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">暂无事件</div>
                ) : (
                  riskEvents.map((ev) => (
                    <div key={ev.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5">
                        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="font-mono text-amber-300">{ev.eventType}</span>
                        <span className="text-slate-200">{ev.detail}</span>
                      </div>
                      <span className="font-mono text-slate-500">{new Date(ev.createdAt).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 6: Members & Ledger */}
        {section === "members_ledger" && (
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">会员账户</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">代理商</th>
                      <th className="py-2.5 px-4 font-medium">会员 / 账号</th>
                      <th className="py-2.5 px-4 font-medium text-right">初始资金</th>
                      <th className="py-2.5 px-4 font-medium text-right">余额</th>
                      <th className="py-2.5 px-4 font-medium text-right">可用资金</th>
                      <th className="py-2.5 px-4 font-medium text-right">保证金</th>
                      <th className="py-2.5 px-4 font-medium text-right">浮盈</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {accounts.map((acc) => (
                      <tr key={acc.id}>
                        <td className="py-2.5 px-4 text-slate-300">
                          {tenantMap.get(acc.tenantId)?.name ?? acc.tenantId}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-medium text-slate-100">{userMap.get(acc.userId)?.name}</span>
                          <span className="font-mono text-slate-400 ml-2">{acc.accountNo}</span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(acc.initialCapital)}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(acc.balance)}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-400">
                          {fmtUsd(acc.availableFunds)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(acc.usedMargin)}</td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                            acc.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {acc.unrealizedPnl >= 0 ? "+" : ""}
                          {fmtUsd(acc.unrealizedPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-100">资金流水</h3>
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2 px-4 font-medium">时间</th>
                      <th className="py-2 px-4 font-medium">代理</th>
                      <th className="py-2 px-4 font-medium">类型</th>
                      <th className="py-2 px-4 font-medium">摘要</th>
                      <th className="py-2 px-4 font-medium text-right">金额</th>
                      <th className="py-2 px-4 font-medium text-right">余额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {ledger.slice(0, 40).map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 px-4 font-mono text-slate-400">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 px-4 text-slate-300">{tenantMap.get(row.tenantId)?.code}</td>
                        <td className="py-2 px-4 font-mono text-slate-300">{row.type}</td>
                        <td className="py-2 px-4 text-slate-200">{row.remark}</td>
                        <td
                          className={`py-2 px-4 text-right font-mono tabular-nums ${
                            row.amount >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {row.amount >= 0 ? "+" : ""}
                          {fmtUsd(row.amount)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">{fmtUsd(row.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 7: Isolation & Audit Logs */}
        {section === "audit_isolation" && (
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>跨租户隔离测试</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    验证代理 A 无法访问代理 B 数据 (HTTP 403)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunIsolationProbe}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  执行测试
                </button>
              </div>

              {isolationResult && (
                <div
                  className={`p-4 rounded-lg border text-xs space-y-1.5 ${
                    isolationResult.isolated
                      ? "bg-emerald-950/50 border-emerald-800 text-emerald-200"
                      : "bg-red-950/50 border-red-800 text-red-200"
                  }`}
                >
                  <div className="font-semibold">
                    {isolationResult.isolated ? "隔离通过 (HTTP 403)" : "隔离异常"}
                  </div>
                  <div className="font-mono">{isolationResult.step1}</div>
                  <div className="font-mono">
                    HTTP {isolationResult.step2Status} · {isolationResult.step2Message}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-100">操作审计 ({auditLogs.length})</h3>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">时间</th>
                      <th className="py-2.5 px-4 font-medium">操作人</th>
                      <th className="py-2.5 px-4 font-medium">动作</th>
                      <th className="py-2.5 px-4 font-medium">明细</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="text-slate-100">{log.actorName}</span>
                          <span className="font-mono text-slate-500 ml-2">{log.actorRole}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-blue-400">{log.action}</td>
                        <td className="py-2.5 px-4 text-slate-300">{log.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Native App Bottom TabBar */}
      <nav
        className={`${
          appPreview ? "sticky bottom-0 z-30 grid" : "fixed bottom-0 inset-x-0 z-30 grid lg:hidden"
        } bg-[#0F141F]/95 backdrop-blur border-t border-slate-800 pb-safe`}
        style={{ gridTemplateColumns: `repeat(${Math.min(5, navItems.length)}, minmax(0, 1fr))` }}
      >
        {navItems.slice(0, 5).map(({ id, shortLabel, icon: Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`py-2 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                active ? "text-blue-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
