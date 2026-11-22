import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  LayoutDashboard,
  Monitor,
  Plus,
  ShieldCheck,
  Sliders,
  Smartphone,
  Users,
} from "lucide-react";
import type {
  AccountLedgerEntry,
  CanonicalUserRole,
  FuturesInstrument,
  InstrumentCode,
  Tenant,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradeRiskEvent,
  TradingAccount,
  User,
} from "../types";
import { api } from "../services/apiClient";
import { CollapsibleSection } from "./InfoCollapse";

interface AgentPortalProps {
  currentUser: User;
  effectiveRole: CanonicalUserRole;
  permissions: string[];
  lastTickSignal: number;
}

type AgentTab = "overview" | "members" | "trading" | "settings" | "staff";

function fmtUsd(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "$0.00";
  const sign = val < 0 ? "-" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const AgentPortal: React.FC<AgentPortalProps> = ({
  currentUser,
  effectiveRole,
  permissions,
  lastTickSignal,
}) => {
  const [tab, setTab] = useState<AgentTab>("overview");
  const [appPreview, setAppPreview] = useState<boolean>(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(currentUser.tenantId || "");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [childTenants, setChildTenants] = useState<Tenant[]>([]);
  const [readOnlyScope, setReadOnlyScope] = useState<boolean>(false);
  const [members, setMembers] = useState<User[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [positions, setPositions] = useState<TradePosition[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [executions, setExecutions] = useState<TradeExecution[]>([]);
  const [ledger, setLedger] = useState<AccountLedgerEntry[]>([]);
  const [riskEvents, setRiskEvents] = useState<TradeRiskEvent[]>([]);
  const [globalInstruments, setGlobalInstruments] = useState<FuturesInstrument[]>([]);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Create member form
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberCapital, setNewMemberCapital] = useState("50000");

  // Adjust funds modal
  const [adjustTarget, setAdjustTarget] = useState<TradingAccount | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("10000");
  const [adjustRemark, setAdjustRemark] = useState("额度调整");

  // Brand & settings form
  const [brandName, setBrandName] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [defaultCapInput, setDefaultCapInput] = useState("50000");
  const [allowedSet, setAllowedSet] = useState<InstrumentCode[]>([]);

  // Staff form
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPerms, setStaffPerms] = useState<string[]>(["members:read", "orders:read", "reports:read"]);

  const loadData = useCallback(async () => {
    try {
      const targetTid = selectedTenantId || currentUser.tenantId || undefined;
      const data = await api.getAgentOverview(targetTid);
      setTenant(data.tenant);
      setChildTenants(data.childTenants || []);
      setReadOnlyScope(Boolean(data.readOnlyScope));
      setMembers(data.members);
      setStaff(data.staff);
      setAccounts(data.accounts);
      setPositions(data.positions);
      setOrders(data.orders);
      setExecutions(data.executions);
      setLedger(data.ledger);
      setRiskEvents(data.riskEvents);
      setGlobalInstruments(data.globalInstruments);

      setBrandName(data.tenant.brandName);
      setDomainInput(data.tenant.domain);
      setDefaultCapInput(String(data.tenant.defaultInitialCapital));
      setAllowedSet(data.tenant.allowedInstruments);
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "加载失败" });
    }
  }, [currentUser.tenantId, selectedTenantId]);

  useEffect(() => {
    setSelectedTenantId(currentUser.tenantId || "");
  }, [currentUser.id, currentUser.tenantId]);

  useEffect(() => {
    loadData();
  }, [currentUser.id, selectedTenantId, loadData]);

  useEffect(() => {
    if (lastTickSignal > 0) {
      loadData();
    }
  }, [lastTickSignal, loadData]);

  const accountByUser = useMemo(() => new Map(accounts.map((a) => [a.userId, a])), [accounts]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const stats = useMemo(() => {
    const totalEquity = accounts.reduce((s, a) => s + a.balance + a.unrealizedPnl, 0);
    const totalMargin = accounts.reduce((s, a) => s + a.usedMargin, 0);
    const totalUnrealized = accounts.reduce((s, a) => s + a.unrealizedPnl, 0);
    const totalFees = accounts.reduce((s, a) => s + a.totalFees, 0);
    const openLots = positions.reduce((s, p) => s + p.quantity, 0);
    return { totalEquity, totalMargin, totalUnrealized, totalFees, openLots };
  }, [accounts, positions]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [members, searchQuery]);

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.createAgentMember({
        name: newMemberName,
        email: newMemberEmail,
        initialCapital: Number(newMemberCapital),
      });
      setNewMemberName("");
      setNewMemberEmail("");
      setFeedback({
        type: "success",
        text: `已开户：${res.member.name} · ${res.account.accountNo}`,
      });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "创建失败" });
    }
  };

  const handleAdjustFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setFeedback(null);
    try {
      await api.adjustAccountFunds(adjustTarget.id, Number(adjustAmount), adjustRemark);
      setFeedback({
        type: "success",
        text: `${adjustTarget.accountNo} 已调账 ${fmtUsd(Number(adjustAmount))}`,
      });
      setAdjustTarget(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "调账失败" });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.updateAgentSettings({
        brandName,
        domain: domainInput,
        defaultInitialCapital: Number(defaultCapInput),
        allowedInstruments: allowedSet,
      });
      setTenant(res.tenant);
      setFeedback({ type: "success", text: "已保存配置" });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "保存失败" });
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.createAgentStaff({
        name: staffName,
        email: staffEmail,
        permissions: staffPerms,
      });
      setStaffName("");
      setStaffEmail("");
      setFeedback({ type: "success", text: `已添加 ${res.staff.name}` });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: "error", text: err?.message || "添加失败" });
    }
  };

  const toggleInstrumentPermission = (code: InstrumentCode) => {
    setAllowedSet((prev) =>
      prev.includes(code) ? (prev.length > 1 ? prev.filter((c) => c !== code) : prev) : [...prev, code]
    );
  };

  const canCreateMember = !readOnlyScope && permissions.includes("agent:members:create");
  const canAdjustFunds = !readOnlyScope && permissions.includes("agent:accounts:adjust");
  const canEditSettings = !readOnlyScope && permissions.includes("agent:settings:edit");
  const canManageStaff = !readOnlyScope && permissions.includes("agent:staff:manage");

  return (
    <div
      className={
        appPreview
          ? "max-w-[430px] mx-auto my-4 bg-[#0B0F17] border border-slate-700 rounded-[24px] shadow-2xl overflow-hidden flex flex-col min-h-[780px] relative"
          : "max-w-[1520px] mx-auto px-3 sm:px-6 py-4 sm:py-5 pb-24 lg:pb-6 space-y-4 sm:space-y-5"
      }
    >
      <div className={appPreview ? "p-3 space-y-4 flex-1 overflow-y-auto pb-20" : "space-y-4 sm:space-y-5"}>
        {/* Tenant Header */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400 shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-sm sm:text-base font-semibold text-slate-100 truncate">
                  {tenant?.name || "代理后台"}
                </h1>
                <span className="text-[11px] font-mono text-slate-400">{effectiveRole}</span>
                {readOnlyScope && (
                  <span className="text-[11px] font-mono text-amber-400">· 二级只读</span>
                )}
              </div>
              <div className="text-xs font-mono text-slate-400 truncate mt-0.5">
                {tenant?.code} · {tenant?.domain}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {childTenants.length > 0 && currentUser.tenantId && (
              <select
                value={selectedTenantId || currentUser.tenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                aria-label="切换代理租户视角"
                className="bg-[#0B0F17] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
              >
                <option value={currentUser.tenantId}>本级代理 ({currentUser.tenantId.replace("tenant-", "").toUpperCase()})</option>
                {childTenants.map((child) => (
                  <option key={child.id} value={child.id}>
                    下级只读 · {child.name}
                  </option>
                ))}
              </select>
            )}
            {!appPreview && (
              <div className="hidden lg:flex items-center gap-1 bg-[#0B0F17] p-1 rounded-lg border border-slate-800 overflow-x-auto">
                {(
                  [
                    { id: "overview", label: "总览" },
                    { id: "members", label: `会员 (${members.length})` },
                    { id: "trading", label: `持仓 (${positions.length})` },
                    { id: "settings", label: "配置" },
                    { id: "staff", label: `人员 (${staff.length})` },
                  ] as { id: AgentTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      tab === t.id ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-100"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setAppPreview((v) => !v)}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {appPreview ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
              <span>{appPreview ? "桌面视图" : "手机视图"}</span>
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
            <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
              关闭
            </button>
          </div>
        )}

        {/* Adjust Funds Modal */}
        {adjustTarget && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <form
              onSubmit={handleAdjustFunds}
              className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  资金调整 · {adjustTarget.accountNo}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  余额 {fmtUsd(adjustTarget.balance)} · 可用 {fmtUsd(adjustTarget.availableFunds)}
                </p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">金额 (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">备注</label>
                <input
                  type="text"
                  value={adjustRemark}
                  onChange={(e) => setAdjustRemark(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-3.5 py-2 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                >
                  确认
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 1: Overview */}
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">会员</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1 tabular-nums">{members.length}</div>
                <div className="text-xs text-slate-500 mt-1">账户 {accounts.length}</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">模拟净值</div>
                <div className="text-2xl font-mono font-bold text-slate-100 mt-1 tabular-nums">
                  {fmtUsd(stats.totalEquity)}
                </div>
                <div className="text-xs text-slate-500 mt-1">保证金 {fmtUsd(stats.totalMargin)}</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">浮动盈亏</div>
                <div
                  className={`text-2xl font-mono font-bold mt-1 tabular-nums ${
                    stats.totalUnrealized >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {stats.totalUnrealized >= 0 ? "+" : ""}
                  {fmtUsd(stats.totalUnrealized)}
                </div>
                <div className="text-xs text-slate-500 mt-1">持仓 {stats.openLots} 手</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">手续费</div>
                <div className="text-2xl font-mono font-bold text-blue-400 mt-1 tabular-nums">
                  {fmtUsd(stats.totalFees)}
                </div>
                <div className="text-xs text-slate-500 mt-1">成交 {executions.length} 笔</div>
              </div>
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">授权品种</div>
                <div className="text-base font-mono font-semibold text-slate-100 mt-2">
                  {tenant?.allowedInstruments.join(" · ") || "--"}
                </div>
                <div className="text-xs text-slate-500 mt-1">默认 {fmtUsd(tenant?.defaultInitialCapital)}</div>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">会员账户</h2>
                <span className="text-xs font-mono text-slate-400">订单 {orders.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">会员 / 账号</th>
                      <th className="py-2.5 px-4 font-medium text-right">初始资金</th>
                      <th className="py-2.5 px-4 font-medium text-right">余额</th>
                      <th className="py-2.5 px-4 font-medium text-right">保证金</th>
                      <th className="py-2.5 px-4 font-medium text-right">浮盈</th>
                      <th className="py-2.5 px-4 font-medium text-right">风险率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {members.map((m) => {
                      const acc = accountByUser.get(m.id);
                      return (
                        <tr key={m.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-100">{m.name}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {acc?.accountNo ?? "--"} · {m.email}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(acc?.initialCapital)}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-100">{fmtUsd(acc?.balance)}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{fmtUsd(acc?.usedMargin)}</td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                              (acc?.unrealizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {(acc?.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                            {fmtUsd(acc?.unrealizedPnl)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-400">
                            {acc && acc.usedMargin > 0 ? `${acc.riskRatio.toFixed(1)}%` : "安全"}
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

        {/* TAB 2: Members */}
        {tab === "members" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {canCreateMember && (
              <form
                onSubmit={handleCreateMember}
                className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-3.5"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 border-b border-slate-800 pb-2.5">
                  <Plus className="w-4 h-4 text-blue-400" />
                  <span>新增会员</span>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">姓名</label>
                  <input
                    type="text"
                    required
                    placeholder="会员姓名"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">邮箱</label>
                  <input
                    type="email"
                    required
                    placeholder={`member@${tenant?.domain || "agent.local"}`}
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">初始资金 (USD)</label>
                  <input
                    type="number"
                    min={1000}
                    step="100"
                    required
                    value={newMemberCapital}
                    onChange={(e) => setNewMemberCapital(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm font-mono text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  创建会员
                </button>
              </form>
            )}

            <div className={`${canCreateMember ? "lg:col-span-8" : "lg:col-span-12"} bg-[#111827] border border-slate-800 rounded-xl overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-100">会员列表</span>
                <input
                  type="search"
                  placeholder="搜索姓名或邮箱"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-700 text-xs text-slate-200 w-52"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">会员</th>
                      <th className="py-2.5 px-4 font-medium text-right">余额</th>
                      <th className="py-2.5 px-4 font-medium text-right">可用资金</th>
                      <th className="py-2.5 px-4 font-medium text-right">已实现盈亏</th>
                      <th className="py-2.5 px-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredMembers.map((m) => {
                      const acc = accountByUser.get(m.id);
                      return (
                        <tr key={m.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-100">{m.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {acc?.accountNo} · {m.email}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-100">
                            {fmtUsd(acc?.balance)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-400">
                            {fmtUsd(acc?.availableFunds)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                              (acc?.realizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {fmtUsd(acc?.realizedPnl)}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {acc && canAdjustFunds ? (
                              <button
                                type="button"
                                onClick={() => setAdjustTarget(acc)}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                              >
                                调账
                              </button>
                            ) : (
                              <span className="text-slate-500 font-mono">只读</span>
                            )}
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

        {/* TAB 3: Trading & Ledger */}
        {tab === "trading" && (
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">实时持仓 ({positions.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">会员</th>
                      <th className="py-2.5 px-4 font-medium">合约</th>
                      <th className="py-2.5 px-4 font-medium">方向</th>
                      <th className="py-2.5 px-4 font-medium text-right">手数</th>
                      <th className="py-2.5 px-4 font-medium text-right">开仓价</th>
                      <th className="py-2.5 px-4 font-medium text-right">现价</th>
                      <th className="py-2.5 px-4 font-medium text-right">浮盈</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {positions.map((pos) => (
                      <tr key={pos.id}>
                        <td className="py-2.5 px-4 text-slate-100">{memberById.get(pos.userId)?.name ?? pos.userId}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-200">{pos.contractCode}</td>
                        <td className="py-2.5 px-4">
                          <span className={pos.direction === "LONG" ? "text-emerald-400" : "text-red-400"}>
                            {pos.direction === "LONG" ? "多" : "空"}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.quantity}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.avgOpenPrice}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{pos.markPrice}</td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                            pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {pos.unrealizedPnl >= 0 ? "+" : ""}
                          {fmtUsd(pos.unrealizedPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">资金账本 ({ledger.length})</h2>
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2 px-4 font-medium">时间</th>
                      <th className="py-2 px-4 font-medium">会员</th>
                      <th className="py-2 px-4 font-medium">类型</th>
                      <th className="py-2 px-4 font-medium">摘要</th>
                      <th className="py-2 px-4 font-medium text-right">金额</th>
                      <th className="py-2 px-4 font-medium text-right">余额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {ledger.slice(0, 30).map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 px-4 font-mono text-slate-400">{new Date(l.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-4 text-slate-200">{memberById.get(l.userId)?.name ?? l.userId}</td>
                        <td className="py-2 px-4 font-mono text-slate-300">{l.type}</td>
                        <td className="py-2 px-4 text-slate-300">{l.remark}</td>
                        <td
                          className={`py-2 px-4 text-right font-mono tabular-nums ${
                            l.amount >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {l.amount >= 0 ? "+" : ""}
                          {fmtUsd(l.amount)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">{fmtUsd(l.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {riskEvents.length > 0 && (
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-amber-400 mb-2">风控事件 ({riskEvents.length})</h3>
                <div className="space-y-1.5 text-xs">
                  {riskEvents.slice(0, 8).map((ev) => (
                    <div key={ev.id} className="flex justify-between text-slate-300 border-b border-slate-800/60 pb-1">
                      <span>{ev.detail}</span>
                      <span className="font-mono text-slate-500">{new Date(ev.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Settings */}
        {tab === "settings" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <form
              onSubmit={handleSaveSettings}
              className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between text-sm font-semibold text-slate-100 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-400" />
                  <span>品牌与品种配置</span>
                </div>
                {!canEditSettings && <span className="text-xs font-mono text-amber-400">只读</span>}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">品牌名称</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 disabled:opacity-60 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">绑定域名</label>
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 disabled:opacity-60 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">默认初始资金 (USD)</label>
                <input
                  type="number"
                  min={1000}
                  disabled={!canEditSettings}
                  value={defaultCapInput}
                  onChange={(e) => setDefaultCapInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 disabled:opacity-60 text-sm font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">可交易品种</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {globalInstruments.map((inst) => {
                    const checked = allowedSet.includes(inst.code);
                    return (
                      <button
                        key={inst.code}
                        type="button"
                        disabled={!canEditSettings}
                        onClick={() => toggleInstrumentPermission(inst.code)}
                        className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors disabled:opacity-60 cursor-pointer ${
                          checked
                            ? "bg-blue-600/20 border-blue-500 text-blue-200"
                            : "bg-[#0B0F17] border-slate-800 text-slate-400"
                        }`}
                      >
                        <div className="font-semibold">{inst.name}</div>
                        <div className="font-mono text-[11px] opacity-80">{inst.activeContract}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {canEditSettings && (
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  保存
                </button>
              )}
            </form>

            <div className="lg:col-span-6">
              <CollapsibleSection title="全局合约规则 (只读)" badge={`${globalInstruments.length} 品种`} defaultOpen={false}>
                <div className="divide-y divide-slate-800 text-xs px-4">
                  {globalInstruments.map((inst) => (
                    <div key={inst.code} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-100">{inst.name}</span>
                        <span className="text-slate-400 font-mono ml-2">{inst.activeContract}</span>
                      </div>
                      <div className="font-mono tabular-nums text-slate-300">
                        乘数 {inst.multiplier.toLocaleString()} · 保证金 {(inst.initialMarginRate * 100).toFixed(1)}% · $
                        {inst.feePerLot.toFixed(2)}/手
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            </div>
          </div>
        )}

        {/* TAB 5: Staff */}
        {tab === "staff" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {canManageStaff && (
              <form
                onSubmit={handleCreateStaff}
                className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-3.5"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 border-b border-slate-800 pb-2.5">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span>新增员工</span>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">姓名</label>
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder="员工姓名"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">邮箱</label>
                  <input
                    type="email"
                    required
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    placeholder={`ops2@${tenant?.domain || "agent.local"}`}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-700 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="text-slate-400">权限</div>
                  {[
                    { id: "members:read", label: "查看会员" },
                    { id: "orders:read", label: "查看交易" },
                    { id: "accounts:adjust", label: "资金调整" },
                    { id: "reports:read", label: "查看报表" },
                  ].map((perm) => (
                    <label key={perm.id} className="flex items-center gap-2 text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={staffPerms.includes(perm.id)}
                        onChange={() =>
                          setStaffPerms((prev) =>
                            prev.includes(perm.id) ? prev.filter((p) => p !== perm.id) : [...prev, perm.id]
                          )
                        }
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  添加员工
                </button>
              </form>
            )}

            <div className={`${canManageStaff ? "lg:col-span-8" : "lg:col-span-12"} bg-[#111827] border border-slate-800 rounded-xl overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">运营人员</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-2.5 px-4 font-medium">姓名</th>
                      <th className="py-2.5 px-4 font-medium">角色</th>
                      <th className="py-2.5 px-4 font-medium">权限</th>
                      <th className="py-2.5 px-4 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {staff.map((st) => (
                      <tr key={st.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-100">{st.name}</div>
                          <div className="text-[11px] font-mono text-slate-400">{st.email}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300">{st.role}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">{st.permissions.join(" · ")}</td>
                        <td className="py-2.5 px-4 text-emerald-400">{st.status}</td>
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
          appPreview ? "sticky bottom-0 z-30" : "fixed bottom-0 inset-x-0 z-30 lg:hidden"
        } bg-[#0F141F]/95 backdrop-blur border-t border-slate-800 grid grid-cols-5 pb-safe`}
      >
        {(
          [
            { id: "overview", label: "总览", Icon: LayoutDashboard },
            { id: "members", label: "会员", Icon: Users },
            { id: "trading", label: "持仓", Icon: Activity },
            { id: "settings", label: "配置", Icon: Sliders },
            { id: "staff", label: "人员", Icon: ShieldCheck },
          ] as { id: AgentTab; label: string; Icon: React.ComponentType<{ className?: string }> }[]
        ).map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`py-2 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                active ? "text-blue-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
