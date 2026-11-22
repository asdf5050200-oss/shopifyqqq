import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  AccountLedgerEntry,
  AdminAuditLog,
  ApprovalRequest,
  FuturesInstrument,
  InstrumentCode,
  MatchingRuleConfig,
  Tenant,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradeRiskEvent,
  TradingAccount,
  User,
} from "../types";
import { roundMoney } from "./decimal";

export interface StoredUser extends User {
  passwordHash?: string;
}

export interface PlatformDatabase {
  tenants: Tenant[];
  users: StoredUser[];
  instruments: FuturesInstrument[];
  accounts: TradingAccount[];
  ledger: AccountLedgerEntry[];
  orders: TradeOrder[];
  executions: TradeExecution[];
  positions: TradePosition[];
  riskEvents: TradeRiskEvent[];
  auditLogs: AdminAuditLog[];
  approvals?: ApprovalRequest[];
  matchingRules: MatchingRuleConfig;
}

const DATA_DIR = path.join(process.cwd(), "data");
export const STORE_FILE = path.join(DATA_DIR, "platform-store.json");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, keyHex] = storedHash.split(":");
  const keyBuf = Buffer.from(keyHex, "hex");
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function createSeedDatabase(): PlatformDatabase {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3600 * 1000 * 6).toISOString();
  const muchEarlier = new Date(Date.now() - 3600 * 1000 * 24 * 3).toISOString();

  const tenants: Tenant[] = [
    {
      id: "tenant-alpha",
      code: "ALPHA",
      name: "华盛国际期货代理",
      brandName: "华盛国际模拟交易",
      domain: "alpha.meridian.local",
      parentId: null,
      status: "ACTIVE",
      defaultInitialCapital: 100000,
      allowedInstruments: ["WTI", "BRENT", "GOLD", "SILVER", "NG"],
      accentColor: "#3B82F6",
      createdAt: muchEarlier,
    },
    {
      id: "tenant-beta",
      code: "BETA",
      name: "鼎泰能源投研",
      brandName: "鼎泰原油模拟盘",
      domain: "beta.meridian.local",
      parentId: null,
      status: "ACTIVE",
      defaultInitialCapital: 50000,
      allowedInstruments: ["WTI", "BRENT"],
      accentColor: "#0EA5E9",
      createdAt: muchEarlier,
    },
    {
      id: "tenant-gamma",
      code: "GAMMA",
      name: "星河大宗商品 (二级代理)",
      brandName: "星河期货模拟终端",
      domain: "gamma.meridian.local",
      parentId: "tenant-alpha",
      status: "ACTIVE",
      defaultInitialCapital: 30000,
      allowedInstruments: ["WTI", "BRENT", "GOLD"],
      accentColor: "#F59E0B",
      createdAt: muchEarlier,
    },
  ];

  const defaultPassHash = hashPassword("Meridian@2026");

  const users: StoredUser[] = [
    {
      id: "usr-super-1",
      tenantId: null,
      email: "super@meridian.io",
      name: "平台总运营官",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      permissions: ["*"],
      createdAt: muchEarlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-alpha-admin",
      tenantId: "tenant-alpha",
      email: "admin@alpha.meridian.local",
      name: "林致远 (华盛主理人)",
      role: "AGENT_ADMIN",
      status: "ACTIVE",
      permissions: ["members:manage", "accounts:adjust", "orders:read", "reports:read", "brand:edit", "staff:manage"],
      createdAt: muchEarlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-alpha-staff",
      tenantId: "tenant-alpha",
      email: "ops@alpha.meridian.local",
      name: "陈思琪 (华盛风控专员)",
      role: "AGENT_STAFF",
      status: "ACTIVE",
      permissions: ["members:read", "orders:read", "reports:read"],
      createdAt: earlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-alpha-m1",
      tenantId: "tenant-alpha",
      email: "zhangwei@alpha.meridian.local",
      name: "张伟",
      role: "MEMBER",
      status: "ACTIVE",
      permissions: ["trade:execute", "account:read"],
      createdAt: muchEarlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-alpha-m2",
      tenantId: "tenant-alpha",
      email: "limin@alpha.meridian.local",
      name: "李敏",
      role: "MEMBER",
      status: "ACTIVE",
      permissions: ["trade:execute", "account:read"],
      createdAt: earlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-beta-admin",
      tenantId: "tenant-beta",
      email: "admin@beta.meridian.local",
      name: "周明辉 (鼎泰主理人)",
      role: "AGENT_ADMIN",
      status: "ACTIVE",
      permissions: ["members:manage", "accounts:adjust", "orders:read", "reports:read", "brand:edit", "staff:manage"],
      createdAt: muchEarlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-beta-m1",
      tenantId: "tenant-beta",
      email: "wangqiang@beta.meridian.local",
      name: "王强",
      role: "MEMBER",
      status: "ACTIVE",
      permissions: ["trade:execute", "account:read"],
      createdAt: muchEarlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-beta-m2",
      tenantId: "tenant-beta",
      email: "zhaoxue@beta.meridian.local",
      name: "赵雪",
      role: "MEMBER",
      status: "ACTIVE",
      permissions: ["trade:execute", "account:read"],
      createdAt: earlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-gamma-admin",
      tenantId: "tenant-gamma",
      email: "admin@gamma.meridian.local",
      name: "陈星河 (星河二级主理人)",
      role: "AGENT_L2",
      status: "ACTIVE",
      permissions: ["members:manage", "accounts:adjust", "orders:read", "reports:read", "brand:edit", "staff:manage"],
      createdAt: earlier,
      passwordHash: defaultPassHash,
    },
    {
      id: "usr-gamma-m1",
      tenantId: "tenant-gamma",
      email: "sunhao@gamma.meridian.local",
      name: "孙浩",
      role: "MEMBER",
      status: "ACTIVE",
      permissions: ["trade:execute", "account:read"],
      createdAt: earlier,
      passwordHash: defaultPassHash,
    },
  ];

  const instruments: FuturesInstrument[] = [
    {
      code: "WTI",
      name: "WTI 美原油",
      marketSymbol: "CL",
      activeContract: "CL2612",
      unitLabel: "桶/手",
      multiplier: 1000,
      tickSize: 0.01,
      pricePrecision: 2,
      initialMarginRate: 0.05,
      maintenanceMarginRate: 0.025,
      feePerLot: 4.5,
      maxLotsPerOrder: 50,
      sessionLabel: "NYMEX 24H 连续模拟",
      exchangeLabel: "NYMEX",
      tradingEnabled: true,
    },
    {
      code: "BRENT",
      name: "Brent 布伦特原油",
      marketSymbol: "BRN",
      activeContract: "BRN2612",
      unitLabel: "桶/手",
      multiplier: 1000,
      tickSize: 0.01,
      pricePrecision: 2,
      initialMarginRate: 0.05,
      maintenanceMarginRate: 0.025,
      feePerLot: 4.8,
      maxLotsPerOrder: 50,
      sessionLabel: "ICE 伦敦连续模拟",
      exchangeLabel: "ICE",
      tradingEnabled: true,
    },
    {
      code: "GOLD",
      name: "COMEX 黄金",
      marketSymbol: "XAU",
      activeContract: "GC2612",
      unitLabel: "盎司/手",
      multiplier: 100,
      tickSize: 0.1,
      pricePrecision: 2,
      initialMarginRate: 0.04,
      maintenanceMarginRate: 0.02,
      feePerLot: 5.0,
      maxLotsPerOrder: 40,
      sessionLabel: "COMEX 贵金属模拟",
      exchangeLabel: "COMEX",
      tradingEnabled: true,
    },
    {
      code: "SILVER",
      name: "COMEX 白银",
      marketSymbol: "XAG",
      activeContract: "SI2612",
      unitLabel: "盎司/手",
      multiplier: 5000,
      tickSize: 0.005,
      pricePrecision: 3,
      initialMarginRate: 0.06,
      maintenanceMarginRate: 0.03,
      feePerLot: 6.0,
      maxLotsPerOrder: 30,
      sessionLabel: "COMEX 贵金属模拟",
      exchangeLabel: "COMEX",
      tradingEnabled: true,
    },
    {
      code: "NG",
      name: "Henry Hub 天然气",
      marketSymbol: "NG",
      activeContract: "NG2612",
      unitLabel: "MMBtu/手",
      multiplier: 10000,
      tickSize: 0.001,
      pricePrecision: 3,
      initialMarginRate: 0.08,
      maintenanceMarginRate: 0.04,
      feePerLot: 3.5,
      maxLotsPerOrder: 50,
      sessionLabel: "NYMEX 能源模拟",
      exchangeLabel: "NYMEX",
      tradingEnabled: true,
    },
  ];

  // Seed initial positions and consistent accounts
  // Zhang Wei (tenant-alpha): initial 100,000. Holds 2 lots WTI LONG @ 70.80 -> margin = 2 * 70.80 * 1000 * 0.05 = 7080.00, fee = 9.00
  // Also holds 1 lot BRENT SHORT @ 75.60 -> margin = 1 * 75.60 * 1000 * 0.05 = 3780.00, fee = 4.80
  // Realized PnL from earlier closed trade: +620.00, fee = 9.00
  // Balance = 100000 + 620 - (9 + 4.8 + 9) = 100597.20
  // Used Margin = 7080 + 3780 = 10860.00
  // Frozen Funds (1 pending limit buy 1 lot WTI @ 69.50 -> margin 3475 + fee 4.50 = 3479.50)
  // Available = 100597.20 - 10860.00 - 3479.50 = 86257.70
  const accounts: TradingAccount[] = [
    {
      id: "acc-alpha-m1",
      accountNo: "SIM-A-1001",
      userId: "usr-alpha-m1",
      tenantId: "tenant-alpha",
      initialCapital: 100000,
      balance: 100597.2,
      availableFunds: 86257.7,
      frozenFunds: 3479.5,
      usedMargin: 10860,
      realizedPnl: 620,
      unrealizedPnl: 1650,
      totalFees: 22.8,
      riskRatio: roundMoney(((100597.2 + 1650) / 10860) * 100),
      status: "ACTIVE",
      updatedAt: now,
    },
    {
      id: "acc-alpha-m2",
      accountNo: "SIM-A-1002",
      userId: "usr-alpha-m2",
      tenantId: "tenant-alpha",
      initialCapital: 100000,
      balance: 99990,
      availableFunds: 89410,
      frozenFunds: 0,
      usedMargin: 10580,
      realizedPnl: 0,
      unrealizedPnl: 300,
      totalFees: 10,
      riskRatio: roundMoney(((99990 + 300) / 10580) * 100),
      status: "ACTIVE",
      updatedAt: now,
    },
    {
      id: "acc-beta-m1",
      accountNo: "SIM-B-2001",
      userId: "usr-beta-m1",
      tenantId: "tenant-beta",
      initialCapital: 50000,
      balance: 49995.5,
      availableFunds: 46425.5,
      frozenFunds: 0,
      usedMargin: 3570,
      realizedPnl: 0,
      unrealizedPnl: 180,
      totalFees: 4.5,
      riskRatio: roundMoney(((49995.5 + 180) / 3570) * 100),
      status: "ACTIVE",
      updatedAt: now,
    },
    {
      id: "acc-beta-m2",
      accountNo: "SIM-B-2002",
      userId: "usr-beta-m2",
      tenantId: "tenant-beta",
      initialCapital: 50000,
      balance: 50000,
      availableFunds: 50000,
      frozenFunds: 0,
      usedMargin: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalFees: 0,
      riskRatio: 9999,
      status: "ACTIVE",
      updatedAt: now,
    },
    {
      id: "acc-gamma-m1",
      accountNo: "SIM-G-3001",
      userId: "usr-gamma-m1",
      tenantId: "tenant-gamma",
      initialCapital: 30000,
      balance: 30000,
      availableFunds: 30000,
      frozenFunds: 0,
      usedMargin: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalFees: 0,
      riskRatio: 9999,
      status: "ACTIVE",
      updatedAt: now,
    },
  ];

  const positions: TradePosition[] = [
    {
      id: "pos-alpha-1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      direction: "LONG",
      quantity: 2,
      avgOpenPrice: 70.8,
      markPrice: 71.4,
      usedMargin: 7080,
      unrealizedPnl: 1200,
      updatedAt: now,
    },
    {
      id: "pos-alpha-2",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "BRENT",
      contractCode: "BRN2612",
      direction: "SHORT",
      quantity: 1,
      avgOpenPrice: 75.6,
      markPrice: 75.15,
      usedMargin: 3780,
      unrealizedPnl: 450,
      updatedAt: now,
    },
    {
      id: "pos-alpha-3",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m2",
      accountId: "acc-alpha-m2",
      instrumentCode: "GOLD",
      contractCode: "GC2612",
      direction: "LONG",
      quantity: 1,
      avgOpenPrice: 2642.0,
      markPrice: 2645.0,
      usedMargin: 10580,
      unrealizedPnl: 300,
      updatedAt: now,
    },
    {
      id: "pos-beta-1",
      tenantId: "tenant-beta",
      userId: "usr-beta-m1",
      accountId: "acc-beta-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      direction: "LONG",
      quantity: 1,
      avgOpenPrice: 71.22,
      markPrice: 71.4,
      usedMargin: 3570,
      unrealizedPnl: 180,
      updatedAt: now,
    },
  ];

  const orders: TradeOrder[] = [
    {
      id: "ord-seed-1",
      idempotencyKey: "seed-alpha-ord-1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      orderType: "MARKET",
      side: "BUY",
      positionEffect: "OPEN",
      quantity: 2,
      filledQuantity: 2,
      limitPrice: null,
      avgFillPrice: 70.8,
      frozenMargin: 0,
      frozenFee: 0,
      status: "FILLED",
      rejectReason: null,
      createdAt: earlier,
      updatedAt: earlier,
    },
    {
      id: "ord-seed-2",
      idempotencyKey: "seed-alpha-ord-2",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "BRENT",
      contractCode: "BRN2612",
      orderType: "MARKET",
      side: "SELL",
      positionEffect: "OPEN",
      quantity: 1,
      filledQuantity: 1,
      limitPrice: null,
      avgFillPrice: 75.6,
      frozenMargin: 0,
      frozenFee: 0,
      status: "FILLED",
      rejectReason: null,
      createdAt: earlier,
      updatedAt: earlier,
    },
    {
      id: "ord-seed-3",
      idempotencyKey: "seed-alpha-ord-3",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      orderType: "LIMIT",
      side: "BUY",
      positionEffect: "OPEN",
      quantity: 1,
      filledQuantity: 0,
      limitPrice: 69.5,
      avgFillPrice: null,
      frozenMargin: 3475,
      frozenFee: 4.5,
      status: "PENDING",
      rejectReason: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ord-seed-4",
      idempotencyKey: "seed-beta-ord-1",
      tenantId: "tenant-beta",
      userId: "usr-beta-m1",
      accountId: "acc-beta-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      orderType: "MARKET",
      side: "BUY",
      positionEffect: "OPEN",
      quantity: 1,
      filledQuantity: 1,
      limitPrice: null,
      avgFillPrice: 71.22,
      frozenMargin: 0,
      frozenFee: 0,
      status: "FILLED",
      rejectReason: null,
      createdAt: earlier,
      updatedAt: earlier,
    },
  ];

  const executions: TradeExecution[] = [
    {
      id: "exe-seed-1",
      orderId: "ord-seed-1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      side: "BUY",
      positionEffect: "OPEN",
      quantity: 2,
      price: 70.8,
      fee: 9.0,
      realizedPnl: 0,
      executedAt: earlier,
    },
    {
      id: "exe-seed-2",
      orderId: "ord-seed-2",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      accountId: "acc-alpha-m1",
      instrumentCode: "BRENT",
      contractCode: "BRN2612",
      side: "SELL",
      positionEffect: "OPEN",
      quantity: 1,
      price: 75.6,
      fee: 4.8,
      realizedPnl: 0,
      executedAt: earlier,
    },
    {
      id: "exe-seed-3",
      orderId: "ord-seed-4",
      tenantId: "tenant-beta",
      userId: "usr-beta-m1",
      accountId: "acc-beta-m1",
      instrumentCode: "WTI",
      contractCode: "CL2612",
      side: "BUY",
      positionEffect: "OPEN",
      quantity: 1,
      price: 71.22,
      fee: 4.5,
      realizedPnl: 0,
      executedAt: earlier,
    },
  ];

  const ledger: AccountLedgerEntry[] = [
    {
      id: "ldg-seed-1",
      accountId: "acc-alpha-m1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      type: "INITIAL_DEPOSIT",
      amount: 100000,
      balanceBefore: 0,
      balanceAfter: 100000,
      referenceId: "acc-alpha-m1",
      operatorId: "usr-alpha-admin",
      remark: "代理商开户初始化模拟虚拟资金",
      createdAt: muchEarlier,
    },
    {
      id: "ldg-seed-2",
      accountId: "acc-alpha-m1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      type: "REALIZED_PNL",
      amount: 620,
      balanceBefore: 100000,
      balanceAfter: 100620,
      referenceId: "exe-hist-0",
      operatorId: "MATCHING_ENGINE",
      remark: "CL2612 平仓已实现模拟盈亏",
      createdAt: earlier,
    },
    {
      id: "ldg-seed-3",
      accountId: "acc-alpha-m1",
      tenantId: "tenant-alpha",
      userId: "usr-alpha-m1",
      type: "FEE_CHARGE",
      amount: -22.8,
      balanceBefore: 100620,
      balanceAfter: 100597.2,
      referenceId: "ord-seed-1",
      operatorId: "MATCHING_ENGINE",
      remark: "累计模拟交易手续费扣除",
      createdAt: earlier,
    },
    {
      id: "ldg-seed-4",
      accountId: "acc-beta-m1",
      tenantId: "tenant-beta",
      userId: "usr-beta-m1",
      type: "INITIAL_DEPOSIT",
      amount: 50000,
      balanceBefore: 0,
      balanceAfter: 50000,
      referenceId: "acc-beta-m1",
      operatorId: "usr-beta-admin",
      remark: "鼎泰能源代理商初始化模拟虚拟资金",
      createdAt: muchEarlier,
    },
    {
      id: "ldg-seed-5",
      accountId: "acc-beta-m1",
      tenantId: "tenant-beta",
      userId: "usr-beta-m1",
      type: "FEE_CHARGE",
      amount: -4.5,
      balanceBefore: 50000,
      balanceAfter: 49995.5,
      referenceId: "ord-seed-4",
      operatorId: "MATCHING_ENGINE",
      remark: "CL2612 开仓模拟手续费",
      createdAt: earlier,
    },
  ];

  const riskEvents: TradeRiskEvent[] = [];

  const auditLogs: AdminAuditLog[] = [
    {
      id: "aud-seed-1",
      actorId: "usr-super-1",
      actorName: "平台总运营官",
      actorRole: "SUPER_ADMIN",
      tenantId: null,
      action: "TENANT_PROVISION",
      targetType: "TENANT",
      targetId: "tenant-alpha",
      detail: "开通一级代理商 [华盛国际期货代理]，绑定独立域名 alpha.meridian.local",
      createdAt: muchEarlier,
    },
    {
      id: "aud-seed-2",
      actorId: "usr-super-1",
      actorName: "平台总运营官",
      actorRole: "SUPER_ADMIN",
      tenantId: null,
      action: "TENANT_PROVISION",
      targetType: "TENANT",
      targetId: "tenant-beta",
      detail: "开通一级代理商 [鼎泰能源投研]，限制仅可交易 WTI / BRENT 能源品种",
      createdAt: muchEarlier,
    },
  ];

  const matchingRules: MatchingRuleConfig = {
    pauseOnFeedDisconnect: true,
    maxFeedStaleSeconds: 15,
    autoLiquidationEnabled: true,
    liquidationRiskThresholdPct: 100,
    marginWarningThresholdPct: 140,
    simulatedSlippageTicks: 0,
    allowPartialFills: false,
  };

  return {
    tenants,
    users,
    instruments,
    accounts,
    ledger,
    orders,
    executions,
    positions,
    riskEvents,
    auditLogs,
    approvals: [],
    matchingRules,
  };
}

class PlatformStore {
  public db: PlatformDatabase;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_FILE)) {
      try {
        const raw = fs.readFileSync(STORE_FILE, "utf-8");
        this.db = JSON.parse(raw) as PlatformDatabase;
        if (!Array.isArray(this.db.approvals)) {
          this.db.approvals = [];
        }
        this.ensureSeedIntegrity();
      } catch (err) {
        console.error("[Store] Failed to parse existing store, initializing seed:", err);
        this.db = createSeedDatabase();
        this.persistImmediate();
      }
    } else {
      this.db = createSeedDatabase();
      this.persistImmediate();
    }
  }

  private ensureSeedIntegrity(): void {
    let changed = false;
    const hasGammaAdmin = this.db.users.some(
      (u) => u.id === "usr-gamma-admin" || u.email.toLowerCase() === "admin@gamma.meridian.local"
    );
    if (!hasGammaAdmin && this.db.tenants.some((t) => t.id === "tenant-gamma")) {
      this.db.users.push({
        id: "usr-gamma-admin",
        tenantId: "tenant-gamma",
        email: "admin@gamma.meridian.local",
        name: "陈星河 (星河二级主理人)",
        role: "AGENT_L2",
        status: "ACTIVE",
        permissions: ["members:manage", "accounts:adjust", "orders:read", "reports:read", "brand:edit", "staff:manage"],
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword("Meridian@2026"),
      });
      changed = true;
    }
    if (changed) {
      this.persistImmediate();
    }
  }

  public persist(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistImmediate();
    }, 250);
  }

  public persistImmediate(): void {
    try {
      const tmpPath = `${STORE_FILE}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.db, null, 2), "utf-8");
      fs.renameSync(tmpPath, STORE_FILE);
    } catch (err) {
      console.error("[Store] Failed to persist database:", err);
    }
  }

  public resetSeed(): void {
    this.db = createSeedDatabase();
    this.persistImmediate();
  }

  public sanitizeUser(user: StoredUser): User {
    const { passwordHash: _pw, ...safe } = user;
    return safe;
  }

  public addAuditLog(entry: Omit<AdminAuditLog, "id" | "createdAt">): void {
    this.db.auditLogs.unshift({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    });
    if (this.db.auditLogs.length > 500) {
      this.db.auditLogs.length = 500;
    }
    this.persist();
  }
}

export const store = new PlatformStore();
