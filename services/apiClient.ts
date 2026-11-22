import type {
  AccountLedgerEntry,
  AdminAuditLog,
  ApprovalRequest,
  CommercialLicenseItem,
  ContractQuoteSnapshot,
  DemoPresetAccount,
  FeedHealthStatus,
  FuturesContract,
  FuturesInstrument,
  InstrumentCode,
  MarketDataLog,
  MarketDataSource,
  MarketEngineHealth,
  MarketKline,
  MarketQuote,
  MatchingRuleConfig,
  OrderSide,
  OrderType,
  PositionEffect,
  SessionInfo,
  SessionSummary,
  SmartControlDirective,
  SmartSyncEngineState,
  Tenant,
  Timeframe,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradeRiskEvent,
  TradingAccount,
  User,
} from "../types";

let activeSessionToken: string | null = null;

export function setApiSessionToken(token: string | null): void {
  activeSessionToken = token;
}

export function getApiSessionToken(): string | null {
  return activeSessionToken;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (activeSessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${activeSessionToken}`;
  }

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  getAppConfig: () =>
    apiFetch<{
      name: string;
      shortName: string;
      logoUrl: string;
      demoModeEnabled: boolean;
      isDevEnvironment: boolean;
      supportedRoles: string[];
    }>("/api/v1/app/config"),

  getPresets: () =>
    apiFetch<{ demoEnabled: boolean; presets: DemoPresetAccount[] }>("/api/v1/auth/presets"),

  switchSession: (userId: string) =>
    apiFetch<SessionInfo>("/api/v1/auth/switch-session", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  login: (email: string, password: string) =>
    apiFetch<SessionInfo>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    apiFetch<{ ok: boolean; message: string }>("/api/v1/auth/logout", {
      method: "POST",
    }),

  getMe: () => apiFetch<SessionInfo>("/api/v1/auth/me"),

  issueWsTicket: () =>
    apiFetch<{ ticket: string; expiresAt: string }>("/api/v1/auth/ws-ticket", {
      method: "POST",
    }),

  getSessions: () => apiFetch<{ sessions: SessionSummary[] }>("/api/v1/auth/sessions"),

  revokeSession: (sessionId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),

  getQuotes: () =>
    apiFetch<{
      licenseRestricted?: boolean;
      restrictionReason?: string;
      instruments: FuturesInstrument[];
      quotes: MarketQuote[];
      contractQuotes: ContractQuoteSnapshot[];
      health: MarketEngineHealth;
    }>("/api/v1/market/quotes"),

  getKlines: (instrument: InstrumentCode, timeframe: Timeframe) =>
    apiFetch<{
      instrumentCode: InstrumentCode;
      timeframe: Timeframe;
      licenseRestricted?: boolean;
      klines: MarketKline[];
    }>(
      `/api/v1/market/klines?instrument=${encodeURIComponent(instrument)}&timeframe=${encodeURIComponent(timeframe)}`
    ),

  // Member endpoints
  getMemberWorkspace: () =>
    apiFetch<{
      user: User;
      tenant: Tenant | null;
      account: TradingAccount | null;
      instruments: FuturesInstrument[];
      positions: TradePosition[];
      orders: TradeOrder[];
      executions: TradeExecution[];
      ledger: AccountLedgerEntry[];
    }>("/api/v1/member/workspace"),

  submitOrder: (payload: {
    instrumentCode: InstrumentCode;
    orderType: OrderType;
    side: OrderSide;
    positionEffect: PositionEffect;
    quantity: number;
    limitPrice?: number | null;
    idempotencyKey: string;
  }) =>
    apiFetch<{ order: TradeOrder; execution?: TradeExecution; account: TradingAccount; deduplicated: boolean }>(
      "/api/v1/member/orders",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  cancelOrder: (orderId: string) =>
    apiFetch<{ order: TradeOrder; account: TradingAccount }>(
      `/api/v1/member/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
      }
    ),

  // Agent endpoints
  getAgentOverview: (tenantId?: string) =>
    apiFetch<{
      tenant: Tenant;
      readOnlyScope?: boolean;
      childTenants?: Tenant[];
      members: User[];
      staff: User[];
      accounts: TradingAccount[];
      positions: TradePosition[];
      orders: TradeOrder[];
      executions: TradeExecution[];
      ledger: AccountLedgerEntry[];
      riskEvents: TradeRiskEvent[];
      globalInstruments: FuturesInstrument[];
    }>(tenantId ? `/api/v1/agent/overview?tenantId=${encodeURIComponent(tenantId)}` : "/api/v1/agent/overview"),

  createAgentMember: (payload: { name: string; email: string; initialCapital?: number; tenantId?: string }) =>
    apiFetch<{ member: User; account: TradingAccount }>("/api/v1/agent/members", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adjustAccountFunds: (accountId: string, amount: number, remark: string) =>
    apiFetch<{ account: TradingAccount }>(`/api/v1/agent/accounts/${encodeURIComponent(accountId)}/adjust`, {
      method: "POST",
      body: JSON.stringify({ amount, remark }),
    }),

  updateAgentSettings: (payload: {
    brandName?: string;
    domain?: string;
    defaultInitialCapital?: number;
    allowedInstruments?: InstrumentCode[];
    tenantId?: string;
  }) =>
    apiFetch<{ tenant: Tenant }>("/api/v1/agent/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  createAgentStaff: (payload: { name: string; email: string; permissions: string[]; tenantId?: string }) =>
    apiFetch<{ staff: User }>("/api/v1/agent/staff", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Support endpoint
  getSupportMembers: (q?: string) =>
    apiFetch<{
      supportAgent: string;
      totalCount: number;
      members: Array<{ user: User; tenantName: string; accountNo: string; accountStatus: string }>;
    }>(q ? `/api/v1/support/members?q=${encodeURIComponent(q)}` : "/api/v1/support/members"),

  // Super Admin / Ops / Risk / Finance endpoints
  getAdminOverview: () =>
    apiFetch<{
      effectiveRole?: string;
      permissions?: string[];
      tenants: Tenant[];
      users: User[];
      instruments: FuturesInstrument[];
      contracts: FuturesContract[];
      contractQuotes: ContractQuoteSnapshot[];
      dataSources: MarketDataSource[];
      licenseChecklist: CommercialLicenseItem[];
      dataLogs: MarketDataLog[];
      smartDirectives: SmartControlDirective[];
      accounts: TradingAccount[];
      positions: TradePosition[];
      orders: TradeOrder[];
      executions: TradeExecution[];
      ledger: AccountLedgerEntry[];
      riskEvents: TradeRiskEvent[];
      auditLogs: AdminAuditLog[];
      approvals?: ApprovalRequest[];
      matchingRules: MatchingRuleConfig | null;
      health: MarketEngineHealth | null;
    }>("/api/v1/admin/overview"),

  createTenant: (payload: {
    name: string;
    code: string;
    brandName: string;
    domain: string;
    parentId?: string | null;
    defaultInitialCapital: number;
    allowedInstruments: InstrumentCode[];
  }) =>
    apiFetch<{ tenant: Tenant; adminUser: User }>("/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  setTenantStatus: (tenantId: string, status: "ACTIVE" | "SUSPENDED") =>
    apiFetch<{ tenant: Tenant }>(`/api/v1/admin/tenants/${encodeURIComponent(tenantId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  updateInstrumentRule: (code: InstrumentCode, patch: Partial<FuturesInstrument>) =>
    apiFetch<{ instrument: FuturesInstrument }>(`/api/v1/admin/instruments/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  updateMatchingRules: (patch: Partial<MatchingRuleConfig>) =>
    apiFetch<{ matchingRules: MatchingRuleConfig }>("/api/v1/admin/matching-rules", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  setFeedStatus: (status: FeedHealthStatus) =>
    apiFetch<{ health: MarketEngineHealth }>("/api/v1/admin/market/feed-status", {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  startCollector: (instrument?: InstrumentCode) =>
    apiFetch<{ collector: SmartSyncEngineState; health: MarketEngineHealth }>(
      "/api/v1/admin/market/collector/start",
      {
        method: "POST",
        body: JSON.stringify(instrument ? { instrument } : {}),
      }
    ),

  stopCollector: (instrument?: InstrumentCode) =>
    apiFetch<{ collector: SmartSyncEngineState; health: MarketEngineHealth }>(
      "/api/v1/admin/market/collector/stop",
      {
        method: "POST",
        body: JSON.stringify(instrument ? { instrument } : {}),
      }
    ),

  reconnectCollector: (instrument?: InstrumentCode) =>
    apiFetch<{ collector: SmartSyncEngineState; health: MarketEngineHealth }>(
      "/api/v1/admin/market/collector/reconnect",
      {
        method: "POST",
        body: JSON.stringify(instrument ? { instrument } : {}),
      }
    ),

  switchMarketProvider: (providerId: string) =>
    apiFetch<{ activeSource: MarketDataSource; dataSources: MarketDataSource[]; health: MarketEngineHealth }>(
      "/api/v1/admin/market/switch-provider",
      {
        method: "POST",
        body: JSON.stringify({ providerId }),
      }
    ),

  probeMarketSources: () =>
    apiFetch<{ dataSources: MarketDataSource[]; health: MarketEngineHealth }>(
      "/api/v1/admin/market/probe-sources",
      {
        method: "POST",
      }
    ),

  getMarketHistory: (instrument: InstrumentCode, timeframe: Timeframe) =>
    apiFetch<{
      instrumentCode: InstrumentCode;
      timeframe: Timeframe;
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
      stats: {
        persistencePath: string;
        persistedRawSnapshotsCount: number;
        persistedQuotesCount: number;
        persistedKlinesCount: number;
        persistedLogsCount: number;
        persistedErrorLogsCount: number;
      };
    }>(`/api/v1/admin/market/history?instrument=${encodeURIComponent(instrument)}&timeframe=${encodeURIComponent(timeframe)}`),

  testMarketQuality: (mode: "DEDUP" | "ANOMALY") =>
    apiFetch<{ first?: MarketDataLog; second?: MarketDataLog; spike?: MarketDataLog; health: MarketEngineHealth }>(
      "/api/v1/admin/market/test-quality",
      {
        method: "POST",
        body: JSON.stringify({ mode }),
      }
    ),

  executeSmartControl: (actionType: SmartControlDirective["actionType"]) =>
    apiFetch<{ message: string; smartDirectives: SmartControlDirective[]; health: MarketEngineHealth }>(
      "/api/v1/admin/smart-control/execute",
      {
        method: "POST",
        body: JSON.stringify({ actionType }),
      }
    ),

  toggleLicenseChecklist: (id: string) =>
    apiFetch<{ licenseChecklist: CommercialLicenseItem[] }>(
      `/api/v1/admin/market/license-checklist/${encodeURIComponent(id)}`,
      { method: "POST" }
    ),

  getAdminSessions: () => apiFetch<{ sessions: SessionSummary[] }>("/api/v1/admin/sessions"),

  forceLogoutUser: (userId: string) =>
    apiFetch<{ ok: boolean; revokedCount: number }>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/force-logout`,
      { method: "POST" }
    ),

  verifyIsolation: () =>
    apiFetch<{
      step1: string;
      step2Status: number;
      step2Message: string;
      isolated: boolean;
    }>("/api/v1/admin/verify-isolation", { method: "POST" }),
};
