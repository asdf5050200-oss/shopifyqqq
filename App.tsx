import React, { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, Search, ShieldCheck, Trash2, Users, X } from "lucide-react";
import type {
  DemoPresetAccount,
  MarketEngineHealth,
  MarketQuote,
  SessionInfo,
  SessionSummary,
} from "./types";
import { api, setApiSessionToken } from "./services/apiClient";
import { LandingPage } from "./components/LandingPage";
import { MemberTerminal } from "./components/MemberTerminal";
import { AgentPortal } from "./components/AgentPortal";
import { SuperAdminConsole } from "./components/SuperAdminConsole";
import { OfflineIndicator, PWAInstallButton } from "./components/PWAInstallButton";

const SupportWorkbench: React.FC<{ userName: string }> = ({ userName }) => {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<
    Array<{ user: { id: string; name: string; email: string; status: string }; tenantName: string; accountNo: string; accountStatus: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const res = await api.getSupportMembers(q);
      setRows(res.members || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="bg-[#111827] border border-slate-800 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
          <Users className="w-4 h-4 text-blue-400" />
          <span>客服只读工作台</span>
          <span className="text-xs font-mono font-normal text-slate-400">· {userName}</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchMembers(query);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索姓名或邮箱"
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0B0F17] border border-slate-700 text-xs text-slate-100 w-48 sm:w-56"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
          >
            查询
          </button>
        </form>
      </div>

      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-left">
                <th className="py-2.5 px-4 font-medium">会员</th>
                <th className="py-2.5 px-4 font-medium">所属代理</th>
                <th className="py-2.5 px-4 font-medium">账户编号</th>
                <th className="py-2.5 px-4 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    加载中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    暂无匹配会员
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.user.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-100">{r.user.name}</div>
                      <div className="text-[11px] font-mono text-slate-400">{r.user.email}</div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">{r.tenantName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">{r.accountNo}</td>
                    <td className="py-2.5 px-4 font-mono text-emerald-400">{r.accountStatus}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const [isDevEnvironment, setIsDevEnvironment] = useState<boolean>(import.meta.env.DEV);
  const [demoEnabled, setDemoEnabled] = useState<boolean>(false);
  const [presets, setPresets] = useState<DemoPresetAccount[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [feedHealth, setFeedHealth] = useState<MarketEngineHealth | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [tickSignal, setTickSignal] = useState<number>(0);

  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState<boolean>(false);

  const [sessionsModalOpen, setSessionsModalOpen] = useState<boolean>(false);
  const [activeSessions, setActiveSessions] = useState<SessionSummary[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  // Check existing HttpOnly cookie session & whether DEV_DEMO_MODE is explicitly allowed
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [appCfg, presetRes] = await Promise.all([api.getAppConfig(), api.getPresets()]);
        if (!cancelled) {
          setIsDevEnvironment(Boolean(appCfg.isDevEnvironment));
          setDemoEnabled(Boolean(presetRes.demoEnabled));
          setPresets(presetRes.presets || []);
        }
      } catch {
        // ignore config/preset errors
      }

      try {
        const current = await api.getMe();
        if (!cancelled) {
          setSession(current);
        }
      } catch {
        // Not signed in — stay on clean password login screen (never auto-login!)
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load initial authorized market quotes after authentication
  useEffect(() => {
    if (!session) {
      setQuotes([]);
      setFeedHealth(null);
      return;
    }
    let cancelled = false;
    api
      .getQuotes()
      .then((res) => {
        if (cancelled) return;
        setQuotes(res.quotes || []);
        setFeedHealth(res.health || null);
      })
      .catch(() => {
        // handled gracefully via UI states
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId]);

  // Authenticated WebSocket connection using HttpOnly cookie or short-lived single-use wsTicket
  useEffect(() => {
    if (!session) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    let closedByCleanup = false;
    const currentSession = session;

    async function connectWs() {
      if (closedByCleanup) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const sendSubscriptions = () => {
        const channels: string[] = ["market.quotes.*"];
        if (currentSession.effectiveRole === "MEMBER") {
          channels.push(`orders.user.${currentSession.user.id}`);
        } else if (
          currentSession.effectiveRole === "AGENT_L1" ||
          currentSession.effectiveRole === "AGENT_L2" ||
          currentSession.effectiveRole === "AGENT_STAFF"
        ) {
          if (currentSession.user.tenantId) {
            channels.push(`agent.team.${currentSession.user.tenantId}`);
          }
        } else if (
          currentSession.effectiveRole === "SUPER_ADMIN" ||
          currentSession.effectiveRole === "PLATFORM_OPS" ||
          currentSession.effectiveRole === "RISK_OFFICER"
        ) {
          channels.push("admin.system");
        }
        ws.send(JSON.stringify({ type: "subscribe", channels }));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "auth:required") {
            try {
              const { ticket } = await api.issueWsTicket();
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "auth", ticket }));
              }
            } catch {
              ws.close();
            }
          } else if (msg.type === "auth:ok") {
            setWsConnected(true);
            sendSubscriptions();
          } else if (msg.type === "auth:revoked") {
            setWsConnected(false);
            setApiSessionToken(null);
            setSession(null);
            setLoginError("当前会话已退出或被管理员强制吊销，请重新登录");
          } else if (msg.type === "market:snapshot" || msg.type === "market:tick") {
            if (Array.isArray(msg.quotes)) setQuotes(msg.quotes);
            if (msg.health) setFeedHealth(msg.health);
            if (msg.type === "market:tick") {
              setTickSignal((n) => n + 1);
            }
          } else if (msg.type === "market:restricted") {
            setQuotes([]);
            if (msg.health) setFeedHealth(msg.health);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimerRef.current = window.setTimeout(connectWs, 2500);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    return () => {
      closedByCleanup = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [session?.sessionId]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const nextSession = await api.login(loginEmail, loginPassword);
      setApiSessionToken(nextSession.token || null);
      setSession(nextSession);
      setLoginPassword("");
    } catch (err: any) {
      setLoginError(err?.message || "登录失败");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleDevSwitch = async (userId: string) => {
    setLoginError(null);
    try {
      const nextSession = await api.switchSession(userId);
      setApiSessionToken(nextSession.token || null);
      setSession(nextSession);
    } catch (err: any) {
      setLoginError(err?.message || "演示身份切换失败");
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // clear local state even if network dropped
    }
    setApiSessionToken(null);
    setSession(null);
    setSessionsModalOpen(false);
  };

  const loadMySessions = useCallback(async () => {
    try {
      const res = await api.getSessions();
      setActiveSessions(res.sessions || []);
    } catch {
      setActiveSessions([]);
    }
  }, []);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await api.revokeSession(sessionId);
      if (sessionId === session?.sessionId) {
        setApiSessionToken(null);
        setSession(null);
        setSessionsModalOpen(false);
      } else {
        await loadMySessions();
      }
    } catch {
      // ignore
    }
  };

  const role = session?.effectiveRole;
  const isPlatformConsoleRole =
    role === "SUPER_ADMIN" || role === "PLATFORM_OPS" || role === "RISK_OFFICER" || role === "FINANCE_OFFICER";
  const isAgentRole = role === "AGENT_L1" || role === "AGENT_L2" || role === "AGENT_STAFF";

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-[#0F141F]/95 backdrop-blur border-b border-slate-800/90 px-3 sm:px-6 h-14 pt-safe flex items-center justify-between gap-3 sm:gap-6">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <img
            src="/assets/aistudio/image_2330aaf1.png"
            alt="汇通财经"
            className="w-8 h-8 rounded-lg object-cover bg-white shrink-0"
          />
          <span className="font-display text-base font-bold tracking-tight text-slate-100">
            汇通财经
          </span>
        </div>

        {/* Optional Dev Demo Switcher — ONLY rendered when server explicitly enables DEV_DEMO_MODE=true outside production */}
        {session && demoEnabled && presets.length > 0 && (
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
            {presets.map((p) => {
              const active = session.user.id === p.userId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleDevSwitch(p.userId)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:text-white hover:bg-slate-800/80"
                  }`}
                >
                  {p.roleLabel} · {p.label.split(" ")[0]}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <PWAInstallButton />

          {session && (
            <>
              <button
                type="button"
                onClick={() => {
                  setSessionsModalOpen(true);
                  loadMySessions();
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">
                  {session.user.name.split(" ")[0]} · {session.effectiveRole}
                </span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/70 text-slate-300 hover:text-red-200 border border-slate-700 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">退出</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">
        {!authChecked && (
          <div className="max-w-7xl mx-auto px-6 py-16 text-center text-sm text-slate-400">
            校验会话中...
          </div>
        )}

        {authChecked && !session && (
          <LandingPage
            loginEmail={loginEmail}
            loginPassword={loginPassword}
            loginError={loginError}
            loggingIn={loggingIn}
            isDevEnvironment={isDevEnvironment}
            onEmailChange={setLoginEmail}
            onPasswordChange={setLoginPassword}
            onSubmitLogin={handlePasswordLogin}
          />
        )}

        {session && role === "MEMBER" && (
          <MemberTerminal
            currentUser={session.user}
            currentTenant={session.tenant}
            quotes={quotes}
            feedHealth={feedHealth}
            lastTickSignal={tickSignal}
          />
        )}

        {session && isAgentRole && (
          <AgentPortal
            currentUser={session.user}
            effectiveRole={session.effectiveRole}
            permissions={session.permissions}
            lastTickSignal={tickSignal}
          />
        )}

        {session && isPlatformConsoleRole && (
          <SuperAdminConsole
            quotes={quotes}
            effectiveRole={session.effectiveRole}
            permissions={session.permissions}
            lastTickSignal={tickSignal}
          />
        )}

        {session && role === "SUPPORT" && <SupportWorkbench userName={session.user.name} />}
      </main>

      <footer className="hidden lg:flex border-t border-slate-800/80 bg-[#0F141F] px-6 py-3 text-xs text-slate-500 flex-wrap items-center justify-between gap-3">
        <div>汇通财经</div>
        <div className="flex items-center gap-3 font-mono">
          <span>{session ? (wsConnected ? "WS 已连接" : "WS 重连中") : "未登录"}</span>
          <span>·</span>
          <span>模拟盘</span>
        </div>
      </footer>

      <OfflineIndicator />

      {/* Multi-Device Active Sessions Drawer/Modal */}
      {sessionsModalOpen && session && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">会话管理</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{session.effectiveRole}</p>
              </div>
              <button
                type="button"
                onClick={() => setSessionsModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {activeSessions.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-slate-200 flex items-center gap-2">
                      <span>{s.id}</span>
                      {s.isCurrent && <span className="text-emerald-400 text-[11px]">· 当前</span>}
                    </div>
                    <div className="text-slate-400 truncate mt-0.5 font-mono">
                      {s.ip} · {s.userAgent}
                    </div>
                    <div className="text-slate-500 font-mono text-[11px] mt-0.5">
                      过期 {new Date(s.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 text-red-200 border border-red-800 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{s.isCurrent ? "退出" : "下线"}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;