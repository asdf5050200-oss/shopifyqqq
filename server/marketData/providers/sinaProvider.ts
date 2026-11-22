import type { InstrumentCode, QuoteDataClassification, Timeframe } from "../../../types";
import type {
  ContractCollectionSpec,
  MarketDataProvider,
  ProviderHealthCheckResult,
  RawVendorPayload,
  StandardizedQuoteRecord,
} from "../contracts";

export class SinaPublicProvider implements MarketDataProvider {
  public readonly id = "src-sina-public";
  public readonly name = "新浪财经国际期货公开接口 (备援非商业源)";
  public readonly providerCode = "SINA_PUBLIC" as const;
  public readonly protocol = "REST_POLL" as const;
  public readonly licenseStatus = "NON_COMMERCIAL_PUBLIC" as const;
  public readonly redistributionAllowed = false;
  public readonly supportedInstruments: InstrumentCode[] = ["WTI", "BRENT"];
  public readonly supportedTimeframes: Timeframe[] = [];
  public readonly supportedUnits: Partial<Record<InstrumentCode, string>> = {
    WTI: "桶 (USD/bbl)",
    BRENT: "桶 (USD/bbl)",
  };

  private readonly baseUrl = "https://hq.sinajs.cn/list=hf_CL,hf_OIL";
  private connected = false;
  private lastError: string | null = null;
  private lastLatencyMs = 0;
  private lastCheckAt = new Date().toISOString();
  private lastClassification: QuoteDataClassification = "UNAVAILABLE";
  private subscribed: ContractCollectionSpec[] = [];

  private async fetchRawList(): Promise<{ parsed: Record<string, string[]>; latencyMs: number; url: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const t0 = Date.now();
    try {
      const res = await fetch(this.baseUrl, {
        method: "GET",
        headers: {
          Referer: "https://finance.sina.com.cn/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.max(1, Date.now() - t0);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const buf = await res.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder("gbk").decode(buf);
      } catch {
        text = new TextDecoder("utf-8").decode(buf);
      }
      const parsed: Record<string, string[]> = {};
      for (const line of text.split(/\r?\n/)) {
        const idx = line.indexOf('="');
        if (idx === -1) continue;
        const key = line.slice(0, idx).replace("var hq_str_", "").trim();
        const val = line.slice(idx + 2).replace(/";?$/, "");
        parsed[key] = val.split(",");
      }
      this.connected = true;
      this.lastError = null;
      this.lastLatencyMs = latencyMs;
      this.lastCheckAt = new Date().toISOString();
      const sampleFields = parsed.hf_CL || parsed.hf_OIL;
      if (Array.isArray(sampleFields) && sampleFields.length >= 13) {
        const dtMs = Date.parse(`${(sampleFields[12] || "").trim()}T${(sampleFields[6] || "").trim()}+08:00`);
        if (Number.isFinite(dtMs)) {
          const ageSec = Math.max(0, Math.floor((Date.now() - dtMs) / 1000));
          this.lastClassification = ageSec > 300 ? "HISTORICAL" : ageSec > 15 ? "DELAYED" : "LIVE";
        }
      }
      return { parsed, latencyMs, url: this.baseUrl };
    } catch (err: any) {
      clearTimeout(timer);
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastCheckAt = new Date().toISOString();
      throw err;
    }
  }

  public async connect(): Promise<boolean> {
    try {
      const { parsed } = await this.fetchRawList();
      return Boolean(parsed.hf_CL?.length || parsed.hf_OIL?.length);
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
    return this.connect();
  }

  public async fetchQuote(spec: ContractCollectionSpec): Promise<RawVendorPayload> {
    const vendorSymbol = spec.vendorSymbols[this.id];
    if (!vendorSymbol) {
      throw new Error(`No Sina symbol mapped for ${spec.contractCode}`);
    }
    const { parsed, latencyMs, url } = await this.fetchRawList();
    return {
      providerId: this.id,
      vendorSymbol,
      sourceUrl: url,
      receivedAt: new Date().toISOString(),
      fetchLatencyMs: latencyMs,
      rawData: parsed[vendorSymbol] || null,
    };
  }

  public async fetchBatchQuotes(specs: ContractCollectionSpec[]): Promise<Map<string, RawVendorPayload>> {
    const valid = specs.filter((s) => Boolean(s.vendorSymbols[this.id]));
    const result = new Map<string, RawVendorPayload>();
    if (valid.length === 0) return result;
    const { parsed, latencyMs, url } = await this.fetchRawList();
    const receivedAt = new Date().toISOString();
    for (const spec of valid) {
      const vendorSymbol = spec.vendorSymbols[this.id];
      if (parsed[vendorSymbol]) {
        result.set(spec.contractCode, {
          providerId: this.id,
          vendorSymbol,
          sourceUrl: url,
          receivedAt,
          fetchLatencyMs: latencyMs,
          rawData: parsed[vendorSymbol],
        });
      }
    }
    return result;
  }

  public normalize(raw: RawVendorPayload, spec: ContractCollectionSpec): StandardizedQuoteRecord | null {
    const fields = raw.rawData as string[] | null;
    if (!Array.isArray(fields) || fields.length < 13) return null;

    const price = Number(fields[0]);
    if (!Number.isFinite(price) || price <= 0) return null;

    const bid = fields[2] ? Number(fields[2]) : null;
    const ask = fields[3] ? Number(fields[3]) : null;
    const high = fields[4] ? Number(fields[4]) : null;
    const low = fields[5] ? Number(fields[5]) : null;
    const timeStr = (fields[6] || "").trim();
    const prevClose = fields[7] ? Number(fields[7]) : null;
    const open = fields[8] ? Number(fields[8]) : null;
    const dateStr = (fields[12] || "").trim();
    const vol = fields[14] ? Number(fields[14]) : null;

    // Parse China Standard Time (UTC+08:00) into UTC ISO timestamp
    const isoCst = `${dateStr}T${timeStr}+08:00`;
    const dtMs = Date.parse(isoCst);
    if (!Number.isFinite(dtMs)) return null;

    const nowMs = Date.now();
    const sourceEpochSec = Math.floor(dtMs / 1000);
    const ageSec = Math.max(0, Math.floor(nowMs / 1000) - sourceEpochSec);
    const classification: QuoteDataClassification =
      ageSec > 300 ? "HISTORICAL" : ageSec > 15 ? "DELAYED" : "LIVE";

    this.lastClassification = classification;
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
      openPrice: open !== null && Number.isFinite(open) ? Number(open.toFixed(4)) : null,
      highPrice: high !== null && Number.isFinite(high) ? Number(high.toFixed(4)) : null,
      lowPrice: low !== null && Number.isFinite(low) ? Number(low.toFixed(4)) : null,
      prevClose: prevClose !== null && Number.isFinite(prevClose) ? Number(prevClose.toFixed(4)) : null,
      bid: bid !== null && Number.isFinite(bid) ? Number(bid.toFixed(4)) : null,
      ask: ask !== null && Number.isFinite(ask) ? Number(ask.toFixed(4)) : null,
      volume: vol !== null && Number.isFinite(vol) ? Math.round(vol) : null,
      exchangeName: spec.instrumentCode === "WTI" ? "NYMEX" : "ICE",
      sourceUrl: raw.sourceUrl,
      sourceTimestamp: new Date(dtMs).toISOString(),
      sourceEpochSec,
      receivedAt: raw.receivedAt,
      processedAt: new Date(nowMs).toISOString(),
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
      status: !this.connected ? "DISCONNECTED" : this.lastClassification === "LIVE" ? "CONNECTED" : "STALE",
      activeEndpoint: this.baseUrl,
      checkedAt: this.lastCheckAt,
      latencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }
}
