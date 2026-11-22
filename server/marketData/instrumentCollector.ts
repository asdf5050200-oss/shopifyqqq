import crypto from "crypto";
import type {
  CollectorEventEntry,
  InstrumentCode,
  InstrumentCollectorStatus,
  MarketDataLog,
  MarketKline,
  Timeframe,
} from "../../types";
import {
  checkProviderCompatibility,
  type ContractCollectionSpec,
  type MarketDataProvider,
  type StandardizedQuoteRecord,
} from "./contracts";
import { marketHistoryStore } from "./marketStore";
import { aggregateKlines } from "./providers/yahooProvider";
import { MarketQualityValidator } from "./qualityValidator";

const HISTORY_SYNC_INTERVAL_MS = 60_000;
const KLINE_PLAN: { tf: Timeframe; range: string }[] = [
  { tf: "1m", range: "5d" },
  { tf: "5m", range: "5d" },
  { tf: "15m", range: "5d" },
  { tf: "1h", range: "1mo" },
  { tf: "1d", range: "6mo" },
];

export interface InstrumentCollectionUpdate {
  instrumentCode: InstrumentCode;
  primaryQuote: StandardizedQuoteRecord | null;
  klinesByTimeframe: Partial<Record<Timeframe, MarketKline[]>>;
  dedupCountIncrement: number;
  anomalyCountIncrement: number;
  processedCountIncrement: number;
}

export class InstrumentCollector {
  public readonly instrumentCode: InstrumentCode;
  private readonly primarySpec: ContractCollectionSpec;
  private readonly allSpecs: ContractCollectionSpec[];
  private readonly providers: MarketDataProvider[];
  private activeProviderIndex = 0;

  private readonly pollIntervalMs: number;
  private readonly initialDelayMs: number;
  private validator = new MarketQualityValidator();

  private timer: NodeJS.Timeout | null = null;
  private startDelayTimer: NodeJS.Timeout | null = null;
  private lastHistorySyncMs = 0;
  private isPolling = false;

  public status: InstrumentCollectorStatus;
  private latestPrimaryQuote: StandardizedQuoteRecord | null = null;
  private onUpdateCallback?: (update: InstrumentCollectionUpdate) => void;
  private onEventCallback?: (entry: CollectorEventEntry) => void;

  constructor(opts: {
    instrumentCode: InstrumentCode;
    specs: ContractCollectionSpec[];
    providers: MarketDataProvider[];
    pollIntervalMs: number;
    initialDelayMs?: number;
    onUpdate?: (update: InstrumentCollectionUpdate) => void;
    onEvent?: (entry: CollectorEventEntry) => void;
  }) {
    this.instrumentCode = opts.instrumentCode;
    this.allSpecs = opts.specs;
    this.primarySpec = opts.specs.find((s) => s.isContinuous) ?? opts.specs[0];
    this.providers = opts.providers;
    this.pollIntervalMs = opts.pollIntervalMs;
    this.initialDelayMs = opts.initialDelayMs ?? 0;
    this.onUpdateCallback = opts.onUpdate;
    this.onEventCallback = opts.onEvent;

    const firstProvider = this.providers[0];
    this.status = {
      instrumentCode: this.instrumentCode,
      primaryContract: this.primarySpec.contractCode,
      vendorSymbol: this.primarySpec.vendorSymbols[firstProvider.id] ?? "",
      collectorState: "STOPPED",
      connectionStatus: "DISCONNECTED",
      dataClassification: "UNAVAILABLE",
      qualityStatus: "UNAVAILABLE",
      activeProviderId: firstProvider.id,
      sourceName: firstProvider.name,
      sourceUrl: "",
      lastPrice: null,
      sourceTimestamp: null,
      receivedAt: null,
      processedAt: null,
      fetchLatencyMs: 0,
      dataAgeSeconds: 0,
      updateFrequencySec: Math.round(this.pollIntervalMs / 1000),
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      successRatePct: 0,
      consecutiveFailures: 0,
      reconnectCount: 0,
      failoverCount: 0,
      lastError: null,
      licenseStatus: firstProvider.licenseStatus,
      redistributionAllowed: firstProvider.redistributionAllowed,
    };
  }

  private get activeProvider(): MarketDataProvider {
    return this.providers[this.activeProviderIndex % this.providers.length];
  }

  private emitEvent(level: CollectorEventEntry["level"], eventType: string, message: string): void {
    const entry: CollectorEventEntry = {
      timestamp: new Date().toISOString(),
      level,
      eventType,
      instrumentCode: this.instrumentCode,
      message,
    };
    if (level !== "INFO") {
      marketHistoryStore.appendErrorLog(entry);
    }
    this.onEventCallback?.(entry);
  }

  public start(): void {
    if (this.status.collectorState === "RUNNING") return;
    this.status.collectorState = "RUNNING";
    this.status.lastError = null;
    this.emitEvent("INFO", "START", `${this.instrumentCode} 独立采集器启动 (轮询周期 ${this.status.updateFrequencySec}s)`);

    this.startDelayTimer = setTimeout(() => {
      this.startDelayTimer = null;
      if (this.status.collectorState !== "RUNNING") return;
      void this.pollOnce(true);
      this.timer = setInterval(() => {
        if (this.status.collectorState === "RUNNING") {
          void this.pollOnce(false);
        }
      }, this.pollIntervalMs);
    }, this.initialDelayMs);
  }

  public stop(reason = "管理员手动停止"): void {
    if (this.startDelayTimer) {
      clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.collectorState = "STOPPED";
    this.status.connectionStatus = "DISCONNECTED";
    this.status.dataClassification = "UNAVAILABLE";
    this.status.qualityStatus = "UNAVAILABLE";
    this.status.lastPrice = null;
    this.status.lastError = reason;
    this.latestPrimaryQuote = null;
    this.emitEvent("WARN", "STOP", `${this.instrumentCode} 采集器已停止: ${reason}`);

    this.onUpdateCallback?.({
      instrumentCode: this.instrumentCode,
      primaryQuote: null,
      klinesByTimeframe: {},
      dedupCountIncrement: 0,
      anomalyCountIncrement: 0,
      processedCountIncrement: 0,
    });
  }

  public async reconnect(): Promise<void> {
    this.status.collectorState = "RECONNECTING";
    this.status.reconnectCount += 1;
    this.emitEvent("WARN", "RECONNECT", `${this.instrumentCode} 触发断线重连...`);

    this.validator.clearCrossProviderAnchors();

    // Ensure provider reconnects cleanly
    const ok = await this.activeProvider.reconnect();
    if (!ok) {
      this.tryCompatibleFailover("重连主源失败");
    }

    this.status.collectorState = "RUNNING";
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.status.collectorState === "RUNNING") {
          void this.pollOnce(false);
        }
      }, this.pollIntervalMs);
    }
    await this.pollOnce(true);
  }

  private tryCompatibleFailover(reason: string): boolean {
    if (this.providers.length <= 1) return false;
    for (let offset = 1; offset < this.providers.length; offset++) {
      const candidateIdx = (this.activeProviderIndex + offset) % this.providers.length;
      const candidate = this.providers[candidateIdx];
      const compat = checkProviderCompatibility(candidate, this.primarySpec);
      if (!compat.ok) {
        this.emitEvent("WARN", "COMPAT_SKIP", `跳过不兼容备源 ${candidate.id}: ${compat.reason}`);
        continue;
      }
      this.activeProviderIndex = candidateIdx;
      this.validator.clearCrossProviderAnchors();
      this.status.failoverCount += 1;
      this.status.activeProviderId = candidate.id;
      this.status.sourceName = candidate.name;
      this.status.vendorSymbol = this.primarySpec.vendorSymbols[candidate.id] ?? "";
      this.status.licenseStatus = candidate.licenseStatus;
      this.status.redistributionAllowed = candidate.redistributionAllowed;
      this.emitEvent("WARN", "FAILOVER", `${this.instrumentCode} 触发兼容切换 (${reason}) → ${candidate.name}`);
      return true;
    }
    return false;
  }

  public switchToProvider(providerId: string): boolean {
    const idx = this.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) return false;
    const candidate = this.providers[idx];
    const compat = checkProviderCompatibility(candidate, this.primarySpec);
    if (!compat.ok) {
      throw new Error(compat.reason);
    }
    this.activeProviderIndex = idx;
    this.validator.clearCrossProviderAnchors();
    this.status.activeProviderId = candidate.id;
    this.status.sourceName = candidate.name;
    this.status.vendorSymbol = this.primarySpec.vendorSymbols[candidate.id] ?? "";
    this.status.licenseStatus = candidate.licenseStatus;
    this.status.redistributionAllowed = candidate.redistributionAllowed;
    if (this.status.collectorState === "RUNNING") {
      void this.pollOnce(false);
    }
    return true;
  }

  public async pollOnce(forceHistory = false): Promise<InstrumentCollectionUpdate> {
    if (this.isPolling) {
      return {
        instrumentCode: this.instrumentCode,
        primaryQuote: this.latestPrimaryQuote,
        klinesByTimeframe: {},
        dedupCountIncrement: 0,
        anomalyCountIncrement: 0,
        processedCountIncrement: 0,
      };
    }

    this.isPolling = true;
    let dedupInc = 0;
    let anomalyInc = 0;
    let processedInc = 0;
    const klinesByTimeframe: Partial<Record<Timeframe, MarketKline[]>> = {};

    try {
      const provider = this.activeProvider;
      const compatibleSpecs = this.allSpecs.filter((s) => Boolean(s.vendorSymbols[provider.id]));

      // Use batch endpoint when supported to minimize HTTP calls and rate limits
      const rawMap = provider.fetchBatchQuotes
        ? await provider.fetchBatchQuotes(compatibleSpecs)
        : new Map<string, Awaited<ReturnType<MarketDataProvider["fetchQuote"]>>>();

      if (!provider.fetchBatchQuotes) {
        for (const spec of compatibleSpecs) {
          const raw = await provider.fetchQuote(spec);
          rawMap.set(spec.contractCode, raw);
        }
      } else {
        // Also fetch full chart metadata for primary contract on history sync cycles so day high/low/vol stay accurate
        if (forceHistory || Date.now() - this.lastHistorySyncMs >= HISTORY_SYNC_INTERVAL_MS) {
          try {
            const fullRaw = await provider.fetchQuote(this.primarySpec);
            rawMap.set(this.primarySpec.contractCode, fullRaw);
          } catch {
            // Keep batch result if detailed chart endpoint temporarily throttles
          }
        }
      }

      for (const spec of compatibleSpecs) {
        const raw = rawMap.get(spec.contractCode);
        if (!raw) continue;

        const quote = provider.normalize(raw, spec);
        if (!quote) {
          marketHistoryStore.saveRawSnapshot(
            {
              contractCode: spec.contractCode,
              instrumentCode: spec.instrumentCode,
              providerId: provider.id,
              providerName: provider.name,
              sourceUrl: raw.sourceUrl,
              sourceTimestamp: raw.receivedAt,
              receivedAt: raw.receivedAt,
              rawSummary: { vendorSymbol: raw.vendorSymbol, fetchLatencyMs: raw.fetchLatencyMs, parseStatus: "NULL_QUOTE" },
            },
            false
          );
          continue;
        }

        // Carry forward same-day OHLC/volume when spark batch response omits intraday day metadata
        if (
          spec.isContinuous &&
          this.latestPrimaryQuote &&
          this.latestPrimaryQuote.sourceTimestamp.slice(0, 10) === quote.sourceTimestamp.slice(0, 10)
        ) {
          if (quote.openPrice === null && this.latestPrimaryQuote.openPrice !== null) {
            quote.openPrice = this.latestPrimaryQuote.openPrice;
          }
          if (this.latestPrimaryQuote.highPrice !== null) {
            quote.highPrice =
              quote.highPrice !== null
                ? Math.max(quote.highPrice, this.latestPrimaryQuote.highPrice, quote.price)
                : Math.max(this.latestPrimaryQuote.highPrice, quote.price);
          }
          if (this.latestPrimaryQuote.lowPrice !== null) {
            quote.lowPrice =
              quote.lowPrice !== null
                ? Math.min(quote.lowPrice, this.latestPrimaryQuote.lowPrice, quote.price)
                : Math.min(this.latestPrimaryQuote.lowPrice, quote.price);
          }
          if (quote.volume === null && this.latestPrimaryQuote.volume !== null) {
            quote.volume = this.latestPrimaryQuote.volume;
          }
          if (quote.bid === null && this.latestPrimaryQuote.bid !== null) {
            quote.bid = this.latestPrimaryQuote.bid;
          }
          if (quote.ask === null && this.latestPrimaryQuote.ask !== null) {
            quote.ask = this.latestPrimaryQuote.ask;
          }
        }

        const check = this.validator.validate(quote);
        quote.qualityStatus = check.status;

        marketHistoryStore.saveRawSnapshot(
          {
            contractCode: spec.contractCode,
            instrumentCode: spec.instrumentCode,
            providerId: provider.id,
            providerName: provider.name,
            sourceUrl: raw.sourceUrl,
            sourceTimestamp: quote.sourceTimestamp,
            receivedAt: raw.receivedAt,
            rawSummary: {
              vendorSymbol: raw.vendorSymbol,
              rawPrice: quote.price,
              prevClose: quote.prevClose,
              fetchLatencyMs: raw.fetchLatencyMs,
              classification: quote.dataClassification,
              qualityStatus: check.status,
            },
          },
          check.status === "ACCEPTED"
        );

        const logEntry: MarketDataLog = {
          id: `mlog-${crypto.randomUUID().slice(0, 6)}`,
          providerId: quote.providerId,
          instrumentCode: quote.instrumentCode,
          contractCode: quote.contractCode,
          price: quote.price,
          bid: quote.bid,
          ask: quote.ask,
          volume: quote.volume,
          sourceTimestamp: quote.sourceTimestamp,
          receivedAt: quote.receivedAt,
          processedAt: quote.processedAt,
          latencyMs: quote.fetchLatencyMs,
          status: check.status,
          note: check.note,
        };
        marketHistoryStore.appendLog(logEntry);

        if (check.status === "ANOMALY_REJECTED" || check.status === "INVALID_TIMESTAMP") {
          anomalyInc += 1;
          if (spec.isContinuous) {
            this.status.qualityStatus = "ANOMALY_FLAGGED";
          }
          this.emitEvent("WARN", check.status, `${spec.contractCode}: ${check.note}`);
          continue;
        }

        if (check.status === "DEDUP_DROPPED") {
          dedupInc += 1;
        } else {
          processedInc += 1;
        }

        marketHistoryStore.saveStandardizedQuote(quote, check.status === "ACCEPTED");

        if (spec.isContinuous) {
          this.latestPrimaryQuote = quote;
          this.status.totalAttempts += 1;
          this.status.successCount += 1;
          this.status.consecutiveFailures = 0;
          this.status.successRatePct = Number(((this.status.successCount / this.status.totalAttempts) * 100).toFixed(2));
          this.status.activeProviderId = quote.providerId;
          this.status.sourceName = quote.providerName;
          this.status.sourceUrl = quote.sourceUrl;
          this.status.lastPrice = quote.price;
          this.status.sourceTimestamp = quote.sourceTimestamp;
          this.status.receivedAt = quote.receivedAt;
          this.status.processedAt = quote.processedAt;
          this.status.fetchLatencyMs = quote.fetchLatencyMs;
          this.status.dataAgeSeconds = quote.dataAgeSeconds;
          this.status.dataClassification = quote.dataClassification;
          this.status.licenseStatus = quote.licenseStatus;
          this.status.redistributionAllowed = quote.redistributionAllowed;
          this.status.lastError = null;
          const isStaleOrHistorical =
            quote.dataClassification === "HISTORICAL" || quote.dataClassification === "DELAYED";
          this.status.connectionStatus = isStaleOrHistorical ? "STALE" : "CONNECTED";
          this.status.qualityStatus = isStaleOrHistorical
            ? "STALE_OR_CLOSED"
            : check.status === "DEDUP_DROPPED"
            ? "DEDUP_FILTERED"
            : "HEALTHY";

          if (check.status === "ACCEPTED") {
            marketHistoryStore.upsertRealtimeQuoteIntoKlines(this.instrumentCode, quote);
            this.emitEvent(
              "INFO",
              "COLLECT",
              `${quote.contractCode} (${quote.vendorSymbol}) 采集成功 @ ${quote.price} [${quote.dataClassification}]`
            );
          }
        }
      }

      // Sync real historical OHLCV bars periodically
      if (
        provider.fetchKlines &&
        (forceHistory || Date.now() - this.lastHistorySyncMs >= HISTORY_SYNC_INTERVAL_MS)
      ) {
        const rawByTf = new Map<Timeframe, MarketKline[]>();
        for (const plan of KLINE_PLAN) {
          try {
            const bars = await provider.fetchKlines(this.primarySpec, plan.tf, plan.range);
            if (bars.length > 0) {
              rawByTf.set(plan.tf, bars);
              klinesByTimeframe[plan.tf] = bars.slice(-220);
              marketHistoryStore.saveKlines(this.instrumentCode, plan.tf, bars);
            }
          } catch (kErr: any) {
            this.emitEvent("WARN", "KLINE_WARN", `${this.instrumentCode} ${plan.tf} K线同步受限: ${kErr?.message || kErr}`);
          }
        }

        const bars15m = rawByTf.get("15m");
        if (bars15m) {
          const bars30m = aggregateKlines(bars15m, 1800);
          klinesByTimeframe["30m"] = bars30m.slice(-220);
          marketHistoryStore.saveKlines(this.instrumentCode, "30m", bars30m);
        }
        const bars1h = rawByTf.get("1h");
        if (bars1h) {
          const bars4h = aggregateKlines(bars1h, 14400);
          klinesByTimeframe["4h"] = bars4h.slice(-220);
          marketHistoryStore.saveKlines(this.instrumentCode, "4h", bars4h);
        }
        const bars1d = rawByTf.get("1d");
        if (bars1d) {
          const bars1w = aggregateKlines(bars1d, 604800);
          klinesByTimeframe["1w"] = bars1w.slice(-220);
          marketHistoryStore.saveKlines(this.instrumentCode, "1w", bars1w);
        }

        if (Object.keys(klinesByTimeframe).length > 0) {
          this.lastHistorySyncMs = Date.now();
        }
      }

      const update: InstrumentCollectionUpdate = {
        instrumentCode: this.instrumentCode,
        primaryQuote: this.latestPrimaryQuote,
        klinesByTimeframe,
        dedupCountIncrement: dedupInc,
        anomalyCountIncrement: anomalyInc,
        processedCountIncrement: processedInc,
      };
      this.onUpdateCallback?.(update);
      return update;
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.status.totalAttempts += 1;
      this.status.failureCount += 1;
      this.status.consecutiveFailures += 1;
      this.status.successRatePct = Number(((this.status.successCount / this.status.totalAttempts) * 100).toFixed(2));
      this.status.lastError = errMsg;
      this.status.connectionStatus = "DISCONNECTED";
      this.status.qualityStatus = "UNAVAILABLE";

      if (this.status.consecutiveFailures >= 2) {
        this.status.dataClassification = "UNAVAILABLE";
        this.status.lastPrice = null;
        this.latestPrimaryQuote = null;
      }

      marketHistoryStore.appendLog({
        id: `mlog-${crypto.randomUUID().slice(0, 6)}`,
        providerId: this.activeProvider.id,
        instrumentCode: this.instrumentCode,
        contractCode: this.primarySpec.contractCode,
        price: null,
        bid: null,
        ask: null,
        volume: null,
        sourceTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "FETCH_ERROR",
        note: errMsg,
      });
      this.emitEvent("ERROR", "DISCONNECT", `${this.instrumentCode} 采集异常: ${errMsg}`);

      // Automatic reconnect & compatible failover after 2 consecutive failures
      if (this.status.consecutiveFailures >= 2 && this.status.collectorState === "RUNNING") {
        const switched = this.tryCompatibleFailover(errMsg);
        if (!switched) {
          this.status.reconnectCount += 1;
          void this.activeProvider.reconnect();
        }
      }

      const update: InstrumentCollectionUpdate = {
        instrumentCode: this.instrumentCode,
        primaryQuote: this.latestPrimaryQuote,
        klinesByTimeframe: {},
        dedupCountIncrement: dedupInc,
        anomalyCountIncrement: anomalyInc,
        processedCountIncrement: processedInc,
      };
      this.onUpdateCallback?.(update);
      return update;
    } finally {
      this.isPolling = false;
    }
  }
}
