import React, { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LineChart,
  Shield,
  Users,
} from "lucide-react";

import { InfoTip } from "./InfoCollapse";

type PortalKey = "SUPER_ADMIN" | "AGENT_L1" | "AGENT_L2" | "AGENT_STAFF" | "MEMBER";
type AccountFilter = "ALL" | "PLATFORM" | "AGENT" | "MEMBER";

interface PortalEntrance {
  key: PortalKey;
  title: string;
  subtitle: string;
  scopeSummary: string;
  defaultEmail: string;
  icon: React.FC<{ className?: string }>;
}

interface DevAccountEntry {
  id: string;
  name: string;
  roleLabel: string;
  canonicalRole: string;
  category: Exclude<AccountFilter, "ALL">;
  portalKey: PortalKey;
  tenantName: string;
  email: string;
  devPassword: string;
  scopeNote: string;
}

const PORTAL_ENTRANCES: PortalEntrance[] = [
  {
    key: "SUPER_ADMIN",
    title: "平台总控",
    subtitle: "Super Admin",
    scopeSummary: "行情同步 · 风控 · 租户管理",
    defaultEmail: "super@meridian.io",
    icon: Shield,
  },
  {
    key: "AGENT_L1",
    title: "一级代理",
    subtitle: "Agent L1",
    scopeSummary: "会员 · 资金 · 品牌",
    defaultEmail: "admin@alpha.meridian.local",
    icon: Building2,
  },
  {
    key: "AGENT_L2",
    title: "二级代理",
    subtitle: "Agent L2",
    scopeSummary: "二级团队 · 会员资金",
    defaultEmail: "admin@gamma.meridian.local",
    icon: Building2,
  },
  {
    key: "AGENT_STAFF",
    title: "代理风控",
    subtitle: "Agent Staff",
    scopeSummary: "订单 · 持仓只读",
    defaultEmail: "ops@alpha.meridian.local",
    icon: Users,
  },
  {
    key: "MEMBER",
    title: "会员终端",
    subtitle: "Member",
    scopeSummary: "K线 · 模拟交易",
    defaultEmail: "zhangwei@alpha.meridian.local",
    icon: LineChart,
  },
];

const DEV_ACCOUNTS: DevAccountEntry[] = [
  {
    id: "usr-super-1",
    name: "平台总运营官",
    roleLabel: "总控官",
    canonicalRole: "SUPER_ADMIN",
    category: "PLATFORM",
    portalKey: "SUPER_ADMIN",
    tenantName: "全局",
    email: "super@meridian.io",
    devPassword: "Meridian@2026",
    scopeNote: "全平台管理",
  },
  {
    id: "usr-alpha-admin",
    name: "林致远",
    roleLabel: "一级代理",
    canonicalRole: "AGENT_L1",
    category: "AGENT",
    portalKey: "AGENT_L1",
    tenantName: "华盛 ALPHA",
    email: "admin@alpha.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "ALPHA 管理 · GAMMA 只读",
  },
  {
    id: "usr-alpha-staff",
    name: "陈思琪",
    roleLabel: "风控专员",
    canonicalRole: "AGENT_STAFF",
    category: "AGENT",
    portalKey: "AGENT_STAFF",
    tenantName: "华盛 ALPHA",
    email: "ops@alpha.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "ALPHA 只读",
  },
  {
    id: "usr-beta-admin",
    name: "周明辉",
    roleLabel: "一级代理",
    canonicalRole: "AGENT_L1",
    category: "AGENT",
    portalKey: "AGENT_L1",
    tenantName: "鼎泰 BETA",
    email: "admin@beta.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "BETA 管理",
  },
  {
    id: "usr-gamma-admin",
    name: "陈星河",
    roleLabel: "二级代理",
    canonicalRole: "AGENT_L2",
    category: "AGENT",
    portalKey: "AGENT_L2",
    tenantName: "星河 GAMMA",
    email: "admin@gamma.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "GAMMA 独立管理（隶属 ALPHA）",
  },
  {
    id: "usr-alpha-m1",
    name: "张伟",
    roleLabel: "会员",
    canonicalRole: "MEMBER",
    category: "MEMBER",
    portalKey: "MEMBER",
    tenantName: "华盛 ALPHA",
    email: "zhangwei@alpha.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "WTI · BRENT · GOLD · SILVER · NG",
  },
  {
    id: "usr-alpha-m2",
    name: "李敏",
    roleLabel: "会员",
    canonicalRole: "MEMBER",
    category: "MEMBER",
    portalKey: "MEMBER",
    tenantName: "华盛 ALPHA",
    email: "limin@alpha.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "WTI · BRENT · GOLD · SILVER · NG",
  },
  {
    id: "usr-beta-m1",
    name: "王强",
    roleLabel: "会员",
    canonicalRole: "MEMBER",
    category: "MEMBER",
    portalKey: "MEMBER",
    tenantName: "鼎泰 BETA",
    email: "wangqiang@beta.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "WTI · BRENT",
  },
  {
    id: "usr-beta-m2",
    name: "赵雪",
    roleLabel: "会员",
    canonicalRole: "MEMBER",
    category: "MEMBER",
    portalKey: "MEMBER",
    tenantName: "鼎泰 BETA",
    email: "zhaoxue@beta.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "WTI · BRENT",
  },
  {
    id: "usr-gamma-m1",
    name: "孙浩",
    roleLabel: "二级会员",
    canonicalRole: "MEMBER",
    category: "MEMBER",
    portalKey: "MEMBER",
    tenantName: "星河 GAMMA",
    email: "sunhao@gamma.meridian.local",
    devPassword: "Meridian@2026",
    scopeNote: "WTI · BRENT · GOLD",
  },
];

interface LandingPageProps {
  loginEmail: string;
  loginPassword: string;
  loginError: string | null;
  loggingIn: boolean;
  isDevEnvironment: boolean;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmitLogin: (e: React.FormEvent) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  loginEmail,
  loginPassword,
  loginError,
  loggingIn,
  isDevEnvironment,
  onEmailChange,
  onPasswordChange,
  onSubmitLogin,
}) => {
  const [selectedPortal, setSelectedPortal] = useState<PortalKey>("SUPER_ADMIN");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("ALL");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loginSectionRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const activePortal = useMemo(
    () => PORTAL_ENTRANCES.find((p) => p.key === selectedPortal) ?? PORTAL_ENTRANCES[0],
    [selectedPortal]
  );

  const filteredAccounts = useMemo(() => {
    if (accountFilter === "ALL") return DEV_ACCOUNTS;
    return DEV_ACCOUNTS.filter((a) => a.category === accountFilter);
  }, [accountFilter]);

  const handleSelectPortal = (portal: PortalEntrance) => {
    setSelectedPortal(portal.key);
    onEmailChange(portal.defaultEmail);
    passwordInputRef.current?.focus();
  };

  const handleFillAccount = (acc: DevAccountEntry, fillPassword: boolean) => {
    setSelectedPortal(acc.portalKey);
    onEmailChange(acc.email);
    onPasswordChange(fillPassword ? acc.devPassword : "");
    loginSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      passwordInputRef.current?.focus();
    }, 180);
  };

  const handleCopyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === key ? null : cur));
      }, 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-10">
      {/* Hero + Portal Entry & Sign-In */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-slate-400">汇通财经 · WTI CL / Brent BRN</div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50 mt-0.5">
                系统入口
              </h1>
            </div>
            <InfoTip text="各端严格执行账号与密码鉴权隔离，禁止未授权越权访问。" label="登录说明" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PORTAL_ENTRANCES.map((portal) => {
              const Icon = portal.icon;
              const isSelected = selectedPortal === portal.key;
              return (
                <button
                  key={portal.key}
                  type="button"
                  onClick={() => handleSelectPortal(portal)}
                  className={`text-left p-4 rounded-xl border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500 ${
                    isSelected
                      ? "bg-[#111827] border-blue-500"
                      : "bg-[#0F141F] border-slate-800 hover:border-slate-700 hover:bg-[#111827]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "text-blue-400" : "text-slate-400"}`} />
                      <span className="text-xs text-slate-400 truncate">{portal.subtitle}</span>
                    </div>
                    <ArrowRight
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        isSelected ? "text-blue-400 translate-x-0.5" : "text-slate-500"
                      }`}
                    />
                  </div>
                  <div className="text-sm font-semibold text-slate-100 mb-1">{portal.title}</div>
                  <p className="text-xs text-slate-400">{portal.scopeSummary}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Strict Login Form */}
        <div
          ref={loginSectionRef}
          className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-400">{activePortal.subtitle}</div>
              <h2 className="text-base font-semibold text-slate-100 truncate">{activePortal.title}</h2>
            </div>
          </div>

          {loginError && (
            <div className="px-3.5 py-2.5 rounded-lg bg-red-950/70 border border-red-800 text-xs text-red-200">
              {loginError}
            </div>
          )}

          <form onSubmit={onSubmitLogin} className="space-y-4">
            <div>
              <label htmlFor="landing-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                邮箱
              </label>
              <input
                id="landing-email"
                type="email"
                required
                autoComplete="username"
                placeholder="输入账号邮箱"
                value={loginEmail}
                onChange={(e) => onEmailChange(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-[#0B0F17] border border-slate-700 focus:border-blue-500 focus:outline-none text-sm font-mono text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="landing-password" className="block text-xs font-medium text-slate-300 mb-1.5">
                密码
              </label>
              <div className="relative">
                <input
                  ref={passwordInputRef}
                  id="landing-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="输入密码"
                  value={loginPassword}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-[#0B0F17] border border-slate-700 focus:border-blue-500 focus:outline-none text-sm font-mono text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {loggingIn ? "登录中..." : "登录"}
            </button>
          </form>
        </div>
      </section>

      {/* Development Accounts Directory */}
      {isDevEnvironment && (
        <section className="space-y-4 pt-6 border-t border-slate-800/90">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-lg font-semibold text-slate-100">测试账号</h2>
              <span className="text-xs font-mono text-slate-400">{DEV_ACCOUNTS.length} 个</span>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg self-start">
              {(
                [
                  { id: "ALL", label: `全部 (${DEV_ACCOUNTS.length})` },
                  { id: "PLATFORM", label: "总控 (1)" },
                  { id: "AGENT", label: "代理 (4)" },
                  { id: "MEMBER", label: "会员 (5)" },
                ] as { id: AccountFilter; label: string }[]
              ).map((tab) => {
                const active = accountFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAccountFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      active ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0F141F] text-slate-400 font-medium">
                    <th className="py-3 px-4 whitespace-nowrap">账号 / 角色</th>
                    <th className="py-3 px-4 whitespace-nowrap">租户</th>
                    <th className="py-3 px-4 whitespace-nowrap">邮箱</th>
                    <th className="py-3 px-4 whitespace-nowrap">密码</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredAccounts.map((acc) => {
                    const isSelectedRow = loginEmail.trim().toLowerCase() === acc.email.toLowerCase();
                    return (
                      <tr
                        key={acc.id}
                        className={`transition-colors ${
                          isSelectedRow ? "bg-blue-950/25" : "hover:bg-slate-800/40"
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-100">{acc.name}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {acc.roleLabel} · {acc.canonicalRole}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-300">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{acc.tenantName}</span>
                            <InfoTip text={acc.scopeNote} label="权限范围" />
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-100">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{acc.email}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(`email-${acc.id}`, acc.email)}
                              aria-label={`复制邮箱 ${acc.email}`}
                              className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                            >
                              {copiedId === `email-${acc.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-200">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{acc.devPassword}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(`pwd-${acc.id}`, acc.devPassword)}
                              aria-label="复制密码"
                              className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                            >
                              {copiedId === `pwd-${acc.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleFillAccount(acc, false)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer transition-colors"
                            >
                              填邮箱
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFillAccount(acc, true)}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer transition-colors"
                            >
                              填账密
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
