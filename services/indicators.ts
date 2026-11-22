import type { MarketKline } from "../types";

export interface LinePoint {
  time: number;
  value: number;
}

export interface BollResult {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}

export interface MacdResult {
  dif: LinePoint[];
  dea: LinePoint[];
  histogram: { time: number; value: number; color: string }[];
}

export interface KdjResult {
  k: LinePoint[];
  d: LinePoint[];
  j: LinePoint[];
}

export function calcSMA(candles: MarketKline[], period: number): LinePoint[] {
  const result: LinePoint[] = [];
  if (candles.length < period) return result;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      result.push({ time: candles[i].time, value: Number((sum / period).toFixed(4)) });
    }
  }
  return result;
}

export function calcEMA(candles: MarketKline[], period: number): LinePoint[] {
  const result: LinePoint[] = [];
  if (candles.length === 0) return result;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ema = candles[0].close;
    } else {
      ema = candles[i].close * k + ema * (1 - k);
    }
    if (i >= period - 1) {
      result.push({ time: candles[i].time, value: Number(ema.toFixed(4)) });
    }
  }
  return result;
}

export function calcBOLL(candles: MarketKline[], period = 20, mult = 2): BollResult {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (candles.length < period) return { upper, middle, lower };

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = candles[j].close - mean;
      sqSum += diff * diff;
    }
    const std = Math.sqrt(sqSum / period);
    const t = candles[i].time;
    middle.push({ time: t, value: Number(mean.toFixed(4)) });
    upper.push({ time: t, value: Number((mean + mult * std).toFixed(4)) });
    lower.push({ time: t, value: Number((mean - mult * std).toFixed(4)) });
  }
  return { upper, middle, lower };
}

export function calcMACD(
  candles: MarketKline[],
  fast = 12,
  slow = 26,
  signal = 9,
  colors: { up: string; down: string } = {
    up: "rgba(16, 185, 129, 0.72)",
    down: "rgba(239, 68, 68, 0.72)",
  }
): MacdResult {
  const dif: LinePoint[] = [];
  const dea: LinePoint[] = [];
  const histogram: { time: number; value: number; color: string }[] = [];
  if (candles.length < slow) return { dif, dea, histogram };

  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  const kSig = 2 / (signal + 1);

  let emaFast = candles[0].close;
  let emaSlow = candles[0].close;
  let signalVal = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    emaFast = i === 0 ? c : c * kFast + emaFast * (1 - kFast);
    emaSlow = i === 0 ? c : c * kSlow + emaSlow * (1 - kSlow);
    const difVal = emaFast - emaSlow;
    signalVal = i === 0 ? difVal : difVal * kSig + signalVal * (1 - kSig);
    const histVal = (difVal - signalVal) * 2;

    if (i >= slow - 1) {
      const t = candles[i].time;
      dif.push({ time: t, value: Number(difVal.toFixed(4)) });
      dea.push({ time: t, value: Number(signalVal.toFixed(4)) });
      histogram.push({
        time: t,
        value: Number(histVal.toFixed(4)),
        color: histVal >= 0 ? colors.up : colors.down,
      });
    }
  }
  return { dif, dea, histogram };
}

export function calcRSI(candles: MarketKline[], period = 14): LinePoint[] {
  const result: LinePoint[] = [];
  if (candles.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({
    time: candles[period].time,
    value: Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs)).toFixed(2)),
  });

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({ time: candles[i].time, value: Number(rsi.toFixed(2)) });
  }
  return result;
}

export function calcKDJ(candles: MarketKline[], n = 9, m1 = 3, m2 = 3): KdjResult {
  const k: LinePoint[] = [];
  const d: LinePoint[] = [];
  const j: LinePoint[] = [];
  if (candles.length < n) return { k, d, j };

  let prevK = 50;
  let prevD = 50;

  for (let i = n - 1; i < candles.length; i++) {
    let lowN = Infinity;
    let highN = -Infinity;
    for (let idx = i - n + 1; idx <= i; idx++) {
      if (candles[idx].low < lowN) lowN = candles[idx].low;
      if (candles[idx].high > highN) highN = candles[idx].high;
    }
    const rsv = highN === lowN ? 50 : ((candles[i].close - lowN) / (highN - lowN)) * 100;
    const currK = ((m1 - 1) / m1) * prevK + (1 / m1) * rsv;
    const currD = ((m2 - 1) / m2) * prevD + (1 / m2) * currK;
    const currJ = 3 * currK - 2 * currD;
    prevK = currK;
    prevD = currD;

    const t = candles[i].time;
    k.push({ time: t, value: Number(currK.toFixed(2)) });
    d.push({ time: t, value: Number(currD.toFixed(2)) });
    j.push({ time: t, value: Number(currJ.toFixed(2)) });
  }
  return { k, d, j };
}
