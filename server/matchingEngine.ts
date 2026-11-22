import crypto from "crypto";
import type {
  AccountLedgerEntry,
  FuturesInstrument,
  InstrumentCode,
  MarketQuote,
  OrderSide,
  OrderType,
  PositionDirection,
  PositionEffect,
  TradeExecution,
  TradeOrder,
  TradePosition,
  TradingAccount,
  User,
} from "../types";
import { addMoney, roundMoney, roundPrice, subMoney } from "./decimal";
import { marketEngine } from "./marketEngine";
import { canMutateTenantFunds, resolveEffectiveRole } from "./rbac";
import { store } from "./store";

export interface SubmitOrderInput {
  user: User;
  instrumentCode: InstrumentCode;
  orderType: OrderType;
  side: OrderSide;
  positionEffect: PositionEffect;
  quantity: number;
  limitPrice?: number | null;
  idempotencyKey: string;
}

export interface OrderSubmitResult {
  order: TradeOrder;
  execution?: TradeExecution;
  account: TradingAccount;
  deduplicated: boolean;
}

function appendLedger(entry: Omit<AccountLedgerEntry, "id" | "createdAt">): void {
  store.db.ledger.unshift({
    id: `ldg-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  });
}

function recalculateAccountMetrics(account: TradingAccount): void {
  const openPositions = store.db.positions.filter((p) => p.accountId === account.id && p.quantity > 0);
  const usedMargin = roundMoney(openPositions.reduce((sum, p) => addMoney(sum, p.usedMargin), 0));
  const unrealizedPnl = roundMoney(openPositions.reduce((sum, p) => addMoney(sum, p.unrealizedPnl), 0));
  const pendingOrders = store.db.orders.filter(
    (o) => o.accountId === account.id && (o.status === "PENDING" || o.status === "PARTIAL_FILLED")
  );
  const frozenFunds = roundMoney(
    pendingOrders.reduce((sum, o) => addMoney(sum, addMoney(o.frozenMargin, o.frozenFee)), 0)
  );

  account.usedMargin = usedMargin;
  account.unrealizedPnl = unrealizedPnl;
  account.frozenFunds = frozenFunds;
  account.availableFunds = roundMoney(account.balance - usedMargin - frozenFunds);

  const equity = addMoney(account.balance, unrealizedPnl);
  account.riskRatio = usedMargin > 0 ? roundMoney((equity / usedMargin) * 100) : 9999;
  account.updatedAt = new Date().toISOString();
}

function getInstrument(code: InstrumentCode): FuturesInstrument {
  const inst = store.db.instruments.find((i) => i.code === code);
  if (!inst) throw new Error(`未找到期货品种 ${code}`);
  return inst;
}

function executeFill(
  order: TradeOrder,
  account: TradingAccount,
  inst: FuturesInstrument,
  fillPrice: number
): TradeExecution {
  const now = new Date().toISOString();
  const fillQty = order.quantity - order.filledQuantity;
  const notional = fillPrice * inst.multiplier * fillQty;
  const requiredMargin = roundMoney(notional * inst.initialMarginRate);
  const fee = roundMoney(inst.feePerLot * fillQty);

  let realizedPnl = 0;

  if (order.positionEffect === "OPEN") {
    const direction: PositionDirection = order.side === "BUY" ? "LONG" : "SHORT";
    let pos = store.db.positions.find(
      (p) => p.accountId === account.id && p.instrumentCode === inst.code && p.direction === direction
    );

    if (pos) {
      const totalQty = pos.quantity + fillQty;
      const weightedOpen = (pos.avgOpenPrice * pos.quantity + fillPrice * fillQty) / totalQty;
      pos.avgOpenPrice = roundPrice(weightedOpen, inst.pricePrecision);
      pos.quantity = totalQty;
      pos.markPrice = fillPrice;
      pos.usedMargin = addMoney(pos.usedMargin, requiredMargin);
      pos.unrealizedPnl = roundMoney(
        (direction === "LONG" ? fillPrice - pos.avgOpenPrice : pos.avgOpenPrice - fillPrice) *
          inst.multiplier *
          totalQty
      );
      pos.updatedAt = now;
    } else {
      pos = {
        id: `pos-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: order.tenantId,
        userId: order.userId,
        accountId: account.id,
        instrumentCode: inst.code,
        contractCode: inst.activeContract,
        direction,
        quantity: fillQty,
        avgOpenPrice: fillPrice,
        markPrice: fillPrice,
        usedMargin: requiredMargin,
        unrealizedPnl: 0,
        updatedAt: now,
      };
      store.db.positions.unshift(pos);
    }

    // Charge open trading fee
    const balanceBeforeFee = account.balance;
    account.balance = subMoney(account.balance, fee);
    account.totalFees = addMoney(account.totalFees, fee);
    appendLedger({
      accountId: account.id,
      tenantId: account.tenantId,
      userId: account.userId,
      type: "FEE_CHARGE",
      amount: -fee,
      balanceBefore: balanceBeforeFee,
      balanceAfter: account.balance,
      referenceId: order.id,
      operatorId: "MATCHING_ENGINE",
      remark: `${inst.activeContract} ${direction === "LONG" ? "买入开多" : "卖出开空"} ${fillQty} 手手续费`,
    });
  } else {
    // CLOSE
    const targetDirection: PositionDirection = order.side === "SELL" ? "LONG" : "SHORT";
    const posIndex = store.db.positions.findIndex(
      (p) =>
        p.accountId === account.id &&
        p.instrumentCode === inst.code &&
        p.direction === targetDirection &&
        p.quantity >= fillQty
    );

    if (posIndex === -1) {
      throw new Error(`平仓失败：${inst.code} ${targetDirection === "LONG" ? "多头" : "空头"}持仓手数不足`);
    }

    const pos = store.db.positions[posIndex];
    const diff = targetDirection === "LONG" ? fillPrice - pos.avgOpenPrice : pos.avgOpenPrice - fillPrice;
    realizedPnl = roundMoney(diff * inst.multiplier * fillQty);

    const releasedMargin = roundMoney((pos.usedMargin / pos.quantity) * fillQty);
    pos.quantity -= fillQty;
    pos.usedMargin = subMoney(pos.usedMargin, releasedMargin);
    pos.markPrice = fillPrice;

    if (pos.quantity <= 0) {
      store.db.positions.splice(posIndex, 1);
    } else {
      const remDiff = targetDirection === "LONG" ? fillPrice - pos.avgOpenPrice : pos.avgOpenPrice - fillPrice;
      pos.unrealizedPnl = roundMoney(remDiff * inst.multiplier * pos.quantity);
      pos.updatedAt = now;
    }

    // Settle realized PnL
    if (realizedPnl !== 0) {
      const balBeforePnl = account.balance;
      account.balance = addMoney(account.balance, realizedPnl);
      account.realizedPnl = addMoney(account.realizedPnl, realizedPnl);
      appendLedger({
        accountId: account.id,
        tenantId: account.tenantId,
        userId: account.userId,
        type: "REALIZED_PNL",
        amount: realizedPnl,
        balanceBefore: balBeforePnl,
        balanceAfter: account.balance,
        referenceId: order.id,
        operatorId: "MATCHING_ENGINE",
        remark: `${inst.activeContract} 平仓已实现模拟盈亏 (${fillQty} 手 @ ${fillPrice})`,
      });
    }

    // Charge close fee
    const balBeforeFee = account.balance;
    account.balance = subMoney(account.balance, fee);
    account.totalFees = addMoney(account.totalFees, fee);
    appendLedger({
      accountId: account.id,
      tenantId: account.tenantId,
      userId: account.userId,
      type: "FEE_CHARGE",
      amount: -fee,
      balanceBefore: balBeforeFee,
      balanceAfter: account.balance,
      referenceId: order.id,
      operatorId: "MATCHING_ENGINE",
      remark: `${inst.activeContract} 平仓手续费 (${fillQty} 手)`,
    });
  }

  order.filledQuantity = order.quantity;
  order.avgFillPrice = fillPrice;
  order.frozenMargin = 0;
  order.frozenFee = 0;
  order.status = "FILLED";
  order.updatedAt = now;

  const execution: TradeExecution = {
    id: `exe-${crypto.randomUUID().slice(0, 8)}`,
    orderId: order.id,
    tenantId: order.tenantId,
    userId: order.userId,
    accountId: account.id,
    instrumentCode: inst.code,
    contractCode: inst.activeContract,
    side: order.side,
    positionEffect: order.positionEffect,
    quantity: fillQty,
    price: fillPrice,
    fee,
    realizedPnl,
    executedAt: now,
  };

  store.db.executions.unshift(execution);
  recalculateAccountMetrics(account);
  return execution;
}

class SimulationMatchingEngine {
  public submitOrder(input: SubmitOrderInput): OrderSubmitResult {
    const { user, instrumentCode, orderType, side, positionEffect, quantity, limitPrice, idempotencyKey } = input;

    if (!user.tenantId) {
      throw new Error("平台总管理员账户不可直接下单，请切换至具体会员交易账户");
    }

    const account = store.db.accounts.find((a) => a.userId === user.id && a.tenantId === user.tenantId);
    if (!account) {
      throw new Error("未找到有效模拟交易账户");
    }

    // 1. Idempotency check
    const existing = store.db.orders.find(
      (o) => o.idempotencyKey === idempotencyKey && o.userId === user.id && o.tenantId === user.tenantId
    );
    if (existing) {
      const existingExec = store.db.executions.find((e) => e.orderId === existing.id);
      return { order: existing, execution: existingExec, account, deduplicated: true };
    }

    const now = new Date().toISOString();
    const inst = getInstrument(instrumentCode);

    // 2. Market feed & instrument trading protection
    const feedCheck = marketEngine.isFeedTradable();
    if (!feedCheck.ok) {
      store.db.riskEvents.unshift({
        id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: user.tenantId,
        userId: user.id,
        accountId: account.id,
        eventType: "FEED_HALT_REJECT",
        detail: `${inst.code} 下单被拒绝: ${feedCheck.reason}`,
        createdAt: now,
      });
      store.persist();
      throw new Error(feedCheck.reason);
    }

    if (!inst.tradingEnabled) {
      throw new Error(`品种 ${inst.name} (${inst.code}) 当前已被平台暂停交易`);
    }

    const tenant = store.db.tenants.find((t) => t.id === user.tenantId);
    if (!tenant || tenant.status !== "ACTIVE") {
      throw new Error("所属代理商状态异常，暂停交易");
    }

    if (!tenant.allowedInstruments.includes(instrumentCode)) {
      throw new Error(`代理商 [${tenant.name}] 未开通 ${inst.name} 交易权限`);
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > inst.maxLotsPerOrder) {
      throw new Error(`下单手数必须为 1 - ${inst.maxLotsPerOrder} 的整数`);
    }

    if (account.status !== "ACTIVE") {
      throw new Error("模拟交易账户已冻结");
    }

    const quote = marketEngine.getQuote(instrumentCode);
    if (!quote || quote.lastPrice === null || quote.dataClassification === "UNAVAILABLE") {
      throw new Error("暂无有效行情报价");
    }

    const effectiveAsk = quote.askPrice ?? quote.lastPrice;
    const effectiveBid = quote.bidPrice ?? quote.lastPrice;
    const slippage = store.db.matchingRules.simulatedSlippageTicks * inst.tickSize;
    const marketExecPrice =
      side === "BUY"
        ? roundPrice(effectiveAsk + slippage, inst.pricePrecision)
        : roundPrice(effectiveBid - slippage, inst.pricePrecision);

    if (orderType === "LIMIT") {
      if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        throw new Error("限价单必须填写有效的委托价格");
      }
    }

    const effectivePrice =
      orderType === "MARKET" ? marketExecPrice : roundPrice(limitPrice!, inst.pricePrecision);

    // Pre-trade checks
    if (positionEffect === "OPEN") {
      const requiredMargin = roundMoney(effectivePrice * inst.multiplier * quantity * inst.initialMarginRate);
      const fee = roundMoney(inst.feePerLot * quantity);
      const totalNeeded = addMoney(requiredMargin, fee);

      if (account.availableFunds < totalNeeded) {
        throw new Error(
          `可用模拟资金不足：需 $${totalNeeded.toLocaleString("en-US", { minimumFractionDigits: 2 })} (保证金 $${requiredMargin.toFixed(2)} + 手续费 $${fee.toFixed(2)})，当前可用 $${account.availableFunds.toFixed(2)}`
        );
      }
    } else {
      const targetDirection: PositionDirection = side === "SELL" ? "LONG" : "SHORT";
      const heldQty = store.db.positions
        .filter((p) => p.accountId === account.id && p.instrumentCode === inst.code && p.direction === targetDirection)
        .reduce((s, p) => s + p.quantity, 0);

      // Account for pending close orders already targeting this position
      const pendingCloseQty = store.db.orders
        .filter(
          (o) =>
            o.accountId === account.id &&
            o.instrumentCode === inst.code &&
            o.positionEffect === "CLOSE" &&
            o.side === side &&
            o.status === "PENDING"
        )
        .reduce((s, o) => s + (o.quantity - o.filledQuantity), 0);

      if (heldQty - pendingCloseQty < quantity) {
        throw new Error(`可平${targetDirection === "LONG" ? "多" : "空"}仓不足 (可用 ${Math.max(0, heldQty - pendingCloseQty)} 手)`);
      }
    }

    // Check if limit order crosses market immediately
    const limitTriggeredImmediately =
      orderType === "LIMIT" &&
      ((side === "BUY" && effectivePrice >= effectiveAsk) || (side === "SELL" && effectivePrice <= effectiveBid));

    const shouldFillNow = orderType === "MARKET" || limitTriggeredImmediately;

    const order: TradeOrder = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey,
      tenantId: user.tenantId,
      userId: user.id,
      accountId: account.id,
      instrumentCode: inst.code,
      contractCode: inst.activeContract,
      orderType,
      side,
      positionEffect,
      quantity,
      filledQuantity: 0,
      limitPrice: orderType === "LIMIT" ? effectivePrice : null,
      avgFillPrice: null,
      frozenMargin: 0,
      frozenFee: 0,
      status: "PENDING",
      rejectReason: null,
      createdAt: now,
      updatedAt: now,
    };

    store.db.orders.unshift(order);

    if (shouldFillNow) {
      const fillPrice = orderType === "MARKET" ? marketExecPrice : marketExecPrice;
      const execution = executeFill(order, account, inst, fillPrice);
      store.persist();
      return { order, execution, account, deduplicated: false };
    } else {
      // Freeze margin & fee for pending OPEN limit order
      if (positionEffect === "OPEN") {
        order.frozenMargin = roundMoney(effectivePrice * inst.multiplier * quantity * inst.initialMarginRate);
        order.frozenFee = roundMoney(inst.feePerLot * quantity);
      }
      recalculateAccountMetrics(account);
      store.persist();
      return { order, account, deduplicated: false };
    }
  }

  public cancelOrder(user: User, orderId: string): { order: TradeOrder; account: TradingAccount } {
    const order = store.db.orders.find((o) => o.id === orderId);
    if (!order) {
      throw new Error("未找到该委托订单");
    }

    // Enforce tenant & user boundary via canonical RBAC
    const effectiveRole = resolveEffectiveRole(user, store.db.tenants);
    if (effectiveRole !== "SUPER_ADMIN") {
      if (order.tenantId !== user.tenantId) {
        store.db.riskEvents.unshift({
          id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: order.tenantId,
          userId: user.id,
          accountId: order.accountId,
          eventType: "ISOLATION_DENIED",
          detail: `跨租户撤单越权拦截：用户 ${user.id} (${user.tenantId}) 尝试撤销租户 ${order.tenantId} 的订单 ${order.id}`,
          createdAt: new Date().toISOString(),
        });
        store.persist();
        throw new Error("无权操作其他代理商的订单");
      }
      if (effectiveRole === "MEMBER" && order.userId !== user.id) {
        throw new Error("无权撤销其他会员的委托订单");
      }
    }

    if (order.status !== "PENDING" && order.status !== "PARTIAL_FILLED") {
      throw new Error(`当前订单状态为 ${order.status}，无法撤单`);
    }

    order.status = "CANCELLED";
    order.frozenMargin = 0;
    order.frozenFee = 0;
    order.updatedAt = new Date().toISOString();

    const account = store.db.accounts.find((a) => a.id === order.accountId)!;
    recalculateAccountMetrics(account);
    store.persist();
    return { order, account };
  }

  public adjustAccountFunds(
    actor: User,
    accountId: string,
    amount: number,
    remark: string
  ): TradingAccount {
    const account = store.db.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new Error("未找到模拟交易账户");
    }

    if (!canMutateTenantFunds(actor, account.tenantId, store.db.tenants)) {
      store.db.riskEvents.unshift({
        id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: account.tenantId,
        userId: actor.id,
        accountId: account.id,
        eventType: "ISOLATION_DENIED",
        detail: `越权资金调整拦截：操作者 ${actor.id} (${actor.role}) 尝试修改租户 ${account.tenantId} 账户 ${account.accountNo}`,
        createdAt: new Date().toISOString(),
      });
      store.persist();
      throw new Error("越权拦截：无权调整该代理商或下级代理商会员的模拟资金");
    }

    const rounded = roundMoney(amount);
    if (!Number.isFinite(rounded) || rounded === 0) {
      throw new Error("资金调整金额不能为 0");
    }

    if (rounded < 0 && account.availableFunds + rounded < 0) {
      throw new Error("扣减金额超过当前可用模拟资金");
    }

    const balBefore = account.balance;
    account.balance = addMoney(account.balance, rounded);
    if (rounded > 0 && account.initialCapital === 0) {
      account.initialCapital = rounded;
    }

    appendLedger({
      accountId: account.id,
      tenantId: account.tenantId,
      userId: account.userId,
      type: rounded > 0 ? "AGENT_ADJUST_CREDIT" : "AGENT_ADJUST_DEBIT",
      amount: rounded,
      balanceBefore: balBefore,
      balanceAfter: account.balance,
      referenceId: `ADJ-${Date.now()}`,
      operatorId: actor.id,
      remark: remark.trim() || (rounded > 0 ? "管理员增配模拟虚拟资金" : "管理员扣减模拟虚拟资金"),
    });

    recalculateAccountMetrics(account);
    store.addAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      tenantId: actor.tenantId,
      action: "ACCOUNT_FUNDS_ADJUST",
      targetType: "TRADING_ACCOUNT",
      targetId: account.id,
      detail: `调整账户 ${account.accountNo} 模拟资金 ${rounded > 0 ? "+" : ""}${rounded.toFixed(2)} USD；备注：${remark}`,
    });
    store.persist();
    return account;
  }

  public onMarketTick(quotes: MarketQuote[]): {
    triggeredOrders: TradeOrder[];
    updatedAccounts: TradingAccount[];
  } {
    const quoteMap = new Map<InstrumentCode, MarketQuote>(quotes.map((q) => [q.instrumentCode, q]));
    const triggeredOrders: TradeOrder[] = [];
    const updatedAccountIds = new Set<string>();
    const now = new Date().toISOString();

    // 1. Evaluate pending limit orders (only when market feed is valid & tradable)
    const tradable = marketEngine.isFeedTradable();
    if (tradable.ok) {
      const pendingOrders = store.db.orders.filter((o) => o.status === "PENDING");
      for (const order of pendingOrders) {
        const q = quoteMap.get(order.instrumentCode);
        if (!q || q.lastPrice === null || order.limitPrice === null) continue;
        const ask = q.askPrice ?? q.lastPrice;
        const bid = q.bidPrice ?? q.lastPrice;

        const crossed =
          (order.side === "BUY" && ask <= order.limitPrice) ||
          (order.side === "SELL" && bid >= order.limitPrice);

        if (crossed) {
          const account = store.db.accounts.find((a) => a.id === order.accountId);
          const inst = store.db.instruments.find((i) => i.code === order.instrumentCode);
          if (!account || !inst || !inst.tradingEnabled) continue;

          try {
            const fillPrice = order.side === "BUY" ? Math.min(order.limitPrice, ask) : Math.max(order.limitPrice, bid);
            const roundedFill = roundPrice(fillPrice, inst.pricePrecision);
            if (order.positionEffect === "OPEN") {
              const remQty = Math.max(1, order.quantity - order.filledQuantity);
              const reqMargin = roundMoney(roundedFill * inst.multiplier * remQty * inst.initialMarginRate);
              const reqFee = roundMoney(inst.feePerLot * remQty);
              const maxCover = addMoney(account.availableFunds, addMoney(order.frozenMargin, order.frozenFee));
              if (maxCover + 1e-6 < addMoney(reqMargin, reqFee)) {
                throw new Error("限价成交跳空导致可用资金不足以覆盖所需保证金与手续费");
              }
            }
            executeFill(order, account, inst, roundedFill);
            triggeredOrders.push(order);
            updatedAccountIds.add(account.id);
          } catch (err: any) {
            order.status = "REJECTED";
            order.rejectReason = err?.message || "限价撮合校验失败";
            order.frozenMargin = 0;
            order.frozenFee = 0;
            order.updatedAt = now;
            recalculateAccountMetrics(account);
            updatedAccountIds.add(account.id);
          }
        }
      }
    }

    // 2. Revalue all open positions mark-to-market when valid price exists
    for (const pos of store.db.positions) {
      const q = quoteMap.get(pos.instrumentCode);
      const inst = store.db.instruments.find((i) => i.code === pos.instrumentCode);
      if (!q || q.lastPrice === null || !inst) continue;

      const mark = q.lastPrice;
      const diff = pos.direction === "LONG" ? mark - pos.avgOpenPrice : pos.avgOpenPrice - mark;
      pos.markPrice = mark;
      pos.unrealizedPnl = roundMoney(diff * inst.multiplier * pos.quantity);
      pos.updatedAt = now;
      updatedAccountIds.add(pos.accountId);
    }

    // 3. Recalculate account metrics & check forced liquidation
    for (const account of store.db.accounts) {
      recalculateAccountMetrics(account);

      if (
        tradable.ok &&
        store.db.matchingRules.autoLiquidationEnabled &&
        account.usedMargin > 0 &&
        account.riskRatio <= store.db.matchingRules.liquidationRiskThresholdPct
      ) {
        const accountPositions = store.db.positions.filter((p) => p.accountId === account.id);
        for (const pos of accountPositions) {
          const q = quoteMap.get(pos.instrumentCode);
          const inst = store.db.instruments.find((i) => i.code === pos.instrumentCode);
          if (!q || q.lastPrice === null || !inst) continue;

          const liqOrder: TradeOrder = {
            id: `ord-liq-${crypto.randomUUID().slice(0, 6)}`,
            idempotencyKey: `liq-${pos.id}-${Date.now()}`,
            tenantId: pos.tenantId,
            userId: pos.userId,
            accountId: account.id,
            instrumentCode: pos.instrumentCode,
            contractCode: pos.contractCode,
            orderType: "MARKET",
            side: pos.direction === "LONG" ? "SELL" : "BUY",
            positionEffect: "CLOSE",
            quantity: pos.quantity,
            filledQuantity: 0,
            limitPrice: null,
            avgFillPrice: null,
            frozenMargin: 0,
            frozenFee: 0,
            status: "PENDING",
            rejectReason: "风险率触发模拟强制平仓",
            createdAt: now,
            updatedAt: now,
          };
          store.db.orders.unshift(liqOrder);
          const fillPrice = pos.direction === "LONG" ? (q.bidPrice ?? q.lastPrice) : (q.askPrice ?? q.lastPrice);
          executeFill(liqOrder, account, inst, fillPrice);
          store.db.riskEvents.unshift({
            id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: account.tenantId,
            userId: account.userId,
            accountId: account.id,
            eventType: "FORCED_LIQUIDATION",
            detail: `账户 ${account.accountNo} 风险率触及 ${store.db.matchingRules.liquidationRiskThresholdPct}% 阈值，系统已模拟强平 ${pos.contractCode} ${pos.quantity} 手`,
            createdAt: now,
          });
        }
        updatedAccountIds.add(account.id);
      }
    }

    if (triggeredOrders.length > 0) {
      store.persist();
    }

    const updatedAccounts = store.db.accounts.filter((a) => updatedAccountIds.has(a.id));
    return {
      triggeredOrders,
      updatedAccounts,
    };
  }
}

export const matchingEngine = new SimulationMatchingEngine();
