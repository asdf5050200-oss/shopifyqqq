import type { StandardizedQuoteRecord } from "./contracts";

export interface QualityCheckResult {
  status: "ACCEPTED" | "DEDUP_DROPPED" | "ANOMALY_REJECTED" | "INVALID_TIMESTAMP";
  isNewEvent: boolean;
  note: string;
}

export class MarketQualityValidator {
  private dedupSet = new Set<string>();
  private dedupQueue: string[] = [];
  private lastAcceptedPrice = new Map<string, number>();
  private lastAcceptedEpoch = new Map<string, number>();
  private lastAcceptedEpochByContract = new Map<string, number>();
  private readonly maxDedupSize = 2000;

  public clearCrossProviderAnchors(): void {
    this.lastAcceptedEpochByContract.clear();
  }

  public validate(quote: StandardizedQuoteRecord): QualityCheckResult {
    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      return {
        status: "ANOMALY_REJECTED",
        isNewEvent: false,
        note: `无效行情价格 (${quote.price})`,
      };
    }

    if (quote.currency !== "USD") {
      return {
        status: "ANOMALY_REJECTED",
        isNewEvent: false,
        note: `计价币种不匹配 (${quote.currency} != USD)`,
      };
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(quote.sourceEpochSec) || quote.sourceEpochSec <= 0) {
      return {
        status: "INVALID_TIMESTAMP",
        isNewEvent: false,
        note: `缺失有效原始时间戳 (${quote.sourceTimestamp})`,
      };
    }

    if (quote.sourceEpochSec > nowEpoch + 120) {
      return {
        status: "INVALID_TIMESTAMP",
        isNewEvent: false,
        note: `未来时间戳异常 (${quote.sourceEpochSec} > ${nowEpoch})`,
      };
    }

    const epochKey = `${quote.providerId}:${quote.contractCode}`;
    const prevEpoch = this.lastAcceptedEpoch.get(epochKey);
    if (prevEpoch !== undefined && quote.sourceEpochSec < prevEpoch) {
      return {
        status: "INVALID_TIMESTAMP",
        isNewEvent: false,
        note: `乱序旧时间戳拦截 (${quote.sourceEpochSec} < ${prevEpoch})`,
      };
    }

    const prevContractEpoch = this.lastAcceptedEpochByContract.get(quote.contractCode);
    if (prevContractEpoch !== undefined && quote.sourceEpochSec < prevContractEpoch - 300) {
      return {
        status: "INVALID_TIMESTAMP",
        isNewEvent: false,
        note: `跨源旧时间戳回退拦截 (${quote.sourceEpochSec} < ${prevContractEpoch})`,
      };
    }

    // Deduplicate identical event across polls / provider failovers
    const dedupKey = `${quote.contractCode}:${quote.sourceEpochSec}:${quote.price}`;
    if (this.dedupSet.has(dedupKey)) {
      return {
        status: "DEDUP_DROPPED",
        isNewEvent: false,
        note: `同时间戳重复快照过滤 (${quote.sourceTimestamp} @ ${quote.price})`,
      };
    }

    // Price spike check (> 12% jump in single cycle)
    const prevPrice = this.lastAcceptedPrice.get(quote.contractCode);
    if (prevPrice !== undefined && prevPrice > 0) {
      const pctJump = Math.abs(quote.price - prevPrice) / prevPrice;
      if (pctJump > 0.12) {
        return {
          status: "ANOMALY_REJECTED",
          isNewEvent: false,
          note: `异常跳价拦截 (${(pctJump * 100).toFixed(2)}% > 12%): ${prevPrice} -> ${quote.price}`,
        };
      }
    }

    this.dedupSet.add(dedupKey);
    this.dedupQueue.push(dedupKey);
    if (this.dedupQueue.length > this.maxDedupSize) {
      const oldest = this.dedupQueue.shift();
      if (oldest) this.dedupSet.delete(oldest);
    }

    this.lastAcceptedPrice.set(quote.contractCode, quote.price);
    this.lastAcceptedEpoch.set(epochKey, quote.sourceEpochSec);
    if (prevContractEpoch === undefined || quote.sourceEpochSec > prevContractEpoch) {
      this.lastAcceptedEpochByContract.set(quote.contractCode, quote.sourceEpochSec);
    }

    return {
      status: "ACCEPTED",
      isNewEvent: true,
      note: `质量校验通过 [${quote.dataClassification}] · 耗时 ${quote.fetchLatencyMs}ms`,
    };
  }
}
