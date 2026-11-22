import type { InstrumentCode, MarketKline, QuoteDataClassification, Timeframe } from "../../../types";
import type {
  ContractCollectionSpec,
  MarketDataProvider,
  ProviderHealthCheckResult,
  RawVendorPayload,
  StandardizedQuoteRecord,
} from "../contracts";

export function aggregateKlines(bars: MarketKline[], bucketSec: number): MarketKline[] {
  if (bars.length === 0) return [];
  const grouped = new Map<number, MarketKline>();
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  for (const bar of sorted) {
    const bucket = Math.floor(bar.time / bucketSec) * bucketSec;
    const existing = grouped.get(bucket);
    if (!existing) {
      grouped.set(bucket, {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return Array.from(grouped.values()).sort((a, b) => a.time - b.time);
}

export class YahooPublicProvider implements MarketDataProvider {
  public readonly id = "src-yahoo-public";
  public readonly name = "Yahoo Finance 公开期货接口 (非商业公开源)";
  public readonly providerCode = "YAHOO_PUBLIC" as const;
  public readonly protocol = "REST_POLL" as const;
  public readonly licenseStatus = "NON_COMMERCIAL_PUBLIC" as const;
  public readonly redistributionAllowed = false;
  public readonly supportedInstruments: InstrumentCode[] = ["WTI", "BRENT", "GOLD", "SILVER", "NG"];
  public readonly supportedTimeframes: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];
  public readonly supportedUnits: Partial<Record<InstrumentCode, string>> = {
    WTI: "桶 (USD/bbl)",
    BRENT: "桶 (USD/bbl)",
    GOLD: "盎司",
    SILVER: "盎司",
    NG: "MMBtu",
  };

  private readonly hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  private hostIndex = 0;
  private connected = false;
  private lastError: string | null = null;
  private lastLatencyMs = 0;
  private lastCheckAt = new Date().toISOString();
  private subscribed: ContractCollectionSpec[] = [];

  private currentHost(): string {
    return this.hosts[this.hostIndex % this.hosts.length];
  }

  private rotateHost(): string {
    this.hostIndex = (this.hostIndex + 1) % this.hosts.length;
    return this.currentHost();
  }

  private async httpGetJson(pathWithQuery: string): Promise<{ data: any; latencyMs: number; url: string }> {
    let lastErr: Error | null = null;
    for (let i = 0; i < this.hosts.length; i++) {
      const host = this.currentHost();
      const url = `${host}${pathWithQuery}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const t0 = Date.now();
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        const latencyMs = Math.max(1, Date.now() - t0);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        this.connected = true;
        this.lastError = null;
        this.lastLatencyMs = latencyMs;
        this.lastCheckAt = new Date().toISOString();
        return { data, latencyMs, url };
      } catch (err: any) {
        clearTimeout(timer);
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.rotateHost();
      }
    }
    this.connected = false;
    this.lastError = lastErr?.message || "Yahoo Finance endpoint unreachable";
    this.lastCheckAt = new Date().toISOString();
    throw lastErr || new Error("Yahoo Finance endpoint unreachable");
  }

  public async connect(): Promise<boolean> {
    try {
      const { data } = await this.httpGetJson("/v8/finance/spark?symbols=CL=F,BZ=F&range=5d&interval=5m");
      return Boolean(data?.["CL=F"] || data?.["BZ=F"]);
    } catch {
      return false;
    }
  }

  public subscribe(specs: ContractCollectionSpec[]): void {
    this.subscribed = [...specs];
  }

  public disconnect(): void {
    this.connected = false;
    this.lastCheckAt = new Date().toISOString();
  }

  public async reconnect(): Promise<boolean> {
    this.rotateHost();
    return this.connect();
  }

  public async fetchQuote(spec: ContractCollectionSpec): Promise<RawVendorPayload> {
    const vendorSymbol = spec.vendorSymbols[this.id];
    if (!vendorSymbol) {
      throw new Error(`No Yahoo symbol mapped for ${spec.contractCode}`);
    }
    const { data, latencyMs, url } = await this.httpGetJson(
      `/v8/finance/chart/${encodeURIComponent(vendorSymbol)}?interval=1m&range=5d`
    );
    return {
      providerId: this.id,
      vendorSymbol,
      sourceUrl: url,
      receivedAt: new Date().toISOString(),
      fetchLatencyMs: latencyMs,
      rawData: data,
    };
  }

  public async fetchBatchQuotes(specs: ContractCollectionSpec[]): Promise<Map<string, RawVendorPayload>> {
    const valid = specs.filter((s) => Boolean(s.vendorSymbols[this.id]));
    const result = new Map<string, RawVendorPayload>();
    if (valid.length === 0) return result;
    const symbolsCsv = valid.map((s) => encodeURIComponent(s.vendorSymbols[this.id])).join(",");
    const { data, latencyMs, url } = await this.httpGetJson(
      `/v8/finance/spark?symbols=${symbolsCsv}&range=5d&interval=5m`
    );
    const receivedAt = new Date().toISOString();
    for (const spec of valid) {
      const vendorSymbol = spec.vendorSymbols[this.id];
      const entry = data?.[vendorSymbol];
      if (entry) {
        result.set(spec.contractCode, {
          providerId: this.id,
          vendorSymbol,
          sourceUrl: url,
          receivedAt,
          fetchLatencyMs: latencyMs,
          rawData: { sparkEntry: entry },
        });
      }
    }
    return result;
  }

  public async fetchKlines(spec: ContractCollectionSpec, timeframe: Timeframe, range: string): Promise<MarketKline[]> {
    const vendorSymbol = spec.vendorSymbols[this.id];
    if (!vendorSymbol) return [];
    const { data } = await this.httpGetJson(
      `/v8/finance/chart/${encodeURIComponent(vendorSymbol)}?interval=${encodeURIComponent(timeframe)}&range=${encodeURIComponent(range)}`
    );
    const node = data?.chart?.result?.[0];
    if (!node) return [];
    const timestamps: (number | null)[] = node.timestamp || [];
    const quote = node.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    const bars: MarketKline[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      if (t == null || o == null || h == null || l == null || c == null) continue;
      bars.push({
        time: Math.floor(t),
        open: Number(o.toFixed(4)),
        high: Number(h.toFixed(4)),
        low: Number(l.toFixed(4)),
        close: Number(c.toFixed(4)),
        volume: Math.round(volumes[i] ?? 0),
      });
    }
    return bars;
  }

  public normalize(raw: RawVendorPayload, spec: ContractCollectionSpec): StandardizedQuoteRecord | null {
    const nowMs = Date.now();
    const processedAt = new Date(nowMs).toISOString();
    const payload = raw.rawData as any;

    // Branch 1: Spark entry
    if (payload?.sparkEntry) {
      const entry = payload.sparkEntry;
      const timestamps: number[] = entry.timestamp || [];
      const closes: (number | null)[] = entry.close || [];
      let price: number | null = typeof entry.fulldayPrice === "number" ? entry.fulldayPrice : null;
      if (price === null) {
        for (let i = closes.length - 1; i >= 0; i--) {
          if (typeof closes[i] === "number") {
            price = closes[i]!;
            break;
          }
        }
      }
      if (price === null || timestamps.length === 0) return null;
      const sourceEpochSec = Math.floor(timestamps[timestamps.length - 1]);
      const sourceIso = new Date(sourceEpochSec * 1000).toISOString();
      const targetDay = sourceIso.slice(0, 10);
      const dayCloses: number[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const cl = closes[i];
        if (typeof ts === "number" && typeof cl === "number" && new Date(ts * 1000).toISOString().slice(0, 10) === targetDay) {
          dayCloses.push(cl);
        }
      }
      const ageSec = Math.max(0, Math.floor(nowMs / 1000) - sourceEpochSec);
      const classification: QuoteDataClassification =
        ageSec > 300 ? "HISTORICAL" : ageSec > 15 ? "DELAYED" : "LIVE";
      const prevClose = typeof entry.previousClose === "number" ? entry.previousClose : typeof entry.chartPreviousClose === "number" ? entry.chartPreviousClose : null;

      return {
        providerId: this.id,
        providerName: this.name,
        instrumentCode: spec.instrumentCode,
        contractCode: spec.contractCode,
        vendorSymbol: raw.vendorSymbol,
        isContinuous: spec.isContinuous,
        unitLabel: spec.unitLabel,
        currency: spec.currency,
        price: Number(price.toFixed(4)),
        openPrice: dayCloses.length > 0 ? Number(dayCloses[0].toFixed(4)) : null,
        highPrice: dayCloses.length > 0 ? Number(Math.max(...dayCloses, price).toFixed(4)) : null,
        lowPrice: dayCloses.length > 0 ? Number(Math.min(...dayCloses, price).toFixed(4)) : null,
        prevClose: prevClose !== null ? Number(prevClose.toFixed(4)) : null,
        bid: null,
        ask: null,
        volume: null,
        exchangeName: spec.instrumentCode === "BRENT" ? "ICE/NYM" : spec.instrumentCode === "GOLD" || spec.instrumentCode === "SILVER" ? "COMEX" : "NYMEX",
        sourceUrl: raw.sourceUrl,
        sourceTimestamp: sourceIso,
        sourceEpochSec,
        receivedAt: raw.receivedAt,
        processedAt,
        fetchLatencyMs: raw.fetchLatencyMs,
        dataAgeSeconds: ageSec,
        dataClassification: classification,
        licenseStatus: this.licenseStatus,
        redistributionAllowed: this.redistributionAllowed,
      };
    }

    // Branch 2: Full chart result
    const node = payload?.chart?.result?.[0];
    const meta = node?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number" || typeof meta.regularMarketTime !== "number") {
      return null;
    }

    const sourceEpochSec = Math.floor(meta.regularMarketTime);
    const sourceIso = new Date(sourceEpochSec * 1000).toISOString();
    const ageSec = Math.max(0, Math.floor(nowMs / 1000) - sourceEpochSec);
    const classification: QuoteDataClassification =
      ageSec > 300 ? "HISTORICAL" : ageSec > 15 ? "DELAYED" : "LIVE";

    let openPrice: number | null = null;
    const timestamps: (number | null)[] = node.timestamp || [];
    const opens: (number | null)[] = node.indicators?.quote?.[0]?.open || [];
    const targetDay = sourceIso.slice(0, 10);
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const op = opens[i];
      if (ts != null && op != null && new Date(ts * 1000).toISOString().slice(0, 10) === targetDay) {
        openPrice = Number(op.toFixed(4));
        break;
      }
    }

    const prevClose = typeof meta.previousClose === "number" ? meta.previousClose : typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null;

    return {
      providerId: this.id,
      providerName: this.name,
      instrumentCode: spec.instrumentCode,
      contractCode: spec.contractCode,
      vendorSymbol: raw.vendorSymbol,
      isContinuous: spec.isContinuous,
      unitLabel: spec.unitLabel,
      currency: String(meta.currency || spec.currency),
      price: Number(meta.regularMarketPrice.toFixed(4)),
      openPrice,
      highPrice: typeof meta.regularMarketDayHigh === "number" ? Number(meta.regularMarketDayHigh.toFixed(4)) : null,
      lowPrice: typeof meta.regularMarketDayLow === "number" ? Number(meta.regularMarketDayLow.toFixed(4)) : null,
      prevClose: prevClose !== null ? Number(prevClose.toFixed(4)) : null,
      bid: typeof meta.bid === "number" ? Number(meta.bid.toFixed(4)) : null,
      ask: typeof meta.ask === "number" ? Number(meta.ask.toFixed(4)) : null,
      volume: typeof meta.regularMarketVolume === "number" ? Math.round(meta.regularMarketVolume) : null,
      exchangeName: String(meta.fullExchangeName || meta.exchangeName || "NYM"),
      sourceUrl: raw.sourceUrl,
      sourceTimestamp: sourceIso,
      sourceEpochSec,
      receivedAt: raw.receivedAt,
      processedAt,
      fetchLatencyMs: raw.fetchLatencyMs,
      dataAgeSeconds: ageSec,
      dataClassification: classification,
      licenseStatus: this.licenseStatus,
      redistributionAllowed: this.redistributionAllowed,
    };
  }

  public healthCheck(): ProviderHealthCheckResult {
    return {
      providerId: this.id,
      connected: this.connected,
      status: this.connected ? "CONNECTED" : "DISCONNECTED",
      activeEndpoint: this.currentHost(),
      checkedAt: this.lastCheckAt,
      latencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }
}
