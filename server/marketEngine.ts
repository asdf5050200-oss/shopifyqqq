import crypto from "crypto";
import type {
  CollectorEventEntry,
  CommercialLicenseItem,
  ContractQuoteSnapshot,
  FeedHealthStatus,
  FuturesContract,
  InstrumentCode,
  InstrumentCollectorStatus,
  LatencyBreakdown,
  MarketDataLog,
  MarketDataMode,
  MarketDataSource,
  MarketEngineHealth,
  MarketKline,
  MarketQuote,
  QuoteDataClassification,
  SmartControlDirective,
  SmartSyncEngineState,
  Timeframe,
} from "../types";
import { roundPrice } from "./decimal";
import { COLLECTION_CONTRACT_SPECS, type MarketDataProvider } from "./marketData/contracts";
import { InstrumentCollector, type InstrumentCollectionUpdate } from "./marketData/instrumentCollector";
import { marketHistoryStore } from "./marketData/marketStore";
import { SinaPublicProvider } from "./marketData/providers/sinaProvider";
import { YahooPublicProvider } from "./marketData/providers/yahooProvider";
import { store } from "./store";

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  tick: 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

export interface NormalizedTick {
  providerId: string;
  instrumentCode: InstrumentCode;
  contractCode: string;
  price: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  sourceTimestamp: string;
}

interface InstrumentMarketState {
  anchorOpen: number | null;
  prevClose: number | null;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  volume: number | null;
  sourceName: string;
  sourceUrl: string;
  sourceTimestamp: string | null;
  dataClassification: QuoteDataClassification;
  licenseStatus: string;
  fetchLatencyMs: number;
  dataAgeSeconds: number;
  volatility: number;
  klines: Record<Timeframe, MarketKline[]>;
}

type TickListener = (quotes: MarketQuote[]) => void;

function emptyKlinesMap(): Record<Timeframe, MarketKline[]> {
  return {
    tick: [],
    "1m": [],
    "5m": [],
    "15m": [],
    "30m": [],
    "1h": [],
    "4h": [],
    "1d": [],
    "1w": [],
  };
}

class MarketEngine {
  private states = new Map<InstrumentCode, InstrumentMarketState>();
  private collectors = new Map<InstrumentCode, InstrumentCollector>();

  private readonly yahooProvider = new YahooPublicProvider();
  private readonly sinaProvider = new SinaPublicProvider();

  private mode: MarketDataMode = "PRODUCTION_REAL";
  private healthStatus: FeedHealthStatus = "DISCONNECTED";
  private activeProviderId = "src-yahoo-public";
  private startedAtIso: string | null = null;
  private lastTickAt = new Date().toISOString();
  private lastTickMs = 0;
  private latencyMs = 0;
  private startTimeMs = Date.now();
  private simIntervalId: NodeJS.Timeout | null = null;
  private listeners = new Set<TickListener>();

  // Quality & telemetry counters
  private recentDedupKeys = new Set<string>();
  private deduplicatedCount = 0;
  private anomalyRejectedCount = 0;
  private totalTicksProcessed = 0;
  private latencySamples: number[] = [];
  private collectorEvents: CollectorEventEntry[] = [];

  private licenseChecklist: CommercialLicenseItem[] = [
    {
      id: "lic-commercial",
      title: "商业平台实时展示授权",
      requirement: "当前公共采集通道为 NON_COMMERCIAL_PUBLIC，正式对外运营需配置商业授权",
      verified: false,
      verifiedAt: null,
    },
    {
      id: "lic-redistribution",
      title: "多级代理与会员外部分发权 (External Redistribution)",
      requirement: "未配置商业授权密钥前，会员端行情分发保持关闭",
      verified: false,
      verifiedAt: null,
    },
    {
      id: "lic-sim-trading",
      title: "模拟撮合与衍生计算许可 (Non-Display / Sim Trading)",
      requirement: "向 CME/ICE 及商业供应商报备用于虚拟资金模拟撮合与保证金试算用途",
      verified: false,
      verifiedAt: null,
    },
    {
      id: "lic-history",
      title: "Node.js 独立历史行情与多周期 K 线落库",
      requirement: "已持久化至 data/market-history-store.json（含原始快照、标准报价、1m-1w K线、采集/异常日志）",
      verified: true,
      verifiedAt: new Date().toISOString(),
    },
    {
      id: "lic-latency-sla",
      title: "UTC 时间戳、过期 STALE 拦截与模拟隔离",
      requirement: "严格区分 DELAYED / HISTORICAL / UNAVAILABLE / SIMULATION，杜绝随机仿真价混入真实行情流",
      verified: true,
      verifiedAt: new Date().toISOString(),
    },
  ];

  private dataSources: MarketDataSource[] = [
    {
      id: "src-yahoo-public",
      name: "Yahoo Finance 公开期货接口 (Node.js 主采集源)",
      providerCode: "YAHOO_PUBLIC",
      tierRank: "公开合法主源",
      protocol: "REST_POLL",
      exchangeCoverage: "CME/NYMEX CL=F · Brent BZ=F · CL/BRN 具体交割月合约",
      licenseStatus: "NON_COMMERCIAL_PUBLIC",
      redistributionAllowed: false,
      pricingNote: "公开接口，仅限数据采集",
      priority: 1,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN", "XAU", "XAG", "NG"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: true,
    },
    {
      id: "src-sina-public",
      name: "新浪财经公开期货接口 (Node.js 自动备援)",
      providerCode: "SINA_PUBLIC",
      tierRank: "公开合法备援源",
      protocol: "REST_POLL",
      exchangeCoverage: "WTI (hf_CL) · Brent (hf_OIL) 连续合约实时盘口",
      licenseStatus: "NON_COMMERCIAL_PUBLIC",
      redistributionAllowed: false,
      pricingNote: "主源断线或连续失败 ≥2 次并完成品种/合约/计价单位兼容性校验后自动切换，仅限内部验证",
      priority: 2,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: false,
    },
    {
      id: "src-databento",
      name: "Databento (CME CL + ICE BRN 商业授权通道)",
      providerCode: "DATABENTO",
      tierRank: "商业采购首选",
      protocol: "WEBSOCKET",
      exchangeCoverage: "CME/NYMEX CL · ICE Europe BRN",
      licenseStatus: process.env.DATABENTO_API_KEY ? "COMMERCIAL_AUTHORIZED" : "PENDING_KEY",
      redistributionAllowed: Boolean(process.env.DATABENTO_API_KEY),
      pricingNote: "$125 试用额度 / Standard $199 / Plus $1,750+ (需配置 DATABENTO_API_KEY 及商业合同)",
      priority: 3,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: false,
    },
    {
      id: "src-barchart",
      name: "Barchart OnDemand (商业 REST / 历史回补)",
      providerCode: "BARCHART",
      tierRank: "商业备选",
      protocol: "REST_POLL",
      exchangeCoverage: "NYMEX CL · ICE Europe BRN",
      licenseStatus: process.env.BARCHART_API_KEY ? "COMMERCIAL_AUTHORIZED" : "PENDING_KEY",
      redistributionAllowed: Boolean(process.env.BARCHART_API_KEY),
      pricingNote: "需配置 BARCHART_API_KEY 及商业许可",
      priority: 4,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN", "XAU", "XAG", "NG"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: false,
    },
    {
      id: "src-dxfeed",
      name: "dxFeed (低延迟企业级期货通道)",
      providerCode: "DXFEED",
      tierRank: "低延迟商业",
      protocol: "WEBSOCKET",
      exchangeCoverage: "CME · NYMEX · ICE Europe",
      licenseStatus: process.env.DXFEED_API_KEY ? "COMMERCIAL_AUTHORIZED" : "PENDING_KEY",
      redistributionAllowed: Boolean(process.env.DXFEED_API_KEY),
      pricingNote: "需配置 DXFEED_API_KEY 及机构行情分发协议",
      priority: 5,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN", "XAU", "NG"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: false,
    },
    {
      id: "src-benchmark",
      name: "DEV_TEST_SIM 开发测试仿真模式 (非真实行情)",
      providerCode: "NYMEX_ICE_BENCHMARK",
      tierRank: "离线测试模式",
      protocol: "INTERNAL_ENGINE",
      exchangeCoverage: "内存合成序列（严格与真实行情落库隔离）",
      licenseStatus: "SIMULATION_BENCHMARK",
      redistributionAllowed: false,
      pricingNote: "仅用于开发/休市期间离线调试撮合界面；默认关闭，绝不写入真实历史库",
      priority: 9,
      status: "DISCONNECTED",
      latencyMs: 0,
      supportedSymbols: ["CL", "BRN", "XAU", "XAG", "NG"],
      lastHeartbeatAt: new Date().toISOString(),
      isActive: false,
    },
  ];

  private contracts: FuturesContract[] = COLLECTION_CONTRACT_SPECS.map((spec, idx) => ({
    id: `cnt-${spec.contractCode.toLowerCase()}-${idx}`,
    instrumentCode: spec.instrumentCode,
    contractCode: spec.contractCode,
    deliveryMonth: spec.deliveryMonth,
    isMainContract: spec.isMainContract,
    isContinuous: spec.isContinuous,
    expiryDate: spec.expiryDate,
    rolloverRule: spec.rolloverRule,
    tickSize: spec.tickSize,
    multiplier: spec.multiplier,
    status: spec.contractCode === "CL2612" || spec.contractCode === "BRN2701" ? "ROLLOVER_SOON" : "TRADING",
  }));

  constructor() {
    const requestedMode = (process.env.MARKET_FEED_MODE || "").trim().toUpperCase();
    const isProd = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
    if (!isProd && requestedMode === "DEV_TEST_SIM") {
      this.mode = "DEV_TEST_SIM";
      this.activeProviderId = "src-benchmark";
      this.initializeSimulationBenchmarks();
      this.healthStatus = "CONNECTED";
    } else {
      this.mode = "PRODUCTION_REAL";
      this.initializeEmptyRealStates();
    }
    this.setupCollectors();
  }

  private setupCollectors(): void {
    const schedules: { code: InstrumentCode; pollMs: number; delayMs: number; providers: MarketDataProvider[] }[] = [
      { code: "WTI", pollMs: 6000, delayMs: 0, providers: [this.yahooProvider, this.sinaProvider] },
      { code: "BRENT", pollMs: 6000, delayMs: 900, providers: [this.yahooProvider, this.sinaProvider] },
      { code: "GOLD", pollMs: 12000, delayMs: 1800, providers: [this.yahooProvider] },
      { code: "SILVER", pollMs: 12000, delayMs: 2700, providers: [this.yahooProvider] },
      { code: "NG", pollMs: 12000, delayMs: 3600, providers: [this.yahooProvider] },
    ];

    for (const cfg of schedules) {
      const specs = COLLECTION_CONTRACT_SPECS.filter((s) => s.instrumentCode === cfg.code);
      const collector = new InstrumentCollector({
        instrumentCode: cfg.code,
        specs,
        providers: cfg.providers,
        pollIntervalMs: cfg.pollMs,
        initialDelayMs: cfg.delayMs,
        onUpdate: (update) => this.handleCollectorUpdate(update),
        onEvent: (entry) => this.pushCollectorEvent(entry),
      });
      this.collectors.set(cfg.code, collector);
    }
  }

  private initializeEmptyRealStates(): void {
    const vols: Record<InstrumentCode, number> = {
      WTI: 0.0018,
      BRENT: 0.0017,
      GOLD: 0.0011,
      SILVER: 0.0022,
      NG: 0.0032,
    };

    for (const inst of store.db.instruments) {
      this.states.set(inst.code, {
        anchorOpen: null,
        prevClose: null,
        lastPrice: null,
        bidPrice: null,
        askPrice: null,
        highPrice: null,
        lowPrice: null,
        volume: null,
        sourceName: this.yahooProvider.name,
        sourceUrl: "",
        sourceTimestamp: null,
        dataClassification: "UNAVAILABLE",
        licenseStatus: "NON_COMMERCIAL_PUBLIC",
        fetchLatencyMs: 0,
        dataAgeSeconds: 0,
        volatility: vols[inst.code] ?? 0.0018,
        klines: emptyKlinesMap(),
      });
    }
  }

  private initializeSimulationBenchmarks(): void {
    const benchmarks: Record<InstrumentCode, { price: number; prevClose: number; vol: number }> = {
      WTI: { price: 83.41, prevClose: 82.44, vol: 0.0018 },
      BRENT: { price: 89.95, prevClose: 89.44, vol: 0.0017 },
      GOLD: { price: 3515.4, prevClose: 3685.5, vol: 0.0011 },
      SILVER: { price: 41.07, prevClose: 44.359, vol: 0.0022 },
      NG: { price: 3.748, prevClose: 3.681, vol: 0.0032 },
    };

    const nowSec = Math.floor(Date.now() / 1000);
    for (const inst of store.db.instruments) {
      const bm = benchmarks[inst.code];
      const klines = emptyKlinesMap();

      (Object.keys(TIMEFRAME_SECONDS) as Timeframe[]).forEach((tf) => {
        const stepSec = TIMEFRAME_SECONDS[tf];
        const count = 120;
        const latestBucket = Math.floor(nowSec / stepSec) * stepSec;
        let price = bm.price;
        const pts: MarketKline[] = [];
        for (let i = 0; i < count; i++) {
          const bucketTime = latestBucket - i * stepSec;
          const close = roundPrice(price, inst.pricePrecision);
          const open = roundPrice(close * (1 + Math.sin(i) * 0.001), inst.pricePrecision);
          pts.push({
            time: bucketTime,
            open,
            high: roundPrice(Math.max(open, close) + inst.tickSize * 4, inst.pricePrecision),
            low: roundPrice(Math.max(inst.tickSize, Math.min(open, close) - inst.tickSize * 4), inst.pricePrecision),
            close,
            volume: 200,
          });
          price = open;
        }
        pts.reverse();
        klines[tf] = pts;
      });

      this.states.set(inst.code, {
        anchorOpen: bm.prevClose,
        prevClose: bm.prevClose,
        lastPrice: bm.price,
        bidPrice: roundPrice(bm.price - inst.tickSize, inst.pricePrecision),
        askPrice: roundPrice(bm.price + inst.tickSize, inst.pricePrecision),
        highPrice: bm.price,
        lowPrice: bm.prevClose,
        volume: 15000,
        sourceName: "DEV_TEST_SIM 开发仿真序列",
        sourceUrl: "sim://dev-test-benchmark",
        sourceTimestamp: new Date().toISOString(),
        dataClassification: "SIMULATION",
        licenseStatus: "SIMULATION_BENCHMARK",
        fetchLatencyMs: 12,
        dataAgeSeconds: 0,
        volatility: bm.vol,
        klines,
      });
    }
  }

  private pushCollectorEvent(entry: CollectorEventEntry): void {
    this.collectorEvents.unshift(entry);
    if (this.collectorEvents.length > 80) {
      this.collectorEvents.length = 80;
    }
  }

  private handleCollectorUpdate(update: InstrumentCollectionUpdate): void {
    if (this.mode !== "PRODUCTION_REAL") return;

    this.deduplicatedCount += update.dedupCountIncrement;
    this.anomalyRejectedCount += update.anomalyCountIncrement;
    this.totalTicksProcessed += update.processedCountIncrement;

    const inst = store.db.instruments.find((i) => i.code === update.instrumentCode);
    const st = this.states.get(update.instrumentCode);
    if (!inst || !st) return;

    const q = update.primaryQuote;
    if (!q) {
      st.lastPrice = null;
      st.bidPrice = null;
      st.askPrice = null;
      st.dataClassification = "UNAVAILABLE";
    } else {
      const prec = inst.pricePrecision;
      st.lastPrice = roundPrice(q.price, prec);
      if (q.prevClose !== null) st.prevClose = roundPrice(q.prevClose, prec);
      if (q.openPrice !== null) st.anchorOpen = roundPrice(q.openPrice, prec);
      if (q.highPrice !== null) st.highPrice = roundPrice(q.highPrice, prec);
      if (q.lowPrice !== null) st.lowPrice = roundPrice(q.lowPrice, prec);
      st.bidPrice = q.bid !== null ? roundPrice(q.bid, prec) : null;
      st.askPrice = q.ask !== null ? roundPrice(q.ask, prec) : null;
      if (q.volume !== null) st.volume = q.volume;

      st.sourceName = q.providerName;
      st.sourceUrl = q.sourceUrl;
      st.sourceTimestamp = q.sourceTimestamp;
      st.dataClassification = q.dataClassification;
      st.licenseStatus = q.licenseStatus;
      st.fetchLatencyMs = q.fetchLatencyMs;
      st.dataAgeSeconds = q.dataAgeSeconds;

      if (q.fetchLatencyMs > 0) {
        this.latencyMs = q.fetchLatencyMs;
        this.latencySamples.push(q.fetchLatencyMs);
        if (this.latencySamples.length > 120) this.latencySamples.shift();
      }
      this.activeProviderId = q.providerId;
    }

    // Apply real K-lines
    for (const [tf, bars] of Object.entries(update.klinesByTimeframe)) {
      if (Array.isArray(bars) && bars.length > 0) {
        st.klines[tf as Timeframe] = bars;
        if (tf === "1m") {
          st.klines.tick = bars.slice(-120);
          if (st.sourceTimestamp) {
            const latestDay = st.sourceTimestamp.slice(0, 10);
            const dayBars = bars.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === latestDay);
            if (dayBars.length > 0) {
              if (st.anchorOpen === null) st.anchorOpen = dayBars[0].open;
              if (st.highPrice === null) st.highPrice = Math.max(...dayBars.map((b) => b.high));
              if (st.lowPrice === null) st.lowPrice = Math.min(...dayBars.map((b) => b.low));
            }
          }
        }
      }
    }

    const nowMs = Date.now();
    this.lastTickMs = nowMs;
    this.lastTickAt = new Date(nowMs).toISOString();
    this.recomputeHealthStatus();
    this.broadcastQuotes();
  }

  private computeFeedState(): { feedState: QuoteDataClassification; liveVerified: boolean; status: FeedHealthStatus } {
    if (this.mode === "DEV_TEST_SIM") {
      if (this.healthStatus === "DISCONNECTED") {
        return { feedState: "UNAVAILABLE", liveVerified: false, status: "DISCONNECTED" };
      }
      if ((Date.now() - this.lastTickMs) / 1000 > store.db.matchingRules.maxFeedStaleSeconds) {
        return { feedState: "DELAYED", liveVerified: false, status: "STALE" };
      }
      return { feedState: "SIMULATION", liveVerified: false, status: this.healthStatus };
    }

    const wtiCol = this.collectors.get("WTI");
    const brentCol = this.collectors.get("BRENT");
    const wti = this.states.get("WTI");
    const brent = this.states.get("BRENT");

    const anyRunning = Array.from(this.collectors.values()).some((c) => c.status.collectorState === "RUNNING");
    if (!anyRunning) {
      return { feedState: "UNAVAILABLE", liveVerified: false, status: "DISCONNECTED" };
    }

    if (!wti || wti.lastPrice === null || !brent || brent.lastPrice === null) {
      return { feedState: "UNAVAILABLE", liveVerified: false, status: "DISCONNECTED" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const wtiAge = wti.sourceTimestamp ? Math.max(0, nowSec - Math.floor(Date.parse(wti.sourceTimestamp) / 1000)) : wti.dataAgeSeconds;
    const brentAge = brent.sourceTimestamp ? Math.max(0, nowSec - Math.floor(Date.parse(brent.sourceTimestamp) / 1000)) : brent.dataAgeSeconds;
    wti.dataAgeSeconds = wtiAge;
    brent.dataAgeSeconds = brentAge;

    const maxAge = Math.max(wtiAge, brentAge);
    const maxStale = store.db.matchingRules.maxFeedStaleSeconds;

    if (wti.dataClassification === "HISTORICAL" || brent.dataClassification === "HISTORICAL" || maxAge > 300) {
      return { feedState: "HISTORICAL", liveVerified: false, status: "STALE" };
    }

    if (wti.dataClassification === "DELAYED" || brent.dataClassification === "DELAYED" || maxAge > maxStale) {
      return { feedState: "DELAYED", liveVerified: false, status: "STALE" };
    }

    if (wti.dataClassification === "LIVE" && brent.dataClassification === "LIVE" && wtiCol?.status.connectionStatus === "CONNECTED" && brentCol?.status.connectionStatus === "CONNECTED") {
      return { feedState: "LIVE", liveVerified: true, status: "CONNECTED" };
    }

    return { feedState: "UNAVAILABLE", liveVerified: false, status: "DISCONNECTED" };
  }

  private recomputeHealthStatus(): void {
    const computed = this.computeFeedState();
    this.healthStatus = computed.status;
  }

  public start(): void {
    if (this.mode === "PRODUCTION_REAL") {
      this.startCollector();
      void this.probeAllProviders();
    } else if (!this.simIntervalId) {
      this.simIntervalId = setInterval(() => this.stepTick(), 1200);
    }
  }

  public async probeAllProviders(): Promise<MarketDataSource[]> {
    await Promise.allSettled([this.yahooProvider.connect(), this.sinaProvider.connect()]);
    return this.getDataSources();
  }

  public stop(): void {
    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }
    this.stopCollector();
  }

  public startCollector(instrument?: InstrumentCode): SmartSyncEngineState {
    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }
    if (this.mode !== "PRODUCTION_REAL") {
      this.mode = "PRODUCTION_REAL";
      this.initializeEmptyRealStates();
    }
    if (!this.startedAtIso) {
      this.startedAtIso = new Date().toISOString();
    }

    if (instrument) {
      const target = this.collectors.get(instrument);
      if (target) {
        target.start();
      }
    } else {
      for (const col of this.collectors.values()) {
        col.start();
      }
    }

    this.recomputeHealthStatus();
    return this.getSmartSyncEngineState();
  }

  public stopCollector(instrument?: InstrumentCode): SmartSyncEngineState {
    if (instrument) {
      const col = this.collectors.get(instrument);
      if (col) {
        col.stop("管理员手动停止单品种采集");
      }
      const st = this.states.get(instrument);
      if (st && this.mode === "PRODUCTION_REAL") {
        st.lastPrice = null;
        st.bidPrice = null;
        st.askPrice = null;
        st.dataClassification = "UNAVAILABLE";
      }
    } else {
      for (const col of this.collectors.values()) {
        col.stop("管理员手动停止全局行情同步");
      }
      if (this.mode === "PRODUCTION_REAL") {
        for (const st of this.states.values()) {
          st.lastPrice = null;
          st.bidPrice = null;
          st.askPrice = null;
          st.dataClassification = "UNAVAILABLE";
        }
      }
    }

    this.recomputeHealthStatus();
    this.broadcastQuotes();
    return this.getSmartSyncEngineState();
  }

  public async reconnectCollector(instrument?: InstrumentCode): Promise<SmartSyncEngineState> {
    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }
    if (this.mode !== "PRODUCTION_REAL") {
      this.mode = "PRODUCTION_REAL";
      this.initializeEmptyRealStates();
    }
    if (!this.startedAtIso) {
      this.startedAtIso = new Date().toISOString();
    }

    if (instrument) {
      const col = this.collectors.get(instrument);
      if (col) {
        await col.reconnect();
      }
    } else {
      // Reconnect WTI and BRENT immediately, then others staggered
      const order: InstrumentCode[] = ["WTI", "BRENT", "GOLD", "SILVER", "NG"];
      for (const code of order) {
        const col = this.collectors.get(code);
        if (col) {
          await col.reconnect();
        }
      }
    }

    this.recomputeHealthStatus();
    this.broadcastQuotes();
    return this.getSmartSyncEngineState();
  }

  private broadcastQuotes(): void {
    const quotes = this.getQuotes();
    for (const listener of this.listeners) {
      try {
        listener(quotes);
      } catch (err) {
        console.error("[MarketEngine] Tick listener error:", err);
      }
    }
  }

  public onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getDataSources(): MarketDataSource[] {
    const yahooHealth = this.yahooProvider.healthCheck();
    const sinaHealth = this.sinaProvider.healthCheck();
    const wtiCol = this.collectors.get("WTI")?.status;
    const brentCol = this.collectors.get("BRENT")?.status;
    const computed = this.computeFeedState();

    return this.dataSources.map((src) => {
      if (src.id === "src-yahoo-public") {
        const activeUse =
          this.mode === "PRODUCTION_REAL" &&
          (wtiCol?.activeProviderId === "src-yahoo-public" || brentCol?.activeProviderId === "src-yahoo-public");
        const realStatus: FeedHealthStatus =
          this.mode !== "PRODUCTION_REAL" ||
          (wtiCol?.collectorState === "STOPPED" && brentCol?.collectorState === "STOPPED")
            ? "DISCONNECTED"
            : !yahooHealth.connected
            ? "DISCONNECTED"
            : computed.feedState === "LIVE"
            ? "CONNECTED"
            : "STALE";
        return {
          ...src,
          status: realStatus,
          latencyMs: yahooHealth.connected ? yahooHealth.latencyMs : 0,
          lastError: yahooHealth.lastError,
          lastHeartbeatAt: yahooHealth.checkedAt,
          isActive: activeUse,
        };
      }
      if (src.id === "src-sina-public") {
        const activeUse =
          this.mode === "PRODUCTION_REAL" &&
          (wtiCol?.activeProviderId === "src-sina-public" || brentCol?.activeProviderId === "src-sina-public");
        const realStatus: FeedHealthStatus =
          this.mode !== "PRODUCTION_REAL"
            ? "DISCONNECTED"
            : !sinaHealth.connected
            ? "DISCONNECTED"
            : activeUse && computed.feedState !== "LIVE"
            ? "STALE"
            : sinaHealth.status;
        return {
          ...src,
          status: realStatus,
          latencyMs: sinaHealth.connected ? sinaHealth.latencyMs : 0,
          lastError: sinaHealth.lastError,
          lastHeartbeatAt: sinaHealth.checkedAt,
          isActive: activeUse,
        };
      }
      if (src.id === "src-benchmark") {
        return {
          ...src,
          status: this.mode === "DEV_TEST_SIM" ? this.healthStatus : "DISCONNECTED",
          latencyMs: this.mode === "DEV_TEST_SIM" ? 12 : 0,
          lastError: null,
          isActive: this.mode === "DEV_TEST_SIM",
        };
      }
      return {
        ...src,
        status: "DISCONNECTED",
        latencyMs: 0,
        lastError: src.licenseStatus === "PENDING_KEY" ? "尚未配置商业 API 密钥" : null,
        isActive: false,
      };
    });
  }

  public getContractQuotes(): ContractQuoteSnapshot[] {
    if (this.mode === "DEV_TEST_SIM") {
      return [];
    }
    const items = Object.values(marketHistoryStore.db.contractQuotes);
    return items.sort((a, b) => {
      if (a.instrumentCode !== b.instrumentCode) {
        return a.instrumentCode.localeCompare(b.instrumentCode);
      }
      if (a.isContinuous !== b.isContinuous) return a.isContinuous ? -1 : 1;
      return a.contractCode.localeCompare(b.contractCode);
    });
  }

  public getLicenseChecklist(): CommercialLicenseItem[] {
    return this.licenseChecklist;
  }

  public toggleLicenseChecklistItem(id: string): CommercialLicenseItem[] {
    const item = this.licenseChecklist.find((i) => i.id === id);
    if (item) {
      item.verified = !item.verified;
      item.verifiedAt = item.verified ? new Date().toISOString() : null;
    }
    return this.licenseChecklist;
  }

  public getContracts(): FuturesContract[] {
    return this.contracts;
  }

  public getMarketHistory(instrument: InstrumentCode = "WTI", timeframe: Timeframe = "1m") {
    return marketHistoryStore.getHistoryRecords(instrument, timeframe);
  }

  public getDataLogs(): MarketDataLog[] {
    return marketHistoryStore.db.logs.slice(0, 80);
  }

  public switchActiveProvider(providerId: string): MarketDataSource {
    const target = this.dataSources.find((s) => s.id === providerId);
    if (!target) {
      throw new Error("未找到指定行情供应商通道");
    }

    if (target.id === "src-databento" || target.id === "src-barchart" || target.id === "src-dxfeed") {
      if (target.licenseStatus === "PENDING_KEY") {
        throw new Error(`${target.name} 未配置商业 API 密钥，无法启用；请使用 Node.js 公开采集通道`);
      }
    }

    if (target.id === "src-benchmark") {
      const isProd = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
      if (isProd) {
        throw new Error("安全合规拦截：生产环境 (NODE_ENV=production) 严禁切换至 DEV_TEST_SIM 仿真行情模式");
      }
      this.stopCollector();
      this.mode = "DEV_TEST_SIM";
      this.activeProviderId = target.id;
      this.initializeSimulationBenchmarks();
      this.healthStatus = "CONNECTED";
      this.lastTickMs = Date.now();
      this.lastTickAt = new Date().toISOString();
      if (!this.simIntervalId) {
        this.simIntervalId = setInterval(() => this.stepTick(), 1200);
      }
      this.pushCollectorEvent({
        timestamp: new Date().toISOString(),
        level: "WARN",
        eventType: "MODE_SWITCH",
        instrumentCode: "SYSTEM",
        message: "管理员显式切换至 DEV_TEST_SIM 开发测试仿真模式（仅限离线界面调试，不写入真实历史库）",
      });
      this.broadcastQuotes();
      return this.getDataSources().find((s) => s.id === target.id)!;
    }

    if (target.id === "src-yahoo-public" || target.id === "src-sina-public") {
      this.mode = "PRODUCTION_REAL";
      if (this.simIntervalId) {
        clearInterval(this.simIntervalId);
        this.simIntervalId = null;
      }

      // Compatibility check is enforced inside collector.switchToProvider()
      let switchedAny = false;
      for (const col of this.collectors.values()) {
        try {
          if (col.switchToProvider(target.id)) {
            switchedAny = true;
          }
        } catch (err: any) {
          this.pushCollectorEvent({
            timestamp: new Date().toISOString(),
            level: "WARN",
            eventType: "COMPAT_SKIP",
            instrumentCode: col.instrumentCode,
            message: `${col.instrumentCode} 跳过切换 ${target.id}: ${err?.message || err}`,
          });
        }
      }
      if (!switchedAny) {
        throw new Error(`数据源 ${target.name} 未通过品种与合约兼容性校验`);
      }

      this.activeProviderId = target.id;
      this.startCollector();
      return this.getDataSources().find((s) => s.id === target.id)!;
    }

    throw new Error(`${target.name} 暂未接入真实运行驱动`);
  }

  public ingestExternalTick(tick: NormalizedTick): MarketDataLog {
    const receivedAt = new Date().toISOString();
    const dedupKey = `${tick.providerId}:${tick.contractCode}:${tick.sourceTimestamp}`;
    const state = this.states.get(tick.instrumentCode);

    if (this.recentDedupKeys.has(dedupKey)) {
      this.deduplicatedCount += 1;
      const log: MarketDataLog = {
        id: `mlog-${crypto.randomUUID().slice(0, 8)}`,
        providerId: tick.providerId,
        instrumentCode: tick.instrumentCode,
        contractCode: tick.contractCode,
        price: tick.price,
        bid: tick.bid,
        ask: tick.ask,
        volume: tick.volume,
        sourceTimestamp: tick.sourceTimestamp,
        receivedAt,
        processedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "DEDUP_DROPPED",
        note: "重复事件去重拦截 (Same sourceTimestamp)",
      };
      marketHistoryStore.appendLog(log);
      return log;
    }

    if (state && state.lastPrice !== null && Math.abs(tick.price - state.lastPrice) / state.lastPrice > 0.035) {
      this.anomalyRejectedCount += 1;
      const log: MarketDataLog = {
        id: `mlog-${crypto.randomUUID().slice(0, 8)}`,
        providerId: tick.providerId,
        instrumentCode: tick.instrumentCode,
        contractCode: tick.contractCode,
        price: tick.price,
        bid: tick.bid,
        ask: tick.ask,
        volume: tick.volume,
        sourceTimestamp: tick.sourceTimestamp,
        receivedAt,
        processedAt: new Date().toISOString(),
        latencyMs: 12,
        status: "ANOMALY_REJECTED",
        note: `异常毛刺价格过滤：跳变超过 3.5% (参考价 ${state.lastPrice}, 异常价 ${tick.price})`,
      };
      marketHistoryStore.appendLog(log);
      return log;
    }

    this.recentDedupKeys.add(dedupKey);
    if (this.recentDedupKeys.size > 400) {
      const first = this.recentDedupKeys.values().next().value;
      if (first) this.recentDedupKeys.delete(first);
    }

    const latencyMs = Math.max(4, Date.now() - new Date(tick.sourceTimestamp).getTime());
    this.totalTicksProcessed += 1;

    const log: MarketDataLog = {
      id: `mlog-${crypto.randomUUID().slice(0, 8)}`,
      providerId: tick.providerId,
      instrumentCode: tick.instrumentCode,
      contractCode: tick.contractCode,
      price: tick.price,
      bid: tick.bid,
      ask: tick.ask,
      volume: tick.volume,
      sourceTimestamp: tick.sourceTimestamp,
      receivedAt,
      processedAt: new Date().toISOString(),
      latencyMs: Math.min(latencyMs, 999),
      status: "ACCEPTED",
      note: "校验测试事件 (未污染真实行情序列)",
    };
    marketHistoryStore.appendLog(log);
    return log;
  }

  public setFeedStatus(status: FeedHealthStatus): void {
    this.healthStatus = status;
    if (this.mode === "PRODUCTION_REAL") {
      if (status === "DISCONNECTED") {
        this.stopCollector();
        return;
      }
      if (status === "CONNECTED") {
        this.startCollector();
        return;
      }
      if (status === "STALE") {
        for (const st of this.states.values()) {
          if (st.lastPrice !== null) {
            st.dataClassification = "HISTORICAL";
            st.dataAgeSeconds = Math.max(st.dataAgeSeconds, store.db.matchingRules.maxFeedStaleSeconds + 60);
          }
        }
        this.pushCollectorEvent({
          timestamp: new Date().toISOString(),
          level: "WARN",
          eventType: "STALE_MARK",
          instrumentCode: "SYSTEM",
          message: "管理员手动标记当前行情为 STALE 过期状态，模拟撮合已拦截新单",
        });
        this.broadcastQuotes();
        return;
      }
    }

    if (status === "CONNECTED") {
      this.lastTickMs = Date.now();
      this.lastTickAt = new Date().toISOString();
    }
    this.broadcastQuotes();
  }

  private computeLatencyBreakdown(activeSrc: MarketDataSource): LatencyBreakdown {
    const samples = this.latencySamples.length > 0 ? this.latencySamples : [this.latencyMs || 0];
    const sorted = [...samples].sort((a, b) => a - b);
    const p = (pct: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] ?? this.latencyMs;
    const base = activeSrc.latencyMs || this.latencyMs || 0;
    const seg1 = Math.round(base * 0.42);
    const seg2 = Math.round(base * 0.34);
    const seg3 = base > 0 ? Math.max(2, Math.round(base * 0.12)) : 0;
    const seg4 = base > 0 ? Math.max(2, base - seg1 - seg2 - seg3) : 0;
    return {
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      p99Ms: p(0.99),
      seg1ExchangeToVendorMs: seg1,
      seg2VendorToIngestMs: seg2,
      seg3NormalizeCacheMs: seg3,
      seg4WsPushMs: seg4,
      slaTargetMs: 1000,
    };
  }

  public getSmartSyncEngineState(): SmartSyncEngineState {
    const instruments: Record<string, InstrumentCollectorStatus> = {};
    let totalAttempts = 0;
    let totalSuccess = 0;
    let totalFailures = 0;
    let reconnectCount = 0;
    let failoverCount = 0;
    let anyRunning = false;
    let anyReconnecting = false;
    let lastError: string | null = null;
    let activeEndpoint: string | null = null;
    let anyAuthorized = false;

    for (const [code, col] of this.collectors.entries()) {
      const s = { ...col.status };
      instruments[code] = s;
      totalAttempts += s.totalAttempts;
      totalSuccess += s.successCount;
      totalFailures += s.failureCount;
      reconnectCount += s.reconnectCount;
      failoverCount += s.failoverCount;
      if (s.collectorState === "RUNNING") anyRunning = true;
      if (s.collectorState === "RECONNECTING") anyReconnecting = true;
      if (!lastError && s.lastError) lastError = s.lastError;
      if (!activeEndpoint && s.sourceUrl) activeEndpoint = s.sourceUrl;
      if (s.redistributionAllowed) anyAuthorized = true;
    }

    const computed = this.computeFeedState();
    const wti = instruments["WTI"];
    const brent = instruments["BRENT"];
    const maxStale = store.db.matchingRules.maxFeedStaleSeconds;
    const authorizedMemberChannelReady =
      this.mode === "PRODUCTION_REAL" &&
      computed.liveVerified &&
      Boolean(wti?.redistributionAllowed && brent?.redistributionAllowed) &&
      wti?.lastPrice !== null &&
      brent?.lastPrice !== null &&
      wti.dataAgeSeconds <= maxStale &&
      brent.dataAgeSeconds <= maxStale;

    const stats = marketHistoryStore.getStats();
    const overallSuccessRatePct = totalAttempts > 0 ? Number(((totalSuccess / totalAttempts) * 100).toFixed(2)) : 0;

    return {
      engineState: anyReconnecting ? "RECONNECTING" : anyRunning ? "RUNNING" : "STOPPED",
      feedState: computed.feedState,
      liveVerified: computed.liveVerified,
      startedAt: this.startedAtIso,
      lastSyncAt: this.lastTickMs > 0 ? this.lastTickAt : null,
      activeEndpoint,
      licenseStatus:
        this.mode === "DEV_TEST_SIM"
          ? "SIMULATION_BENCHMARK"
          : anyAuthorized
          ? "COMMERCIAL_AUTHORIZED"
          : "NON_COMMERCIAL_PUBLIC",
      redistributionAllowed: anyAuthorized,
      authorizedMemberChannelReady,
      overallSuccessRatePct,
      totalAttempts,
      totalSuccess,
      totalFailures,
      reconnectCount,
      failoverCount,
      ...stats,
      lastError,
      instruments,
      events: this.collectorEvents.slice(0, 50),
    };
  }

  public getHealth(wsConnectedClients: number, persistencePath: string): MarketEngineHealth {
    const sources = this.getDataSources();
    const activeSrc = sources.find((s) => s.id === this.activeProviderId) ?? sources[0];
    const computed = this.computeFeedState();
    this.healthStatus = computed.status;

    return {
      mode: this.mode,
      status: computed.status,
      feedState: computed.feedState,
      liveVerified: computed.liveVerified,
      activeProviderId: activeSrc.id,
      source: activeSrc.name,
      lastTickAt: this.lastTickAt,
      latencyMs: computed.status === "CONNECTED" || computed.status === "STALE" ? this.latencyMs : 0,
      latencyStats: this.computeLatencyBreakdown(activeSrc),
      wsConnectedClients,
      persistencePath,
      uptimeSeconds: Math.floor((Date.now() - this.startTimeMs) / 1000),
      deduplicatedCount: this.deduplicatedCount,
      anomalyRejectedCount: this.anomalyRejectedCount,
      totalTicksProcessed: this.totalTicksProcessed,
      collector: this.getSmartSyncEngineState(),
    };
  }

  public isFeedTradable(): { ok: boolean; reason?: string } {
    const health = this.getHealth(0, "");

    if (this.mode === "PRODUCTION_REAL") {
      const wtiCol = this.collectors.get("WTI")?.status;
      const brentCol = this.collectors.get("BRENT")?.status;

      if (wtiCol?.collectorState !== "RUNNING" && brentCol?.collectorState !== "RUNNING") {
        return { ok: false, reason: "行情采集已停止" };
      }

      const wti = this.states.get("WTI");
      const brent = this.states.get("BRENT");
      if (!wti || wti.lastPrice === null || !brent || brent.lastPrice === null) {
        return { ok: false, reason: "暂无有效报价" };
      }

      if (!wtiCol?.redistributionAllowed || !brentCol?.redistributionAllowed) {
        return {
          ok: false,
          reason: "当前数据源未开放会员通道，请在测试环境切换 DEV_TEST_SIM 或接入商业密钥",
        };
      }

      if (
        !health.liveVerified ||
        health.feedState !== "LIVE" ||
        (store.db.matchingRules.pauseOnFeedDisconnect &&
          (wti.dataAgeSeconds > store.db.matchingRules.maxFeedStaleSeconds ||
            brent.dataAgeSeconds > store.db.matchingRules.maxFeedStaleSeconds ||
            health.status !== "CONNECTED"))
      ) {
        return {
          ok: false,
          reason: `行情未通过实时核验 (${health.feedState} · 距今 ${Math.max(wti.dataAgeSeconds, brent.dataAgeSeconds)}s > ${store.db.matchingRules.maxFeedStaleSeconds}s)`,
        };
      }
      return { ok: true };
    }

    if (!store.db.matchingRules.pauseOnFeedDisconnect) return { ok: true };
    if (health.status === "DISCONNECTED") {
      return { ok: false, reason: "行情源已断开，交易已暂停" };
    }
    if (health.status === "STALE") {
      return { ok: false, reason: `行情数据过期 (STALE > ${store.db.matchingRules.maxFeedStaleSeconds}s)，交易已暂停` };
    }
    return { ok: true };
  }

  public getSmartDirectives(): SmartControlDirective[] {
    const directives: SmartControlDirective[] = [];
    const syncState = this.getSmartSyncEngineState();
    const feed = this.isFeedTradable();

    if (!feed.ok) {
      directives.push({
        id: "dir-feed-guard",
        severity: "HIGH",
        category: "MARKET_FEED",
        title: "行情通道待接入或非实时状态",
        reason: feed.reason || "当前不可向会员开放交易",
        impact: "等待实时商业数据源接入或重连刷新",
        actionLabel: "重连刷新真实行情",
        actionType: "RESUME_FEED",
      });
    }

    const riskyAccounts = store.db.accounts.filter((a) => a.usedMargin > 0 && a.riskRatio < 180);
    if (riskyAccounts.length > 0) {
      directives.push({
        id: "dir-risk-acc",
        severity: "HIGH",
        category: "RISK",
        title: `检测到 ${riskyAccounts.length} 个模拟账户风险率低于 180%`,
        reason: `账户 ${riskyAccounts.map((a) => a.accountNo).join("、")} 保证金占用偏高`,
        impact: "若原油短期波动放大超过 2.5%，将触发模拟强制平仓",
        actionLabel: "上调 WTI 保证金至 6%",
        actionType: "RAISE_WTI_MARGIN",
      });
    }

    if (directives.length === 0) {
      directives.push({
        id: "dir-nominal",
        severity: "INFO",
        category: "TENANT_OPS",
        title: "智能国际原油行情同步中心运行平稳",
        reason: `采集成功率 ${syncState.overallSuccessRatePct}% · 已落库 K线 ${syncState.persistedKlinesCount} 条`,
        impact: "WTI 与 Brent 独立采集器及 WebSocket 通道正常",
        actionLabel: "确认断线熔断规则开启",
        actionType: "ENABLE_CIRCUIT_BREAKER",
      });
    }

    return directives;
  }

  private stepTick(): void {
    // Only runs when admin explicitly switches to DEV_TEST_SIM mode
    if (this.mode !== "DEV_TEST_SIM" || this.healthStatus !== "CONNECTED") {
      return;
    }

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const receivedAt = new Date(nowMs).toISOString();
    this.lastTickMs = nowMs;
    this.lastTickAt = receivedAt;
    this.latencyMs = 15;

    for (const inst of store.db.instruments) {
      const state = this.states.get(inst.code);
      if (!state || state.lastPrice === null || state.prevClose === null) continue;

      const reversion = ((state.prevClose - state.lastPrice) / state.prevClose) * 0.015;
      const shock = (Math.random() - 0.5) * 2 * (state.volatility * 0.25);
      const rawNext = state.lastPrice * (1 + reversion + shock);
      const stepped = Math.round(rawNext / inst.tickSize) * inst.tickSize;
      const nextPrice = roundPrice(Math.max(inst.tickSize * 10, stepped), inst.pricePrecision);

      state.lastPrice = nextPrice;
      state.bidPrice = roundPrice(nextPrice - inst.tickSize, inst.pricePrecision);
      state.askPrice = roundPrice(nextPrice + inst.tickSize, inst.pricePrecision);
      if (state.highPrice === null || nextPrice > state.highPrice) state.highPrice = nextPrice;
      if (state.lowPrice === null || nextPrice < state.lowPrice) state.lowPrice = nextPrice;
      state.volume = (state.volume ?? 0) + 12;
      state.sourceTimestamp = receivedAt;
      state.dataAgeSeconds = 0;

      (Object.keys(TIMEFRAME_SECONDS) as Timeframe[]).forEach((tf) => {
        const stepSec = TIMEFRAME_SECONDS[tf];
        const bucketTime = Math.floor(nowSec / stepSec) * stepSec;
        const arr = state.klines[tf];
        const last = arr[arr.length - 1];
        if (last && last.time === bucketTime) {
          last.close = nextPrice;
          if (nextPrice > last.high) last.high = nextPrice;
          if (nextPrice < last.low) last.low = nextPrice;
          last.volume += 12;
        } else {
          arr.push({
            time: bucketTime,
            open: last ? last.close : nextPrice,
            high: nextPrice,
            low: nextPrice,
            close: nextPrice,
            volume: 12,
          });
          if (arr.length > 260) arr.shift();
        }
      });
    }

    this.broadcastQuotes();
  }

  public getQuotes(): MarketQuote[] {
    return store.db.instruments.map((inst) => {
      const state = this.states.get(inst.code);
      if (!state || state.lastPrice === null) {
        return {
          instrumentCode: inst.code,
          contractCode: inst.activeContract,
          marketSymbol: inst.marketSymbol,
          lastPrice: null,
          bidPrice: null,
          askPrice: null,
          openPrice: null,
          highPrice: null,
          lowPrice: null,
          prevClose: null,
          change: 0,
          changePct: 0,
          volume: null,
          sourceName: state?.sourceName || this.yahooProvider.name,
          sourceUrl: state?.sourceUrl ?? "",
          sourceTimestamp: null,
          dataClassification: "UNAVAILABLE",
          licenseStatus: state?.licenseStatus ?? "NON_COMMERCIAL_PUBLIC",
          latencyMs: 0,
          dataAgeSeconds: 0,
          updatedAt: this.lastTickAt,
        };
      }

      const change =
        state.prevClose !== null ? roundPrice(state.lastPrice - state.prevClose, inst.pricePrecision) : 0;
      const changePct =
        state.prevClose && state.prevClose > 0 ? Math.round((change / state.prevClose) * 10000) / 100 : 0;

      return {
        instrumentCode: inst.code,
        contractCode: inst.activeContract,
        marketSymbol: inst.marketSymbol,
        lastPrice: state.lastPrice,
        bidPrice: state.bidPrice,
        askPrice: state.askPrice,
        openPrice: state.anchorOpen,
        highPrice: state.highPrice,
        lowPrice: state.lowPrice,
        prevClose: state.prevClose,
        change,
        changePct,
        volume: state.volume,
        sourceName: state.sourceName,
        sourceUrl: state.sourceUrl,
        sourceTimestamp: state.sourceTimestamp,
        dataClassification: state.dataClassification,
        licenseStatus: state.licenseStatus,
        latencyMs: state.fetchLatencyMs || this.latencyMs,
        dataAgeSeconds: state.dataAgeSeconds,
        updatedAt: this.lastTickAt,
      };
    });
  }

  public getQuote(code: InstrumentCode): MarketQuote | undefined {
    return this.getQuotes().find((q) => q.instrumentCode === code);
  }

  public getKlines(code: InstrumentCode, timeframe: Timeframe): MarketKline[] {
    const state = this.states.get(code);
    if (!state) return [];
    const memBars = state.klines[timeframe] ?? state.klines["1m"] ?? [];
    if (memBars.length > 0 || this.mode === "DEV_TEST_SIM") {
      return memBars;
    }
    return marketHistoryStore.db.klines[code]?.[timeframe] ?? [];
  }
}

export const marketEngine = new MarketEngine();
