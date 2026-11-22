import type {
  FeedHealthStatus,
  InstrumentCode,
  MarketKline,
  QuoteDataClassification,
  Timeframe,
} from "../../types";

export interface ContractCollectionSpec {
  instrumentCode: InstrumentCode;
  contractCode: string;
  vendorSymbols: Record<string, string>; // providerId -> vendor symbol
  unitLabel: string;
  currency: string;
  deliveryMonth: string;
  isContinuous: boolean;
  isMainContract: boolean;
  expiryDate: string;
  rolloverRule: string;
  tickSize: number;
  multiplier: number;
}

export interface RawVendorPayload {
  providerId: string;
  vendorSymbol: string;
  sourceUrl: string;
  receivedAt: string;
  fetchLatencyMs: number;
  rawData: unknown;
}

export interface StandardizedQuoteRecord {
  providerId: string;
  providerName: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  vendorSymbol: string;
  isContinuous: boolean;
  unitLabel: string;
  currency: string;
  price: number;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  prevClose: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  exchangeName: string;
  sourceUrl: string;
  sourceTimestamp: string;
  sourceEpochSec: number;
  receivedAt: string;
  processedAt: string;
  fetchLatencyMs: number;
  dataAgeSeconds: number;
  dataClassification: QuoteDataClassification;
  qualityStatus?: string;
  licenseStatus: "NON_COMMERCIAL_PUBLIC" | "COMMERCIAL_AUTHORIZED";
  redistributionAllowed: boolean;
}

export interface ProviderHealthCheckResult {
  providerId: string;
  connected: boolean;
  status: FeedHealthStatus;
  activeEndpoint: string;
  checkedAt: string;
  latencyMs: number;
  lastError: string | null;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly providerCode: "YAHOO_PUBLIC" | "SINA_PUBLIC";
  readonly protocol: "REST_POLL";
  readonly licenseStatus: "NON_COMMERCIAL_PUBLIC" | "COMMERCIAL_AUTHORIZED";
  readonly redistributionAllowed: boolean;
  readonly supportedInstruments: InstrumentCode[];
  readonly supportedTimeframes: Timeframe[];
  readonly supportedUnits?: Partial<Record<InstrumentCode, string>>;

  connect(): Promise<boolean>;
  subscribe(specs: ContractCollectionSpec[]): void;
  disconnect(): void;
  reconnect(): Promise<boolean>;
  fetchQuote(spec: ContractCollectionSpec): Promise<RawVendorPayload>;
  fetchBatchQuotes?(specs: ContractCollectionSpec[]): Promise<Map<string, RawVendorPayload>>;
  fetchKlines?(spec: ContractCollectionSpec, timeframe: Timeframe, range: string): Promise<MarketKline[]>;
  normalize(raw: RawVendorPayload, spec: ContractCollectionSpec): StandardizedQuoteRecord | null;
  healthCheck(): ProviderHealthCheckResult;
}

export const COLLECTION_CONTRACT_SPECS: ContractCollectionSpec[] = [
  // Continuous benchmark contracts (strictly separated from specific delivery months)
  {
    instrumentCode: "WTI",
    contractCode: "CL00",
    vendorSymbols: {
      "src-yahoo-public": "CL=F",
      "src-sina-public": "hf_CL",
    },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "连续",
    isContinuous: true,
    isMainContract: false,
    expiryDate: "永续映射",
    rolloverRule: "连续行情指数映射（严格与具体交割月份合约隔离保存）",
    tickSize: 0.01,
    multiplier: 1000,
  },
  {
    instrumentCode: "BRENT",
    contractCode: "BRN00",
    vendorSymbols: {
      "src-yahoo-public": "BZ=F",
      "src-sina-public": "hf_OIL",
    },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "连续",
    isContinuous: true,
    isMainContract: false,
    expiryDate: "永续映射",
    rolloverRule: "连续行情指数映射（严格与具体交割月份合约隔离保存）",
    tickSize: 0.01,
    multiplier: 1000,
  },
  // Concrete WTI delivery month contracts
  {
    instrumentCode: "WTI",
    contractCode: "CL2612",
    vendorSymbols: { "src-yahoo-public": "CLZ26.NYM" },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "2026-12",
    isContinuous: false,
    isMainContract: false,
    expiryDate: "2026-11-20",
    rolloverRule: "NYMEX 2026年12月到期交割合约（移仓窗口）",
    tickSize: 0.01,
    multiplier: 1000,
  },
  {
    instrumentCode: "WTI",
    contractCode: "CL2701",
    vendorSymbols: { "src-yahoo-public": "CLF27.NYM" },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "2027-01",
    isContinuous: false,
    isMainContract: true,
    expiryDate: "2026-12-21",
    rolloverRule: "NYMEX CL 2027年1月主力交割合约",
    tickSize: 0.01,
    multiplier: 1000,
  },
  {
    instrumentCode: "WTI",
    contractCode: "CL2702",
    vendorSymbols: { "src-yahoo-public": "CLG27.NYM" },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "2027-02",
    isContinuous: false,
    isMainContract: false,
    expiryDate: "2027-01-20",
    rolloverRule: "NYMEX CL 2027年2月次主力合约",
    tickSize: 0.01,
    multiplier: 1000,
  },
  // Concrete Brent delivery month contracts
  {
    instrumentCode: "BRENT",
    contractCode: "BRN2701",
    vendorSymbols: { "src-yahoo-public": "BZF27.NYM" },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "2027-01",
    isContinuous: false,
    isMainContract: false,
    expiryDate: "2026-11-30",
    rolloverRule: "Brent 2027年1月交割合约",
    tickSize: 0.01,
    multiplier: 1000,
  },
  {
    instrumentCode: "BRENT",
    contractCode: "BRN2702",
    vendorSymbols: { "src-yahoo-public": "BZG27.NYM" },
    unitLabel: "桶 (USD/bbl)",
    currency: "USD",
    deliveryMonth: "2027-02",
    isContinuous: false,
    isMainContract: true,
    expiryDate: "2026-12-30",
    rolloverRule: "Brent 2027年2月主力交割合约",
    tickSize: 0.01,
    multiplier: 1000,
  },
  // Extended reference instruments
  {
    instrumentCode: "GOLD",
    contractCode: "GC00",
    vendorSymbols: { "src-yahoo-public": "GC=F" },
    unitLabel: "盎司",
    currency: "USD",
    deliveryMonth: "连续",
    isContinuous: true,
    isMainContract: true,
    expiryDate: "永续映射",
    rolloverRule: "COMEX 黄金连续基准",
    tickSize: 0.1,
    multiplier: 100,
  },
  {
    instrumentCode: "SILVER",
    contractCode: "SI00",
    vendorSymbols: { "src-yahoo-public": "SI=F" },
    unitLabel: "盎司",
    currency: "USD",
    deliveryMonth: "连续",
    isContinuous: true,
    isMainContract: true,
    expiryDate: "永续映射",
    rolloverRule: "COMEX 白银连续基准",
    tickSize: 0.005,
    multiplier: 5000,
  },
  {
    instrumentCode: "NG",
    contractCode: "NG00",
    vendorSymbols: { "src-yahoo-public": "NG=F" },
    unitLabel: "MMBtu",
    currency: "USD",
    deliveryMonth: "连续",
    isContinuous: true,
    isMainContract: true,
    expiryDate: "永续映射",
    rolloverRule: "NYMEX 天然气连续基准",
    tickSize: 0.001,
    multiplier: 10000,
  },
];

/**
 * Mandatory pre-failover / pre-switch compatibility guard:
 * Verifies instrument, mapped contract code, currency/unit, and license scope
 * before allowing an automatic or manual provider switch.
 */
export function checkProviderCompatibility(
  targetProvider: MarketDataProvider,
  spec: ContractCollectionSpec
): { ok: boolean; reason?: string } {
  if (!targetProvider.supportedInstruments.includes(spec.instrumentCode)) {
    return {
      ok: false,
      reason: `数据源 [${targetProvider.name}] 不支持品种 ${spec.instrumentCode}`,
    };
  }
  const vendorSym = spec.vendorSymbols[targetProvider.id];
  if (!vendorSym) {
    return {
      ok: false,
      reason: `数据源 [${targetProvider.name}] 缺少合约 ${spec.contractCode} 的兼容映射`,
    };
  }
  if (spec.currency !== "USD") {
    return {
      ok: false,
      reason: `计价货币不兼容 (${spec.currency})`,
    };
  }
  const providerUnit = targetProvider.supportedUnits?.[spec.instrumentCode];
  if (providerUnit && providerUnit !== spec.unitLabel) {
    return {
      ok: false,
      reason: `报价单位不兼容 (${providerUnit} != ${spec.unitLabel})`,
    };
  }
  if (
    targetProvider.licenseStatus !== "NON_COMMERCIAL_PUBLIC" &&
    targetProvider.licenseStatus !== "COMMERCIAL_AUTHORIZED"
  ) {
    return {
      ok: false,
      reason: `授权范围不支持真实行情采集 (${targetProvider.licenseStatus})`,
    };
  }
  return { ok: true };
}
