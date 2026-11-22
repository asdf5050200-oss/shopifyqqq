import crypto from "crypto";
import express from "express";
import type {
  ApprovalRequest,
  DemoPresetAccount,
  FeedHealthStatus,
  FuturesInstrument,
  InstrumentCode,
  MatchingRuleConfig,
  Tenant,
  Timeframe,
} from "../types";
import {
  authenticateCredentials,
  clearSessionCookie,
  forceLogoutUserSessions,
  getClientIp,
  isDemoModeAllowed,
  logoutCurrentSession,
  requireAuth,
  requirePermission,
  requireSuperAdmin,
  revokeSessionByActor,
  setSessionCookie,
  type AuthRequest,
} from "./authService";
import { roundMoney } from "./decimal";
import { marketEngine } from "./marketEngine";
import { matchingEngine } from "./matchingEngine";
import {
  canMutateTenantConfig,
  canViewTenant,
  getEffectivePermissions,
  hasPermission,
  resolveEffectiveRole,
} from "./rbac";
import { sessionRepository, toSessionSummary, wsTicketStore } from "./sessionRepository";
import { STORE_FILE, hashPassword, store } from "./store";

const HIGH_VALUE_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD = 50_000;

export function createApiRouter(getWsClientCount: () => number): express.Router {
  const router = express.Router();

  // ================= PUBLIC HEALTH / STATUS ENDPOINTS =================
  router.get(["/health", "/system/status"], (_req, res) => {
    const health = marketEngine.getHealth(getWsClientCount(), STORE_FILE);
    res.json({
      status: "ok",
      app: {
        name: "汇通财经",
        shortName: "汇通财经",
        pwaEnabled: true,
        displayMode: "standalone",
        manifestUrl: "/manifest.webmanifest",
        iconUrl: "/assets/aistudio/image_2330aaf1.png",
      },
      market: {
        mode: health.mode,
        status: health.status,
        feedState: health.feedState,
        liveVerified: health.liveVerified,
        lastTickAt: health.lastTickAt,
        latencyMs: health.latencyMs,
        wsConnectedClients: health.wsConnectedClients,
        licenseStatus: health.collector.licenseStatus,
        redistributionAllowed: health.collector.redistributionAllowed,
      },
    });
  });

  router.get("/app/config", (_req, res) => {
    res.json({
      name: "汇通财经 · 国际模拟期货云平台",
      shortName: "汇通财经",
      logoUrl: "/assets/aistudio/image_2330aaf1.png",
      demoModeEnabled: isDemoModeAllowed(),
      isDevEnvironment: (process.env.NODE_ENV || "development").trim().toLowerCase() !== "production",
      supportedRoles: [
        "SUPER_ADMIN",
        "PLATFORM_OPS",
        "RISK_OFFICER",
        "FINANCE_OFFICER",
        "AGENT_L1",
        "AGENT_L2",
        "AGENT_STAFF",
        "SUPPORT",
        "MEMBER",
      ],
    });
  });

  // ================= AUTHENTICATION & SESSION ENDPOINTS =================
  router.get("/auth/presets", (_req, res) => {
    if (!isDemoModeAllowed()) {
      res.json({ demoEnabled: false, presets: [] });
      return;
    }

    const presets: DemoPresetAccount[] = [
      {
        id: "preset-super",
        label: "平台总运营官",
        roleLabel: "平台总后台",
        tenantName: "汇通财经全局中枢",
        userId: "usr-super-1",
        role: "SUPER_ADMIN",
      },
      {
        id: "preset-alpha-admin",
        label: "林致远 (一级代理 A)",
        roleLabel: "一级代理后台",
        tenantName: "华盛国际期货代理",
        userId: "usr-alpha-admin",
        role: "AGENT_L1",
      },
      {
        id: "preset-beta-admin",
        label: "周明辉 (一级代理 B)",
        roleLabel: "一级代理后台",
        tenantName: "鼎泰能源投研",
        userId: "usr-beta-admin",
        role: "AGENT_L1",
      },
      {
        id: "preset-gamma-admin",
        label: "陈星河 (二级代理 C)",
        roleLabel: "二级代理后台",
        tenantName: "星河大宗商品 (二级代理)",
        userId: "usr-gamma-admin",
        role: "AGENT_L2",
      },
      {
        id: "preset-alpha-m1",
        label: "张伟 (代理 A 会员)",
        roleLabel: "会员交易端",
        tenantName: "华盛国际期货代理",
        userId: "usr-alpha-m1",
        role: "MEMBER",
      },
      {
        id: "preset-beta-m1",
        label: "王强 (代理 B 会员)",
        roleLabel: "会员交易端",
        tenantName: "鼎泰能源投研",
        userId: "usr-beta-m1",
        role: "MEMBER",
      },
    ];
    res.json({ demoEnabled: true, presets });
  });

  router.post("/auth/switch-session", (req, res) => {
    if (!isDemoModeAllowed()) {
      store.addAuditLog({
        actorId: "ANONYMOUS",
        actorName: "BLOCKED_DEMO_SWITCH",
        actorRole: "MEMBER",
        tenantId: null,
        action: "DEMO_SWITCH_BLOCKED",
        targetType: "AUTH",
        targetId: String(req.body?.userId || "UNKNOWN"),
        detail: `已拦截免密演示切号请求 (NODE_ENV=${process.env.NODE_ENV || "development"}, DEV_DEMO_MODE=${process.env.DEV_DEMO_MODE || "false"})`,
      });
      res.status(403).json({
        error: "安全策略拦截：当前运行环境已禁用免密演示登录 (/api/auth/switch-session)",
      });
      return;
    }

    const { userId } = req.body || {};
    const target = store.db.users.find((u) => u.id === userId && u.status === "ACTIVE");
    if (!target) {
      res.status(404).json({ error: "目标演示账户不存在或已停用" });
      return;
    }
    const tenant = target.tenantId ? store.db.tenants.find((t) => t.id === target.tenantId) ?? null : null;
    const effectiveRole = resolveEffectiveRole(target, store.db.tenants);
    if (tenant && tenant.status === "SUSPENDED" && effectiveRole !== "SUPER_ADMIN") {
      res.status(403).json({ error: `代理商 [${tenant.name}] 当前已被停用，无法登录` });
      return;
    }

    const issued = sessionRepository.create({
      userId: target.id,
      tenantId: target.tenantId,
      role: effectiveRole,
      ip: getClientIp(req),
      userAgent: String(req.headers["user-agent"] || "dev-demo"),
    });

    store.addAuditLog({
      actorId: target.id,
      actorName: target.name,
      actorRole: effectiveRole,
      tenantId: target.tenantId,
      action: "DEV_DEMO_SWITCH_LOGIN",
      targetType: "SESSION",
      targetId: issued.record.id,
      detail: `本地开发模式 (DEV_DEMO_MODE=true) 切换身份为 ${effectiveRole}`,
    });

    setSessionCookie(req, res, issued.rawToken, issued.record.expiresAt);
    res.json({
      sessionId: issued.record.id,
      expiresAt: issued.record.expiresAt,
      token: issued.rawToken,
      user: store.sanitizeUser(target),
      effectiveRole,
      permissions: getEffectivePermissions(target, store.db.tenants),
      tenant,
    });
  });

  router.post("/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      res.status(400).json({ error: "请输入邮箱与密码" });
      return;
    }

    const result = authenticateCredentials(email, password, {
      ip: getClientIp(req),
      userAgent: String(req.headers["user-agent"] || "unknown"),
    });

    if (result.ok === false) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    setSessionCookie(req, res, result.rawToken, result.ctx.session.expiresAt);
    res.json({
      sessionId: result.ctx.session.id,
      expiresAt: result.ctx.session.expiresAt,
      token: result.rawToken,
      user: result.ctx.user,
      effectiveRole: result.ctx.effectiveRole,
      permissions: result.ctx.permissions,
      tenant: result.ctx.tenant,
    });
  });

  router.post("/auth/logout", requireAuth, (req: AuthRequest, res) => {
    logoutCurrentSession(req.auth!);
    clearSessionCookie(req, res);
    res.json({ ok: true, message: "已安全退出登录，当前会话已吊销" });
  });

  router.post("/auth/ws-ticket", requireAuth, (req: AuthRequest, res) => {
    const { ticket, expiresAt } = wsTicketStore.issue(req.auth!.session.id, req.auth!.user.id);
    res.json({ ticket, expiresAt });
  });

  router.get("/auth/me", requireAuth, (req: AuthRequest, res) => {
    res.json({
      sessionId: req.auth!.session.id,
      expiresAt: req.auth!.session.expiresAt,
      user: req.auth!.user,
      effectiveRole: req.auth!.effectiveRole,
      permissions: req.auth!.permissions,
      tenant: req.auth!.tenant,
    });
  });

  router.get("/auth/sessions", requireAuth, (req: AuthRequest, res) => {
    const list = sessionRepository.listActiveByUserId(req.auth!.user.id);
    res.json({
      sessions: list.map((rec) =>
        toSessionSummary(rec, req.auth!.session.id, {
          name: req.auth!.user.name,
          email: req.auth!.user.email,
        })
      ),
    });
  });

  router.delete("/auth/sessions/:sessionId", requireAuth, (req: AuthRequest, res) => {
    const result = revokeSessionByActor(req.auth!, String(req.params.sessionId), "USER_SESSION_REVOKE");
    if (!result.ok) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    if (String(req.params.sessionId) === req.auth!.session.id) {
      clearSessionCookie(req, res);
    }
    res.json({ ok: true });
  });

  // ================= AUTHENTICATED MARKET DATA ENDPOINTS =================
  router.get("/market/quotes", requireAuth, requirePermission("market:quotes:read"), (req: AuthRequest, res) => {
    const { effectiveRole, tenant } = req.auth!;
    const health = marketEngine.getHealth(getWsClientCount(), STORE_FILE);
    const isInternalMonitor =
      effectiveRole === "SUPER_ADMIN" || effectiveRole === "PLATFORM_OPS" || effectiveRole === "RISK_OFFICER";
    const licenseRestricted =
      health.mode === "PRODUCTION_REAL" && !health.collector.redistributionAllowed && !isInternalMonitor;

    const allowedSet = tenant ? new Set(tenant.allowedInstruments) : null;
    const instruments = allowedSet
      ? store.db.instruments.filter((i) => allowedSet.has(i.code))
      : store.db.instruments;

    if (licenseRestricted) {
      res.json({
        licenseRestricted: true,
        restrictionReason: "当前数据源未对会员端开放",
        instruments,
        quotes: [],
        contractQuotes: [],
        health: {
          mode: health.mode,
          status: health.status,
          feedState: health.feedState,
          liveVerified: health.liveVerified,
          lastTickAt: health.lastTickAt,
          latencyMs: health.latencyMs,
          collector: {
            feedState: health.collector.feedState,
            liveVerified: health.collector.liveVerified,
            licenseStatus: health.collector.licenseStatus,
            redistributionAllowed: health.collector.redistributionAllowed,
            authorizedMemberChannelReady: health.collector.authorizedMemberChannelReady,
          },
        },
      });
      return;
    }

    const allQuotes = marketEngine.getQuotes();
    const quotes = allowedSet ? allQuotes.filter((q) => allowedSet.has(q.instrumentCode)) : allQuotes;
    const allContractQuotes = marketEngine.getContractQuotes();
    const contractQuotes = allowedSet
      ? allContractQuotes.filter((cq) => allowedSet.has(cq.instrumentCode))
      : allContractQuotes;

    res.json({
      licenseRestricted: false,
      instruments,
      quotes,
      contractQuotes,
      health: isInternalMonitor
        ? health
        : {
            mode: health.mode,
            status: health.status,
            feedState: health.feedState,
            liveVerified: health.liveVerified,
            lastTickAt: health.lastTickAt,
            latencyMs: health.latencyMs,
            collector: {
              feedState: health.collector.feedState,
              liveVerified: health.collector.liveVerified,
              licenseStatus: health.collector.licenseStatus,
              redistributionAllowed: health.collector.redistributionAllowed,
              authorizedMemberChannelReady: health.collector.authorizedMemberChannelReady,
            },
          },
    });
  });

  router.get("/market/klines", requireAuth, requirePermission("market:quotes:read"), (req: AuthRequest, res) => {
    const code = String(req.query.instrument || "WTI").toUpperCase() as InstrumentCode;
    const tf = String(req.query.timeframe || "1m") as Timeframe;
    const { effectiveRole, tenant } = req.auth!;
    if (tenant && !tenant.allowedInstruments.includes(code)) {
      res.status(403).json({ error: `所属代理商租户未开通 ${code} 行情访问权限` });
      return;
    }
    const health = marketEngine.getHealth(getWsClientCount(), STORE_FILE);
    const isInternalMonitor =
      effectiveRole === "SUPER_ADMIN" || effectiveRole === "PLATFORM_OPS" || effectiveRole === "RISK_OFFICER";
    if (health.mode === "PRODUCTION_REAL" && !health.collector.redistributionAllowed && !isInternalMonitor) {
      res.json({
        instrumentCode: code,
        timeframe: tf,
        licenseRestricted: true,
        klines: [],
      });
      return;
    }

    const klines = marketEngine.getKlines(code, tf);
    res.json({ instrumentCode: code, timeframe: tf, licenseRestricted: false, klines });
  });

  // ================= MEMBER TRADING ENDPOINTS =================
  router.get("/member/workspace", requireAuth, requirePermission("member:workspace:read"), (req: AuthRequest, res) => {
    const { user, tenant } = req.auth!;
    if (!user.tenantId) {
      res.status(400).json({ error: "当前账号非会员交易身份" });
      return;
    }

    const account = store.db.accounts.find((a) => a.userId === user.id && a.tenantId === user.tenantId) ?? null;
    const positions = store.db.positions.filter((p) => p.userId === user.id && p.tenantId === user.tenantId);
    const orders = store.db.orders.filter((o) => o.userId === user.id && o.tenantId === user.tenantId).slice(0, 80);
    const executions = store.db.executions
      .filter((e) => e.userId === user.id && e.tenantId === user.tenantId)
      .slice(0, 80);
    const ledger = store.db.ledger.filter((l) => l.userId === user.id && l.tenantId === user.tenantId).slice(0, 80);

    const allowedCodes = tenant?.allowedInstruments ?? [];
    const instruments = store.db.instruments.filter((i) => allowedCodes.includes(i.code));

    res.json({
      user,
      tenant,
      account,
      instruments,
      positions,
      orders,
      executions,
      ledger,
    });
  });

  router.post("/member/orders", requireAuth, requirePermission("trade:execute"), (req: AuthRequest, res) => {
    const { user } = req.auth!;
    const { instrumentCode, orderType, side, positionEffect, quantity, limitPrice, idempotencyKey } = req.body || {};

    if (!idempotencyKey || typeof idempotencyKey !== "string") {
      res.status(400).json({ error: "缺少订单幂等编号 (idempotencyKey)" });
      return;
    }

    try {
      const result = matchingEngine.submitOrder({
        user,
        instrumentCode,
        orderType,
        side,
        positionEffect,
        quantity: Number(quantity),
        limitPrice: limitPrice !== undefined && limitPrice !== null && limitPrice !== "" ? Number(limitPrice) : null,
        idempotencyKey,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "下单失败" });
    }
  });

  router.post("/member/orders/:orderId/cancel", requireAuth, requirePermission("trade:execute"), (req: AuthRequest, res) => {
    const { user } = req.auth!;
    try {
      const result = matchingEngine.cancelOrder(user, String(req.params.orderId));
      res.json(result);
    } catch (err: any) {
      res.status(403).json({ error: err?.message || "撤单失败" });
    }
  });

  // ================= AGENT PORTAL ENDPOINTS (STRICT L1/L2 HIERARCHY & ISOLATION) =================
  router.get("/agent/overview", requireAuth, requirePermission("agent:overview:read"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const requestedTenantId =
      typeof req.query.tenantId === "string" && req.query.tenantId.trim()
        ? req.query.tenantId.trim()
        : user.tenantId;

    if (!requestedTenantId) {
      res.status(400).json({ error: "缺少租户上下文" });
      return;
    }

    const activeTenant = store.db.tenants.find((t) => t.id === requestedTenantId);
    if (!activeTenant) {
      res.status(404).json({ error: "代理商租户不存在" });
      return;
    }

    if (!canViewTenant(user, requestedTenantId, store.db.tenants)) {
      store.db.riskEvents.unshift({
        id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: user.tenantId || "UNKNOWN",
        userId: user.id,
        accountId: "N/A",
        eventType: "ISOLATION_DENIED",
        detail: `跨代理团队读取拦截：${user.id} (${effectiveRole}, ${user.tenantId}) 越权请求租户 ${requestedTenantId}`,
        createdAt: new Date().toISOString(),
      });
      store.persist();
      res.status(403).json({ error: "403 Forbidden：无权访问非直属或同级其他代理商数据" });
      return;
    }

    const isChildReadOnlyView = effectiveRole === "AGENT_L1" && requestedTenantId !== user.tenantId;
    const childTenants =
      effectiveRole === "AGENT_L1" && user.tenantId
        ? store.db.tenants.filter((t) => t.parentId === user.tenantId)
        : effectiveRole === "SUPER_ADMIN"
        ? store.db.tenants.filter((t) => t.parentId === requestedTenantId)
        : [];

    const members = store.db.users
      .filter((u) => u.tenantId === requestedTenantId && u.role === "MEMBER")
      .map((u) => store.sanitizeUser(u));
    const staff = store.db.users
      .filter(
        (u) =>
          u.tenantId === requestedTenantId &&
          (u.role === "AGENT_ADMIN" || u.role === "AGENT_L1" || u.role === "AGENT_L2" || u.role === "AGENT_STAFF")
      )
      .map((u) => store.sanitizeUser(u));
    const accounts = store.db.accounts.filter((a) => a.tenantId === requestedTenantId);
    const positions = store.db.positions.filter((p) => p.tenantId === requestedTenantId);
    const orders = store.db.orders.filter((o) => o.tenantId === requestedTenantId).slice(0, 120);
    const executions = store.db.executions.filter((e) => e.tenantId === requestedTenantId).slice(0, 120);
    const ledger = store.db.ledger.filter((l) => l.tenantId === requestedTenantId).slice(0, 120);
    const riskEvents = store.db.riskEvents.filter((r) => r.tenantId === requestedTenantId).slice(0, 60);

    res.json({
      tenant: activeTenant,
      readOnlyScope: isChildReadOnlyView,
      childTenants,
      members,
      staff,
      accounts,
      positions,
      orders,
      executions,
      ledger,
      riskEvents,
      globalInstruments: store.db.instruments,
    });
  });

  router.get("/agent/members/:memberId", requireAuth, requirePermission("agent:overview:read"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const targetMember = store.db.users.find((u) => u.id === String(req.params.memberId));
    if (!targetMember) {
      res.status(404).json({ error: "会员不存在" });
      return;
    }
    if (!canViewTenant(user, targetMember.tenantId, store.db.tenants)) {
      store.db.riskEvents.unshift({
        id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: user.tenantId || "UNKNOWN",
        userId: user.id,
        accountId: "N/A",
        eventType: "ISOLATION_DENIED",
        detail: `跨租户读取拦截：代理商用户 ${user.id} (${effectiveRole}, ${user.tenantId}) 越权请求会员 ${targetMember.id} (${targetMember.tenantId})`,
        createdAt: new Date().toISOString(),
      });
      store.persist();
      res.status(403).json({ error: "403 Forbidden：多租户隔离拦截 — 禁止访问非授权代理商名下的会员数据" });
      return;
    }
    const account = store.db.accounts.find((a) => a.userId === targetMember.id);
    res.json({ member: store.sanitizeUser(targetMember), account });
  });

  router.post("/agent/members", requireAuth, requirePermission("agent:members:create"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const tenantId =
      effectiveRole === "SUPER_ADMIN" ? String(req.body?.tenantId || "") : String(req.body?.tenantId || user.tenantId || "");
    if (!tenantId) {
      res.status(400).json({ error: "缺少归属代理商租户 ID" });
      return;
    }
    if (!canMutateTenantConfig(user, tenantId, store.db.tenants)) {
      res.status(403).json({ error: "越权拦截：代理商仅可在本级租户下开立会员，禁止越权操作下级或平级代理租户" });
      return;
    }
    const tenant = store.db.tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      res.status(404).json({ error: "归属代理商不存在" });
      return;
    }

    const { name, email, initialCapital, password } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "请输入会员姓名与邮箱" });
      return;
    }
    if (store.db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      res.status(409).json({ error: "该邮箱已存在于平台中" });
      return;
    }

    const initialPassword =
      typeof password === "string" && password.length >= 8 ? password : process.env.DEFAULT_MEMBER_PASSWORD || "Meridian@2026";
    const capital = roundMoney(Number(initialCapital) > 0 ? Number(initialCapital) : tenant.defaultInitialCapital);
    const now = new Date().toISOString();
    const userId = `usr-${tenant.code.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
    const accountId = `acc-${tenant.code.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
    const accountNo = `SIM-${tenant.code.slice(0, 1)}-${Math.floor(3000 + Math.random() * 6999)}`;

    const newUser = {
      id: userId,
      tenantId: tenant.id,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: "MEMBER" as const,
      status: "ACTIVE" as const,
      permissions: ["trade:execute", "account:read"],
      createdAt: now,
      passwordHash: hashPassword(initialPassword),
    };

    const newAccount = {
      id: accountId,
      accountNo,
      userId,
      tenantId: tenant.id,
      initialCapital: capital,
      balance: capital,
      availableFunds: capital,
      frozenFunds: 0,
      usedMargin: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalFees: 0,
      riskRatio: 9999,
      status: "ACTIVE" as const,
      updatedAt: now,
    };

    store.db.users.unshift(newUser);
    store.db.accounts.unshift(newAccount);
    store.db.ledger.unshift({
      id: `ldg-${crypto.randomUUID().slice(0, 8)}`,
      accountId,
      tenantId: tenant.id,
      userId,
      type: "INITIAL_DEPOSIT",
      amount: capital,
      balanceBefore: 0,
      balanceAfter: capital,
      referenceId: accountId,
      operatorId: user.id,
      remark: `代理商 [${tenant.name}] 开立模拟交易账户初始虚拟资金`,
      createdAt: now,
    });

    store.addAuditLog({
      actorId: user.id,
      actorName: user.name,
      actorRole: effectiveRole,
      tenantId: tenant.id,
      action: "MEMBER_CREATE",
      targetType: "USER",
      targetId: userId,
      detail: `新增会员 ${newUser.name} (${accountNo})，初始模拟资金 $${capital.toFixed(2)}`,
    });
    store.persist();

    res.status(201).json({ member: store.sanitizeUser(newUser), account: newAccount });
  });

  router.post("/agent/accounts/:accountId/adjust", requireAuth, requirePermission("agent:accounts:adjust"), (req: AuthRequest, res) => {
    const { user } = req.auth!;
    const { amount, remark } = req.body || {};
    try {
      const account = matchingEngine.adjustAccountFunds(
        user,
        String(req.params.accountId),
        Number(amount),
        typeof remark === "string" ? remark : ""
      );
      res.json({ account });
    } catch (err: any) {
      const msg = err?.message || "资金调整失败";
      res.status(msg.includes("越权") ? 403 : 400).json({ error: msg });
    }
  });

  router.patch("/agent/settings", requireAuth, requirePermission("agent:settings:edit"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const tenantId =
      effectiveRole === "SUPER_ADMIN" && req.body?.tenantId ? String(req.body.tenantId) : String(req.body?.tenantId || user.tenantId || "");
    if (!canMutateTenantConfig(user, tenantId, store.db.tenants)) {
      res.status(403).json({ error: "越权拦截：禁止修改其他代理商或下级代理商的配置" });
      return;
    }
    const tenant = store.db.tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      res.status(404).json({ error: "未找到代理商租户" });
      return;
    }

    const { brandName, domain, defaultInitialCapital, allowedInstruments } = req.body || {};
    if (typeof brandName === "string" && brandName.trim()) {
      tenant.brandName = brandName.trim();
    }
    if (typeof domain === "string" && domain.trim()) {
      tenant.domain = domain.trim().toLowerCase();
    }
    if (Number.isFinite(Number(defaultInitialCapital)) && Number(defaultInitialCapital) >= 1000) {
      tenant.defaultInitialCapital = roundMoney(Number(defaultInitialCapital));
    }
    if (Array.isArray(allowedInstruments)) {
      const validCodes = new Set(store.db.instruments.map((i) => i.code));
      const filtered = allowedInstruments.filter((c): c is InstrumentCode => validCodes.has(c));
      if (filtered.length > 0) {
        tenant.allowedInstruments = filtered;
      }
    }

    store.addAuditLog({
      actorId: user.id,
      actorName: user.name,
      actorRole: effectiveRole,
      tenantId: tenant.id,
      action: "TENANT_SETTINGS_UPDATE",
      targetType: "TENANT",
      targetId: tenant.id,
      detail: `更新代理商品牌与交易品种权限 (${tenant.brandName} · ${tenant.allowedInstruments.join(",")})`,
    });
    store.persist();
    res.json({ tenant });
  });

  router.post("/agent/staff", requireAuth, requirePermission("agent:staff:manage"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const tenantId =
      effectiveRole === "SUPER_ADMIN" ? String(req.body?.tenantId || "") : String(req.body?.tenantId || user.tenantId || "");
    if (!tenantId || !canMutateTenantConfig(user, tenantId, store.db.tenants)) {
      res.status(403).json({ error: "越权拦截：仅可在本级所属代理商租户内添加运营员工" });
      return;
    }
    const { name, email, permissions, password } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "请输入员工姓名与邮箱" });
      return;
    }
    if (store.db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      res.status(409).json({ error: "该邮箱已存在" });
      return;
    }

    const staffPass = typeof password === "string" && password.length >= 8 ? password : process.env.DEFAULT_STAFF_PASSWORD || "Meridian@2026";
    const staff = {
      id: `usr-staff-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: "AGENT_STAFF" as const,
      status: "ACTIVE" as const,
      permissions: Array.isArray(permissions) ? permissions : ["members:read", "orders:read", "reports:read"],
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(staffPass),
    };
    store.db.users.unshift(staff);
    store.addAuditLog({
      actorId: user.id,
      actorName: user.name,
      actorRole: effectiveRole,
      tenantId,
      action: "STAFF_CREATE",
      targetType: "USER",
      targetId: staff.id,
      detail: `新增运营人员 ${staff.name}，权限：${staff.permissions.join(", ")}`,
    });
    store.persist();
    res.status(201).json({ staff: store.sanitizeUser(staff) });
  });

  // ================= SUPPORT PORTAL ENDPOINTS (STRICT READ-ONLY SERVICE SCOPE) =================
  router.get("/support/members", requireAuth, requirePermission("support:members:read"), (req: AuthRequest, res) => {
    const query = String(req.query.q || "").trim().toLowerCase();
    const members = store.db.users
      .filter((u) => u.role === "MEMBER")
      .filter((u) => !query || u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query) || u.id.includes(query))
      .map((u) => {
        const tenant = store.db.tenants.find((t) => t.id === u.tenantId);
        const account = store.db.accounts.find((a) => a.userId === u.id);
        return {
          user: store.sanitizeUser(u),
          tenantName: tenant?.name || "--",
          accountNo: account?.accountNo || "--",
          accountStatus: account?.status || "--",
        };
      });

    res.json({
      supportAgent: req.auth!.user.name,
      totalCount: members.length,
      members,
    });
  });

  // ================= SUPER ADMIN / PLATFORM OPS / RISK / FINANCE CONSOLE =================
  router.get("/admin/overview", requireAuth, requirePermission("admin:overview:read"), (req: AuthRequest, res) => {
    const { user } = req.auth!;
    const tenants = store.db.tenants;
    const canSeeFinance = hasPermission(user, tenants, "finance:ledger:read");
    const canSeeRisk = hasPermission(user, tenants, "risk:read");
    const canSeeMarketInternal = hasPermission(user, tenants, "market:internal:read");
    const isSuper = req.auth!.effectiveRole === "SUPER_ADMIN";

    res.json({
      effectiveRole: req.auth!.effectiveRole,
      permissions: req.auth!.permissions,
      tenants: hasPermission(user, tenants, "tenants:read") ? tenants : [],
      users: isSuper ? store.db.users.map((u) => store.sanitizeUser(u)) : [],
      instruments: hasPermission(user, tenants, "instruments:read") ? store.db.instruments : [],
      contracts: canSeeMarketInternal ? marketEngine.getContracts() : [],
      contractQuotes: canSeeMarketInternal ? marketEngine.getContractQuotes() : [],
      dataSources: canSeeMarketInternal ? marketEngine.getDataSources() : [],
      licenseChecklist: canSeeMarketInternal ? marketEngine.getLicenseChecklist() : [],
      dataLogs: canSeeMarketInternal ? marketEngine.getDataLogs() : [],
      smartDirectives: canSeeMarketInternal || canSeeRisk ? marketEngine.getSmartDirectives() : [],
      accounts: canSeeFinance || canSeeRisk ? store.db.accounts : [],
      positions: canSeeRisk || canSeeFinance ? store.db.positions : [],
      orders: canSeeRisk || canSeeFinance ? store.db.orders.slice(0, 150) : [],
      executions: canSeeFinance ? store.db.executions.slice(0, 150) : [],
      ledger: canSeeFinance ? store.db.ledger.slice(0, 150) : [],
      riskEvents: canSeeRisk ? store.db.riskEvents.slice(0, 100) : [],
      auditLogs: hasPermission(user, tenants, "audit:read") ? store.db.auditLogs.slice(0, 120) : [],
      approvals: hasPermission(user, tenants, "approvals:read") ? (store.db.approvals || []).slice(0, 80) : [],
      matchingRules: hasPermission(user, tenants, "matching_rules:read") ? store.db.matchingRules : null,
      health: canSeeMarketInternal ? marketEngine.getHealth(getWsClientCount(), STORE_FILE) : null,
    });
  });

  router.get("/admin/finance/ledger", requireAuth, requirePermission("finance:ledger:read"), (_req, res) => {
    res.json({
      accounts: store.db.accounts,
      ledger: store.db.ledger.slice(0, 200),
      executions: store.db.executions.slice(0, 200),
    });
  });

  router.post("/admin/finance/accounts/:accountId/adjust", requireAuth, requirePermission("finance:accounts:adjust"), (req: AuthRequest, res) => {
    const { user, effectiveRole } = req.auth!;
    const amount = roundMoney(Number(req.body?.amount));
    const remark = typeof req.body?.remark === "string" ? req.body.remark.trim() : "";
    const accountId = String(req.params.accountId);

    if (!Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: "调账金额无效" });
      return;
    }

    // Dual-control rule: Finance Officer large adjustments (>= $50,000) require secondary approval
    if (effectiveRole === "FINANCE_OFFICER" && Math.abs(amount) >= HIGH_VALUE_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD) {
      const approval: ApprovalRequest = {
        id: `apr-${crypto.randomUUID().slice(0, 8)}`,
        actionType: "FUNDS_ADJUST",
        status: "PENDING",
        requesterId: user.id,
        requesterName: user.name,
        requesterRole: effectiveRole,
        approverId: null,
        approverName: null,
        tenantId: null,
        targetId: accountId,
        payload: { amount, remark },
        reason: remark || `财务大额调账申请 ($${amount})`,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
      };
      store.db.approvals = store.db.approvals || [];
      store.db.approvals.unshift(approval);
      store.addAuditLog({
        actorId: user.id,
        actorName: user.name,
        actorRole: effectiveRole,
        tenantId: null,
        action: "APPROVAL_REQUESTED",
        targetType: "TRADING_ACCOUNT",
        targetId: accountId,
        detail: `提交大额调账二次审批申请 (${approval.id}, $${amount})`,
      });
      store.persist();
      res.status(202).json({
        pendingApproval: true,
        approval,
        message: "金额达到二次审批阈值 ($50,000)，已转入双人复核队列",
      });
      return;
    }

    try {
      const account = matchingEngine.adjustAccountFunds(user, accountId, amount, remark);
      res.json({ pendingApproval: false, account });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "调账失败" });
    }
  });

  router.get("/admin/risk/overview", requireAuth, requirePermission("risk:read"), (_req, res) => {
    res.json({
      matchingRules: store.db.matchingRules,
      riskEvents: store.db.riskEvents.slice(0, 120),
      accounts: store.db.accounts.map((a) => ({
        id: a.id,
        accountNo: a.accountNo,
        tenantId: a.tenantId,
        usedMargin: a.usedMargin,
        riskRatio: a.riskRatio,
        status: a.status,
      })),
    });
  });

  router.post("/admin/tenants", requireAuth, requirePermission("tenants:manage"), (req: AuthRequest, res) => {
    const { name, code, brandName, domain, parentId, defaultInitialCapital, allowedInstruments } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "请输入代理商名称与代理编码" });
      return;
    }
    const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (store.db.tenants.some((t) => t.code === normalizedCode)) {
      res.status(409).json({ error: `代理编码 ${normalizedCode} 已存在` });
      return;
    }

    const resolvedParentId = parentId ? String(parentId) : null;
    if (resolvedParentId) {
      const parentTenant = store.db.tenants.find((t) => t.id === resolvedParentId);
      if (!parentTenant || parentTenant.parentId !== null) {
        res.status(400).json({ error: "仅允许挂载在一级代理商之下（不支持三级嵌套）" });
        return;
      }
    }

    const now = new Date().toISOString();
    const tenantId = `tenant-${normalizedCode.toLowerCase()}-${crypto.randomUUID().slice(0, 4)}`;
    const newTenant: Tenant = {
      id: tenantId,
      code: normalizedCode,
      name: name.trim(),
      brandName: typeof brandName === "string" && brandName.trim() ? brandName.trim() : name.trim(),
      domain:
        typeof domain === "string" && domain.trim()
          ? domain.trim().toLowerCase()
          : `${normalizedCode.toLowerCase()}.meridian.local`,
      parentId: resolvedParentId,
      status: "ACTIVE",
      defaultInitialCapital: Number(defaultInitialCapital) >= 1000 ? roundMoney(Number(defaultInitialCapital)) : 50000,
      allowedInstruments:
        Array.isArray(allowedInstruments) && allowedInstruments.length > 0 ? allowedInstruments : ["WTI", "GOLD", "SILVER"],
      accentColor: "#3B82F6",
      createdAt: now,
    };

    const adminRole = resolvedParentId ? ("AGENT_L2" as const) : ("AGENT_L1" as const);
    const adminUser = {
      id: `usr-${normalizedCode.toLowerCase()}-admin`,
      tenantId,
      email: `admin@${newTenant.domain}`,
      name: `${newTenant.name} 主理人`,
      role: adminRole,
      status: "ACTIVE" as const,
      permissions: ["members:manage", "accounts:adjust", "orders:read", "reports:read", "brand:edit", "staff:manage"],
      createdAt: now,
      passwordHash: hashPassword(process.env.DEFAULT_AGENT_PASSWORD || "Meridian@2026"),
    };

    store.db.tenants.unshift(newTenant);
    store.db.users.unshift(adminUser);
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "TENANT_CREATE",
      targetType: "TENANT",
      targetId: tenantId,
      detail: `创建新${resolvedParentId ? "二级" : "一级"}代理商 [${newTenant.name}] (${newTenant.code})`,
    });
    store.persist();
    res.status(201).json({ tenant: newTenant, adminUser: store.sanitizeUser(adminUser) });
  });

  router.patch("/admin/tenants/:tenantId/status", requireAuth, requirePermission("tenants:manage"), (req: AuthRequest, res) => {
    const tenant = store.db.tenants.find((t) => t.id === String(req.params.tenantId));
    if (!tenant) {
      res.status(404).json({ error: "未找到代理商" });
      return;
    }
    tenant.status = req.body?.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    if (tenant.status === "SUSPENDED") {
      // Immediately terminate active sessions of suspended tenant users
      const affectedUsers = store.db.users.filter((u) => u.tenantId === tenant.id);
      for (const u of affectedUsers) {
        forceLogoutUserSessions(req.auth!, u.id, `TENANT_SUSPENDED:${tenant.id}`);
      }
    }
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "TENANT_STATUS_CHANGE",
      targetType: "TENANT",
      targetId: tenant.id,
      detail: `将代理商 [${tenant.name}] 状态变更为 ${tenant.status}`,
    });
    store.persist();
    res.json({ tenant });
  });

  router.patch("/admin/instruments/:code", requireAuth, requirePermission("instruments:manage"), (req: AuthRequest, res) => {
    const code = String(req.params.code).toUpperCase() as InstrumentCode;
    const inst = store.db.instruments.find((i) => i.code === code);
    if (!inst) {
      res.status(404).json({ error: "未找到期货品种" });
      return;
    }
    const patch = req.body || {};
    const fields: (keyof FuturesInstrument)[] = [
      "multiplier",
      "tickSize",
      "initialMarginRate",
      "maintenanceMarginRate",
      "feePerLot",
      "maxLotsPerOrder",
      "tradingEnabled",
      "activeContract",
    ];
    for (const key of fields) {
      if (patch[key] !== undefined) {
        (inst as any)[key] = patch[key];
      }
    }
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "INSTRUMENT_RULE_UPDATE",
      targetType: "INSTRUMENT",
      targetId: inst.code,
      detail: `修改全局品种 ${inst.code} 合约参数 (乘数:${inst.multiplier}, 保证金:${(inst.initialMarginRate * 100).toFixed(1)}%, 状态:${inst.tradingEnabled ? "启用" : "停牌"})`,
    });
    store.persist();
    res.json({ instrument: inst });
  });

  router.patch("/admin/matching-rules", requireAuth, requirePermission("matching_rules:manage"), (req: AuthRequest, res) => {
    const patch = req.body as Partial<MatchingRuleConfig>;
    store.db.matchingRules = {
      ...store.db.matchingRules,
      ...patch,
    };
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "MATCHING_RULE_UPDATE",
      targetType: "SYSTEM",
      targetId: "matchingRules",
      detail: `更新全局撮合与风控参数：断线暂停=${store.db.matchingRules.pauseOnFeedDisconnect}，强平阈值=${store.db.matchingRules.liquidationRiskThresholdPct}%`,
    });
    store.persist();
    res.json({ matchingRules: store.db.matchingRules });
  });

  router.post("/admin/market/feed-status", requireAuth, requirePermission("risk:control"), (req: AuthRequest, res) => {
    const status = String(req.body?.status || "").toUpperCase() as FeedHealthStatus;
    if (!["CONNECTED", "STALE", "DISCONNECTED"].includes(status)) {
      res.status(400).json({ error: "无效的行情状态" });
      return;
    }
    marketEngine.setFeedStatus(status);
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "MARKET_FEED_TOGGLE",
      targetType: "MARKET_ENGINE",
      targetId: "feed",
      detail: `风控/管理员切换行情源状态为 ${status}`,
    });
    res.json({ health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.post("/admin/market/switch-provider", requireAuth, requirePermission("market:provider:switch"), (req: AuthRequest, res) => {
    const providerId = String(req.body?.providerId || "");
    try {
      const active = marketEngine.switchActiveProvider(providerId);
      store.addAuditLog({
        actorId: req.auth!.user.id,
        actorName: req.auth!.user.name,
        actorRole: req.auth!.effectiveRole,
        tenantId: null,
        action: "MARKET_PROVIDER_SWITCH",
        targetType: "MARKET_DATA_SOURCE",
        targetId: active.id,
        detail: `切换国际行情主数据源至 [${active.name}] (${active.protocol})`,
      });
      res.json({
        activeSource: active,
        dataSources: marketEngine.getDataSources(),
        health: marketEngine.getHealth(getWsClientCount(), STORE_FILE),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "切换行情源失败" });
    }
  });

  router.post("/admin/market/collector/start", requireAuth, requirePermission("market:collector:control"), (req: AuthRequest, res) => {
    const rawInst = req.body?.instrument ? String(req.body.instrument).toUpperCase() : undefined;
    const validInst = rawInst && ["WTI", "BRENT", "GOLD", "SILVER", "NG"].includes(rawInst) ? (rawInst as InstrumentCode) : undefined;
    const collector = marketEngine.startCollector(validInst);
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "COLLECTOR_START",
      targetType: "SMART_MARKET_COLLECTOR",
      targetId: validInst || "ALL",
      detail: `启动行情采集引擎 (${validInst || "全品种"})`,
    });
    res.json({ collector, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.post("/admin/market/collector/stop", requireAuth, requirePermission("market:collector:control"), (req: AuthRequest, res) => {
    const rawInst = req.body?.instrument ? String(req.body.instrument).toUpperCase() : undefined;
    const validInst = rawInst && ["WTI", "BRENT", "GOLD", "SILVER", "NG"].includes(rawInst) ? (rawInst as InstrumentCode) : undefined;
    const collector = marketEngine.stopCollector(validInst);
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "COLLECTOR_STOP",
      targetType: "SMART_MARKET_COLLECTOR",
      targetId: validInst || "ALL",
      detail: `手动停止行情采集 (${validInst || "全品种"})`,
    });
    res.json({ collector, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.post("/admin/market/collector/reconnect", requireAuth, requirePermission("market:collector:control"), async (req: AuthRequest, res) => {
    const rawInst = req.body?.instrument ? String(req.body.instrument).toUpperCase() : undefined;
    const validInst = rawInst && ["WTI", "BRENT", "GOLD", "SILVER", "NG"].includes(rawInst) ? (rawInst as InstrumentCode) : undefined;
    const collector = await marketEngine.reconnectCollector(validInst);
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "COLLECTOR_RECONNECT",
      targetType: "SMART_MARKET_COLLECTOR",
      targetId: validInst || "ALL",
      detail: `触发行情采集重新连接并回补历史 K 线 (${validInst || "全品种"})`,
    });
    res.json({ collector, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.post("/admin/market/probe-sources", requireAuth, requirePermission("market:collector:control"), async (req: AuthRequest, res) => {
    const dataSources = await marketEngine.probeAllProviders();
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "MARKET_SOURCES_PROBE",
      targetType: "MARKET_DATA_SOURCE",
      targetId: "ALL",
      detail: `执行外部数据源真实 HTTP 连通性探针检测`,
    });
    res.json({ dataSources, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.get("/admin/market/history", requireAuth, requirePermission("market:internal:read"), (req: AuthRequest, res) => {
    const rawInst = String(req.query.instrument || "WTI").toUpperCase();
    const validInst: InstrumentCode = ["WTI", "BRENT", "GOLD", "SILVER", "NG"].includes(rawInst)
      ? (rawInst as InstrumentCode)
      : "WTI";
    const rawTf = String(req.query.timeframe || "1m");
    const validTf: Timeframe = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"].includes(rawTf)
      ? (rawTf as Timeframe)
      : "1m";
    res.json(marketEngine.getMarketHistory(validInst, validTf));
  });

  router.post("/admin/market/test-quality", requireAuth, requirePermission("market:collector:control"), (req: AuthRequest, res) => {
    const mode = String(req.body?.mode || "DEDUP");
    const quote = marketEngine.getQuote("WTI");
    if (!quote || quote.lastPrice === null) {
      res.status(400).json({ error: "当前无有效 WTI 基准价，请先启动采集获取真实报价后重试" });
      return;
    }
    const ts = new Date().toISOString();
    if (mode === "DEDUP") {
      const tick = {
        providerId: "src-yahoo-public",
        instrumentCode: "WTI" as const,
        contractCode: "CL00",
        price: quote.lastPrice,
        bid: quote.bidPrice,
        ask: quote.askPrice,
        volume: 12,
        sourceTimestamp: ts,
      };
      const first = marketEngine.ingestExternalTick(tick);
      const second = marketEngine.ingestExternalTick(tick);
      res.json({ first, second, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
      return;
    }

    const spike = marketEngine.ingestExternalTick({
      providerId: "src-yahoo-public",
      instrumentCode: "WTI",
      contractCode: "CL00",
      price: Number((quote.lastPrice * 1.12).toFixed(2)),
      bid: quote.bidPrice,
      ask: quote.askPrice,
      volume: 1,
      sourceTimestamp: ts,
    });
    res.json({ spike, health: marketEngine.getHealth(getWsClientCount(), STORE_FILE) });
  });

  router.post("/admin/smart-control/execute", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const actionType = String(req.body?.actionType || "");
    let message = "";

    if (actionType === "RESUME_FEED") {
      await marketEngine.reconnectCollector();
      message = "已触发智能行情采集引擎重新连接并刷新真实行情";
    } else if (actionType === "RAISE_WTI_MARGIN") {
      const wti = store.db.instruments.find((i) => i.code === "WTI");
      if (wti) {
        wti.initialMarginRate = 0.06;
        store.persist();
      }
      message = "已将 WTI 美原油初始保证金比例上调至 6.0% (16.6x 杠杆)";
    } else if (actionType === "ENABLE_CIRCUIT_BREAKER") {
      store.db.matchingRules.pauseOnFeedDisconnect = true;
      store.persist();
      message = "已开启全平台行情断线/过期自动熔断保护";
    } else if (actionType === "SWITCH_BACKUP_FEED") {
      const db = marketEngine.switchActiveProvider("src-yahoo-public");
      message = `已切换至主采集通道 [${db.name}]`;
    } else {
      res.status(400).json({ error: "未知智能控制指令" });
      return;
    }

    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "SMART_CONTROL_EXECUTE",
      targetType: "SYSTEM",
      targetId: actionType,
      detail: message,
    });

    res.json({
      message,
      smartDirectives: marketEngine.getSmartDirectives(),
      health: marketEngine.getHealth(getWsClientCount(), STORE_FILE),
    });
  });

  router.post("/admin/market/license-checklist/:id", requireAuth, requirePermission("market:provider:switch"), (req: AuthRequest, res) => {
    const checklist = marketEngine.toggleLicenseChecklistItem(String(req.params.id));
    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: "LICENSE_CHECKLIST_UPDATE",
      targetType: "COMPLIANCE",
      targetId: String(req.params.id),
      detail: `更新授权核验项 (${String(req.params.id)})`,
    });
    res.json({ licenseChecklist: checklist });
  });

  // ================= DUAL-CONTROL APPROVALS & ADMIN SESSION GOVERNANCE =================
  router.get("/admin/approvals", requireAuth, requirePermission("approvals:read"), (_req, res) => {
    res.json({ approvals: store.db.approvals || [] });
  });

  router.post("/admin/approvals/:id/decide", requireAuth, requirePermission("approvals:decide"), (req: AuthRequest, res) => {
    const approval = (store.db.approvals || []).find((a) => a.id === String(req.params.id));
    if (!approval) {
      res.status(404).json({ error: "审批单不存在" });
      return;
    }
    if (approval.status !== "PENDING") {
      res.status(400).json({ error: `审批单当前状态为 ${approval.status}，不可重复处理` });
      return;
    }
    if (approval.requesterId === req.auth!.user.id) {
      res.status(403).json({ error: "双人复核拦截：申请人不可自行审批本人提交的申请" });
      return;
    }

    const decision = req.body?.decision === "APPROVED" ? "APPROVED" : "REJECTED";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

    approval.status = decision;
    approval.approverId = req.auth!.user.id;
    approval.approverName = req.auth!.user.name;
    approval.decisionNote = note || (decision === "APPROVED" ? "复核通过" : "复核驳回");
    approval.decidedAt = new Date().toISOString();

    let resultAccount = null;
    if (decision === "APPROVED" && approval.actionType === "FUNDS_ADJUST") {
      const amount = Number(approval.payload.amount);
      const remark = String(approval.payload.remark || approval.reason);
      resultAccount = matchingEngine.adjustAccountFunds(req.auth!.user, approval.targetId, amount, `[双人审批:${approval.id}] ${remark}`);
    }

    store.addAuditLog({
      actorId: req.auth!.user.id,
      actorName: req.auth!.user.name,
      actorRole: req.auth!.effectiveRole,
      tenantId: null,
      action: `APPROVAL_${decision}`,
      targetType: "APPROVAL_REQUEST",
      targetId: approval.id,
      detail: `双人复核 ${decision}: ${approval.actionType} (${approval.targetId})`,
    });
    store.persist();
    res.json({ approval, account: resultAccount });
  });

  router.get("/admin/sessions", requireAuth, requirePermission("sessions:admin:read"), (_req, res) => {
    const active = sessionRepository.listAllActive();
    const userMap = new Map(store.db.users.map((u) => [u.id, u]));
    res.json({
      sessions: active.map((rec) => {
        const u = userMap.get(rec.userId);
        return toSessionSummary(rec, undefined, u ? { name: u.name, email: u.email } : undefined);
      }),
    });
  });

  router.delete("/admin/sessions/:sessionId", requireAuth, requirePermission("sessions:admin:revoke"), (req: AuthRequest, res) => {
    const result = revokeSessionByActor(req.auth!, String(req.params.sessionId), "ADMIN_REVOKED");
    if (!result.ok) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/admin/users/:userId/force-logout", requireAuth, requirePermission("sessions:admin:revoke"), (req: AuthRequest, res) => {
    const targetUserId = String(req.params.userId);
    const target = store.db.users.find((u) => u.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: "目标用户不存在" });
      return;
    }
    const revokedIds = forceLogoutUserSessions(req.auth!, targetUserId, "ADMIN_FORCE_LOGOUT");
    res.json({ ok: true, targetUserId, revokedCount: revokedIds.length, revokedSessionIds: revokedIds });
  });

  // Safe isolation verifier (runs RBAC/ABAC boundary check without leaking temporary bearer tokens)
  router.post("/admin/verify-isolation", requireAuth, requireSuperAdmin, (_req, res) => {
    const alphaAdmin = store.db.users.find((u) => u.id === "usr-alpha-admin");
    const betaMember = store.db.users.find((u) => u.id === "usr-beta-m1");
    const gammaTenant = store.db.tenants.find((t) => t.id === "tenant-gamma");
    if (!alphaAdmin || !betaMember) {
      res.status(400).json({ error: "缺少测试样本账户" });
      return;
    }
    const alphaCanSeeBeta = canViewTenant(alphaAdmin, betaMember.tenantId, store.db.tenants);
    const alphaCanSeeChildGamma = gammaTenant ? canViewTenant(alphaAdmin, gammaTenant.id, store.db.tenants) : false;
    const sameTenantCount = store.db.users.filter((u) => u.tenantId === alphaAdmin.tenantId && u.role === "MEMBER").length;
    res.json({
      alphaAdminId: alphaAdmin.id,
      alphaTenantId: alphaAdmin.tenantId,
      betaMemberId: betaMember.id,
      betaTenantId: betaMember.tenantId,
      sameTenantMemberCount: sameTenantCount,
      crossTenantBlocked: !alphaCanSeeBeta,
      l1ToChildL2ReadAllowed: alphaCanSeeChildGamma,
      step1: `校验一级代理 ${alphaAdmin.id} (${alphaAdmin.tenantId}) 跨租户访问 ${betaMember.tenantId} 边界`,
      step2Status: alphaCanSeeBeta ? 200 : 403,
      step2Message: alphaCanSeeBeta ? "边界异常" : "RBAC/ABAC 已拦截跨一级代理访问，且允许本级查看直属二级代理",
      isolated: !alphaCanSeeBeta,
    });
  });

  return router;
}
