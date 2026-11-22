import fs from "fs";
import path from "path";
import type {
  CollectorEventEntry,
  ContractQuoteSnapshot,
  InstrumentCode,
  MarketDataLog,
  MarketKline,
  Timeframe,
} from "../../types";
import type { StandardizedQuoteRecord } from "./contracts";

export interface RawSnapshotRecord {
  contractCode: string;
  instrumentCode: InstrumentCode;
  providerId: string;
  providerName?: string;
  sourceUrl: string;
  sourceTimestamp: string;
  receivedAt: string;
  rawSummary: Record<string, unknown>;
}

export interface PersistedMarketHistoryDatabase {
  updatedAt: string;
  rawSnapshots: Record<string, RawSnapshotRecord>;
  rawHistory: RawSnapshotRecord[];
  standardizedQuotes: Record<string, StandardizedQuoteRecord>;
  quoteHistory: StandardizedQuoteRecord[];
  contractQuotes: Record<string, ContractQuoteSnapshot>;
  klines: Partial<Record<InstrumentCode, Partial<Record<Timeframe, MarketKline[]>>>>;
  logs: MarketDataLog[];
  errorLogs: CollectorEventEntry[];
}

const DATA_DIR = path.join(process.cwd(), "data");
export const MARKET_HISTORY_FILE = path.join(DATA_DIR, "market-history-store.json");

function createEmptyDb(): PersistedMarketHistoryDatabase {
  return {
    updatedAt: new Date().toISOString(),
    rawSnapshots: {},
    rawHistory: [],
    standardizedQuotes: {},
    quoteHistory: [],
    contractQuotes: {},
    klines: {},
    logs: [],
    errorLogs: [],
  };
}

/**
 * Dedicated Node.js persistence store aligned with data/platform-store.json architecture.
 * Persists raw snapshots, standardized quotes, rolling history records, multi-timeframe K-lines,
 * ingestion logs, and fault logs to data/market-history-store.json using atomic write-rename.
 */
class MarketHistoryStore {
  public db: PersistedMarketHistoryDatabase;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.db = this.load();
  }

  private load(): PersistedMarketHistoryDatabase {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(MARKET_HISTORY_FILE)) {
        const empty = createEmptyDb();
        fs.writeFileSync(MARKET_HISTORY_FILE, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
      }
      const raw = fs.readFileSync(MARKET_HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedMarketHistoryDatabase>;
      return {
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        rawSnapshots: parsed.rawSnapshots || {},
        rawHistory: Array.isArray(parsed.rawHistory) ? parsed.rawHistory.slice(0, 120) : [],
        standardizedQuotes: parsed.standardizedQuotes || {},
        quoteHistory: Array.isArray(parsed.quoteHistory) ? parsed.quoteHistory.slice(0, 200) : [],
        contractQuotes: parsed.contractQuotes || {},
        klines: parsed.klines || {},
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, 300) : [],
        errorLogs: Array.isArray(parsed.errorLogs) ? parsed.errorLogs.slice(0, 150) : [],
      };
    } catch {
      return createEmptyDb();
    }
  }

  public schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 300);
  }

  public persistNow(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      this.db.updatedAt = new Date().toISOString();
      const tmp = `${MARKET_HISTORY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), "utf-8");
      fs.renameSync(tmp, MARKET_HISTORY_FILE);
    } catch (err) {
      console.error("[MarketHistoryStore] Persist error:", err);
    }
  }

  public saveRawSnapshot(rec: RawSnapshotRecord, recordHistory = false): void {
    this.db.rawSnapshots[rec.contractCode] = rec;
    if (recordHistory) {
      this.db.rawHistory.unshift(rec);
      if (this.db.rawHistory.length > 120) {
        this.db.rawHistory.length = 120;
      }
    }
    this.schedulePersist();
  }

  public saveStandardizedQuote(q: StandardizedQuoteRecord, recordHistory = false): void {
    this.db.standardizedQuotes[q.contractCode] = q;
    this.db.contractQuotes[q.contractCode] = {
      instrumentCode: q.instrumentCode,
      contractCode: q.contractCode,
      vendorSymbol: q.vendorSymbol,
      isContinuous: q.isContinuous,
      price: q.price,
      prevClose: q.prevClose,
      sourceTimestamp: q.sourceTimestamp,
      receivedAt: q.receivedAt,
      dataClassification: q.dataClassification,
      qualityStatus: q.qualityStatus,
      sourceName: q.providerName,
      sourceUrl: q.sourceUrl,
      fetchLatencyMs: q.fetchLatencyMs,
    };
    if (recordHistory) {
      this.db.quoteHistory.unshift(q);
      if (this.db.quoteHistory.length > 200) {
        this.db.quoteHistory.length = 200;
      }
    }
    this.schedulePersist();
  }

  public saveKlines(code: InstrumentCode, timeframe: Timeframe, bars: MarketKline[]): void {
    if (!this.db.klines[code]) {
      this.db.klines[code] = {};
    }
    this.db.klines[code]![timeframe] = bars.slice(-260);
    this.schedulePersist();
  }

  public upsertRealtimeQuoteIntoKlines(code: InstrumentCode, quote: StandardizedQuoteRecord): void {
    const tfSteps: { tf: Timeframe; stepSec: number }[] = [
      { tf: "1m", stepSec: 60 },
      { tf: "5m", stepSec: 300 },
      { tf: "15m", stepSec: 900 },
      { tf: "1h", stepSec: 3600 },
      { tf: "1d", stepSec: 86400 },
    ];
    if (!this.db.klines[code]) {
      this.db.klines[code] = {};
    }
    for (const { tf, stepSec } of tfSteps) {
      const arr = this.db.klines[code]![tf] ?? [];
      const bucket = Math.floor(quote.sourceEpochSec / stepSec) * stepSec;
      const last = arr[arr.length - 1];
      if (!last || bucket > last.time) {
        arr.push({
          time: bucket,
          open: quote.price,
          high: quote.price,
          low: quote.price,
          close: quote.price,
          volume: 0,
        });
        if (arr.length > 260) arr.shift();
      } else if (last.time === bucket) {
        last.close = quote.price;
        if (quote.price > last.high) last.high = quote.price;
        if (quote.price < last.low) last.low = quote.price;
      }
      this.db.klines[code]![tf] = arr;
    }
    this.schedulePersist();
  }

  public appendLog(log: MarketDataLog): void {
    this.db.logs.unshift(log);
    if (this.db.logs.length > 300) {
      this.db.logs.length = 300;
    }
    this.schedulePersist();
  }

  public appendErrorLog(entry: CollectorEventEntry): void {
    this.db.errorLogs.unshift(entry);
    if (this.db.errorLogs.length > 150) {
      this.db.errorLogs.length = 150;
    }
    this.schedulePersist();
  }

  public getHistoryRecords(instrument: InstrumentCode = "WTI", timeframe: Timeframe = "1m") {
    const klines = (this.db.klines[instrument]?.[timeframe] ?? []).slice(-60).reverse();
    const quoteHistory = this.db.quoteHistory
      .filter((q) => q.instrumentCode === instrument)
      .slice(0, 50);
    const rawHistory = this.db.rawHistory
      .filter((r) => r.instrumentCode === instrument)
      .slice(0, 30);
    const errorLogs = this.db.errorLogs
      .filter((e) => e.instrumentCode === instrument || e.instrumentCode === "SYSTEM")
      .slice(0, 40);
    return {
      instrumentCode: instrument,
      timeframe,
      klines,
      quoteHistory,
      rawHistory,
      errorLogs,
      stats: this.getStats(),
    };
  }

  public getStats() {
    let klineCount = 0;
    for (const tfMap of Object.values(this.db.klines)) {
      if (!tfMap) continue;
      for (const arr of Object.values(tfMap)) {
        if (Array.isArray(arr)) klineCount += arr.length;
      }
    }
    return {
      persistencePath: MARKET_HISTORY_FILE,
      persistedRawSnapshotsCount: Object.keys(this.db.rawSnapshots).length,
      persistedQuotesCount: Object.keys(this.db.standardizedQuotes).length,
      persistedKlinesCount: klineCount,
      persistedLogsCount: this.db.logs.length,
      persistedErrorLogsCount: this.db.errorLogs.length,
    };
  }
}

export const marketHistoryStore = new MarketHistoryStore();
