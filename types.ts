export type CanonicalUserRole =
  | 'SUPER_ADMIN'
  | 'PLATFORM_OPS'
  | 'RISK_OFFICER'
  | 'FINANCE_OFFICER'
  | 'AGENT_L1'
  | 'AGENT_L2'
  | 'AGENT_STAFF'
  | 'MEMBER'
  | 'SUPPORT';

export type UserRole = CanonicalUserRole | 'AGENT_ADMIN';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED';

export type InstrumentCode = 'WTI' | 'BRENT' | 'GOLD' | 'SILVER' | 'NG';

export type Timeframe = 'tick' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

export type OrderType = 'MARKET' | 'LIMIT';
export type OrderSide = 'BUY' | 'SELL';
export type PositionEffect = 'OPEN' | 'CLOSE';
export type PositionDirection = 'LONG' | 'SHORT';

export type OrderStatus = 'PENDING' | 'PARTIAL_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type LedgerEntryType =
  | 'INITIAL_DEPOSIT'
  | 'AGENT_ADJUST_CREDIT'
  | 'AGENT_ADJUST_DEBIT'
  | 'MARGIN_LOCK'
  | 'MARGIN_RELEASE'
  | 'FEE_CHARGE'
  | 'REALIZED_PNL'
  | 'LIQUIDATION';

export type FeedHealthStatus = 'CONNECTED' | 'STALE' | 'DISCONNECTED';

export type QuoteDataClassification = 'LIVE' | 'DELAYED' | 'HISTORICAL' | 'SIMULATION' | 'UNAVAILABLE';

export type MarketDataMode = 'PRODUCTION_REAL' | 'DEV_TEST_SIM';

export interface Tenant {
  id: string;
  code: string;
  name: string;
  brandName: string;
  domain: string;
  parentId: string | null;
  status: TenantStatus;
  defaultInitialCapital: number;
  allowedInstruments: InstrumentCode[];
  accentColor: string;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  permissions: string[];
  createdAt: string;
}

export interface FuturesInstrument {
  code: InstrumentCode;
  name: string;
  marketSymbol: string;
  activeContract: string;
  unitLabel: string;
  multiplier: number;
  tickSize: number;
  pricePrecision: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
  feePerLot: number;
  maxLotsPerOrder: number;
  sessionLabel: string;
  exchangeLabel: string;
  tradingEnabled: boolean;
}

export interface MarketQuote {
  instrumentCode: InstrumentCode;
  contractCode: string;
  marketSymbol: string;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  prevClose: number | null;
  change: number;
  changePct: number;
  volume: number | null;
  sourceName: string;
  sourceUrl?: string;
  sourceTimestamp?: string | null;
  dataClassification?: QuoteDataClassification;
  licenseStatus?: string;
  latencyMs: number;
  dataAgeSeconds?: number;
  updatedAt: string;
}

export interface MarketKline {
  time: number; // Unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingAccount {
  id: string;
  accountNo: string;
  userId: string;
  tenantId: string;
  initialCapital: number;
  balance: number;
  availableFunds: number;
  frozenFunds: number;
  usedMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  riskRatio: number; // equity / usedMargin * 100, or 9999 when usedMargin === 0
  status: 'ACTIVE' | 'FROZEN';
  updatedAt: string;
}

export interface AccountLedgerEntry {
  id: string;
  accountId: string;
  tenantId: string;
  userId: string;
  type: LedgerEntryType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId: string;
  operatorId: string;
  remark: string;
  createdAt: string;
}

export interface TradeOrder {
  id: string;
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  accountId: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  orderType: OrderType;
  side: OrderSide;
  positionEffect: PositionEffect;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  avgFillPrice: number | null;
  frozenMargin: number;
  frozenFee: number;
  status: OrderStatus;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeExecution {
  id: string;
  orderId: string;
  tenantId: string;
  userId: string;
  accountId: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  side: OrderSide;
  positionEffect: PositionEffect;
  quantity: number;
  price: number;
  fee: number;
  realizedPnl: number;
  executedAt: string;
}

export interface TradePosition {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  direction: PositionDirection;
  quantity: number;
  avgOpenPrice: number;
  markPrice: number;
  usedMargin: number;
  unrealizedPnl: number;
  updatedAt: string;
}

export interface TradeRiskEvent {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  eventType: 'MARGIN_WARNING' | 'FORCED_LIQUIDATION' | 'FEED_HALT_REJECT' | 'ISOLATION_DENIED';
  detail: string;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  tenantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  createdAt: string;
}

export interface MatchingRuleConfig {
  pauseOnFeedDisconnect: boolean;
  maxFeedStaleSeconds: number;
  autoLiquidationEnabled: boolean;
  liquidationRiskThresholdPct: number;
  marginWarningThresholdPct: number;
  simulatedSlippageTicks: number;
  allowPartialFills: boolean;
}

export interface SessionInfo {
  sessionId: string;
  expiresAt: string;
  token?: string;
  user: User;
  effectiveRole: CanonicalUserRole;
  permissions: string[];
  tenant: Tenant | null;
}

export interface SessionSummary {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  tenantId: string | null;
  role: CanonicalUserRole;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  isCurrent?: boolean;
}

export interface ApprovalRequest {
  id: string;
  actionType: 'FUNDS_ADJUST' | 'MATCHING_RULE_UPDATE' | 'USER_ROLE_CHANGE' | 'FORCE_LOGOUT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requesterId: string;
  requesterName: string;
  requesterRole: CanonicalUserRole;
  approverId: string | null;
  approverName: string | null;
  tenantId: string | null;
  targetId: string;
  payload: Record<string, unknown>;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface DemoPresetAccount {
  id: string;
  label: string;
  roleLabel: string;
  tenantName: string;
  userId: string;
  role: UserRole;
}

export interface LatencyBreakdown {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  seg1ExchangeToVendorMs: number;
  seg2VendorToIngestMs: number;
  seg3NormalizeCacheMs: number;
  seg4WsPushMs: number;
  slaTargetMs: number;
}

export interface InstrumentCollectorStatus {
  instrumentCode: InstrumentCode;
  primaryContract: string;
  vendorSymbol: string;
  collectorState: 'RUNNING' | 'STOPPED' | 'RECONNECTING' | 'ERROR';
  connectionStatus: FeedHealthStatus;
  dataClassification: QuoteDataClassification;
  qualityStatus: 'HEALTHY' | 'DEDUP_FILTERED' | 'ANOMALY_FLAGGED' | 'STALE_OR_CLOSED' | 'UNAVAILABLE';
  activeProviderId: string;
  sourceName: string;
  sourceUrl: string;
  lastPrice: number | null;
  sourceTimestamp: string | null;
  receivedAt: string | null;
  processedAt: string | null;
  fetchLatencyMs: number;
  dataAgeSeconds: number;
  updateFrequencySec: number;
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  successRatePct: number;
  consecutiveFailures: number;
  reconnectCount: number;
  failoverCount: number;
  lastError: string | null;
  licenseStatus: string;
  redistributionAllowed: boolean;
}

export interface CollectorEventEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  eventType: string;
  instrumentCode: string;
  message: string;
}

export interface ContractQuoteSnapshot {
  instrumentCode: InstrumentCode;
  contractCode: string;
  vendorSymbol: string;
  isContinuous: boolean;
  price: number | null;
  prevClose: number | null;
  sourceTimestamp: string | null;
  receivedAt: string | null;
  dataClassification: QuoteDataClassification;
  qualityStatus?: string;
  sourceName: string;
  sourceUrl: string;
  fetchLatencyMs: number;
}

export interface SmartSyncEngineState {
  engineState: 'RUNNING' | 'STOPPED' | 'RECONNECTING' | 'ERROR';
  feedState: QuoteDataClassification;
  liveVerified: boolean;
  startedAt: string | null;
  lastSyncAt: string | null;
  activeEndpoint: string | null;
  licenseStatus: 'NON_COMMERCIAL_PUBLIC' | 'COMMERCIAL_AUTHORIZED' | 'SIMULATION_BENCHMARK';
  redistributionAllowed: boolean;
  authorizedMemberChannelReady: boolean;
  overallSuccessRatePct: number;
  totalAttempts: number;
  totalSuccess: number;
  totalFailures: number;
  reconnectCount: number;
  failoverCount: number;
  persistencePath: string;
  persistedRawSnapshotsCount: number;
  persistedQuotesCount: number;
  persistedKlinesCount: number;
  persistedLogsCount: number;
  persistedErrorLogsCount: number;
  lastError: string | null;
  instruments: Record<string, InstrumentCollectorStatus>;
  events: CollectorEventEntry[];
}

export interface MarketEngineHealth {
  mode: MarketDataMode;
  status: FeedHealthStatus;
  feedState: QuoteDataClassification;
  liveVerified: boolean;
  activeProviderId: string;
  source: string;
  lastTickAt: string;
  latencyMs: number;
  latencyStats: LatencyBreakdown;
  wsConnectedClients: number;
  persistencePath: string;
  uptimeSeconds: number;
  deduplicatedCount: number;
  anomalyRejectedCount: number;
  totalTicksProcessed: number;
  collector: SmartSyncEngineState;
}

export interface MarketDataSource {
  id: string;
  name: string;
  providerCode:
    | "YAHOO_PUBLIC"
    | "SINA_PUBLIC"
    | "DATABENTO"
    | "BARCHART"
    | "DXFEED"
    | "HUITONG_PRO"
    | "NYMEX_ICE_BENCHMARK"
    | "BACKUP_AGGREGATOR";
  tierRank: string;
  protocol: "WEBSOCKET" | "REST_POLL" | "PYTHON_SDK_STREAM" | "INTERNAL_ENGINE";
  exchangeCoverage: string;
  licenseStatus: "COMMERCIAL_AUTHORIZED" | "NON_COMMERCIAL_PUBLIC" | "SIMULATION_BENCHMARK" | "PENDING_KEY";
  redistributionAllowed: boolean;
  pricingNote: string;
  priority: number;
  status: FeedHealthStatus;
  latencyMs: number;
  lastError?: string | null;
  supportedSymbols: string[];
  lastHeartbeatAt: string;
  isActive: boolean;
}

export interface CommercialLicenseItem {
  id: string;
  title: string;
  requirement: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface FuturesContract {
  id: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  deliveryMonth: string;
  isMainContract: boolean;
  isContinuous: boolean;
  expiryDate: string;
  rolloverRule: string;
  tickSize: number;
  multiplier: number;
  status: "TRADING" | "ROLLOVER_SOON" | "EXPIRED";
}

export interface MarketDataLog {
  id: string;
  providerId: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  sourceTimestamp: string;
  receivedAt: string;
  processedAt: string;
  latencyMs: number;
  status: "ACCEPTED" | "DEDUP_DROPPED" | "ANOMALY_REJECTED" | "STALE_DROPPED" | "FETCH_ERROR" | "INVALID_TIMESTAMP";
  note: string;
}

export interface SmartControlDirective {
  id: string;
  severity: "HIGH" | "MEDIUM" | "INFO";
  category: "RISK" | "MARKET_FEED" | "TENANT_OPS" | "MARGIN";
  title: string;
  reason: string;
  impact: string;
  actionLabel: string;
  actionType: "SWITCH_BACKUP_FEED" | "RAISE_WTI_MARGIN" | "ENABLE_CIRCUIT_BREAKER" | "RESUME_FEED";
  targetId?: string;
}
