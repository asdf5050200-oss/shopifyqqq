import type http from "http";
import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { MarketQuote, TradingAccount, TradeOrder } from "../types";
import {
  getAllowedOrigins,
  onSessionRevoked,
  parseCookies,
  HT_SESSION_COOKIE,
  resolveSessionById,
  resolveSessionContext,
  type AuthenticatedContext,
} from "./authService";
import { marketEngine } from "./marketEngine";
import { authorizeWsChannel } from "./rbac";
import { wsTicketStore } from "./sessionRepository";
import { STORE_FILE, store } from "./store";

interface WsClientState {
  id: string;
  ws: WebSocket;
  auth: AuthenticatedContext | null;
  subscriptions: Set<string>;
  authTimer: NodeJS.Timeout | null;
  connectedAt: string;
  ip: string;
}

export class SecureWsGateway {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, WsClientState>();
  private unsubRevoke: (() => void) | null = null;
  private upgradeHandler: (req: http.IncomingMessage, socket: any, head: Buffer) => void;

  constructor(server: http.Server) {
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });
    this.upgradeHandler = (req, socket, head) => {
      const reqUrl = new URL(req.url || "/", "http://localhost");
      if (reqUrl.pathname !== "/ws") {
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    };
    this.server.on("upgrade", this.upgradeHandler);
    this.setupListeners();
  }

  private setupListeners(): void {
    this.unsubRevoke = onSessionRevoked((sessionIds, reason) => {
      for (const state of this.clients.values()) {
        if (state.auth && sessionIds.includes(state.auth.session.id)) {
          this.sendJson(state.ws, {
            type: "auth:revoked",
            reason,
          });
          state.ws.close(4401, `Session revoked: ${reason}`);
        }
      }
    });

    this.wss.on("connection", (ws, req) => {
      const ip =
        (typeof req.headers["x-forwarded-for"] === "string"
          ? req.headers["x-forwarded-for"].split(",")[0].trim()
          : req.socket.remoteAddress) || "unknown";

      // 1. Prohibit long-lived tokens or credentials in URL query parameters
      const reqUrl = new URL(req.url || "/ws", "http://localhost");
      if (reqUrl.searchParams.has("token") || reqUrl.searchParams.has("auth") || reqUrl.searchParams.has("ticket")) {
        store.addAuditLog({
          actorId: "ANONYMOUS",
          actorName: "WS_CLIENT",
          actorRole: "MEMBER",
          tenantId: null,
          action: "WS_URL_TOKEN_REJECTED",
          targetType: "WEBSOCKET",
          targetId: "/ws",
          detail: `拦截携带 URL 查询参数令牌的 WebSocket 连接 (IP: ${ip})`,
        });
        ws.close(4001, "Security error: tokens/tickets in URL query parameters are prohibited");
        return;
      }

      // 2. Origin check when Origin header is present
      const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim().toLowerCase() : "";
      if (origin) {
        const fakeReq = { headers: req.headers, secure: false } as any;
        const allowed = getAllowedOrigins(fakeReq);
        if (!allowed.has(origin)) {
          store.addAuditLog({
            actorId: "ANONYMOUS",
            actorName: "WS_CLIENT",
            actorRole: "MEMBER",
            tenantId: null,
            action: "WS_ORIGIN_REJECTED",
            targetType: "WEBSOCKET",
            targetId: "/ws",
            detail: `拦截未授权 Origin (${origin}) 的 WebSocket 连接 (IP: ${ip})`,
          });
          ws.close(4003, "Forbidden origin");
          return;
        }
      }

      const state: WsClientState = {
        id: `wsc_${crypto.randomUUID().slice(0, 8)}`,
        ws,
        auth: null,
        subscriptions: new Set<string>(),
        authTimer: null,
        connectedAt: new Date().toISOString(),
        ip,
      };
      this.clients.set(ws, state);

      // 3. Try authenticating immediately from HttpOnly Session Cookie
      const cookies = parseCookies(req.headers.cookie);
      const cookieToken = cookies[HT_SESSION_COOKIE];
      if (cookieToken) {
        const ctx = resolveSessionContext(cookieToken, "COOKIE");
        if (ctx) {
          this.markAuthenticated(state, ctx);
        }
      }

      // 4. If not authenticated via cookie, demand one-time ticket via first message within 5s
      if (!state.auth) {
        this.sendJson(ws, {
          type: "auth:required",
          message: "请通过已认证会话 Cookie 或一次性 wsTicket 完成 WebSocket 鉴权",
        });
        state.authTimer = setTimeout(() => {
          if (!state.auth && ws.readyState === WebSocket.OPEN) {
            store.addAuditLog({
              actorId: "ANONYMOUS",
              actorName: "WS_UNAUTHENTICATED",
              actorRole: "MEMBER",
              tenantId: null,
              action: "WS_AUTH_TIMEOUT",
              targetType: "WEBSOCKET",
              targetId: state.id,
              detail: `WebSocket 连接超时未完成鉴权 (IP: ${ip})`,
            });
            ws.close(4401, "Authentication timeout");
          }
        }, 5000);
      }

      ws.on("message", (raw) => {
        this.handleIncomingMessage(state, raw.toString("utf-8"));
      });

      ws.on("close", () => {
        if (state.authTimer) clearTimeout(state.authTimer);
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        if (state.authTimer) clearTimeout(state.authTimer);
        this.clients.delete(ws);
      });
    });
  }

  private markAuthenticated(state: WsClientState, ctx: AuthenticatedContext): void {
    if (state.authTimer) {
      clearTimeout(state.authTimer);
      state.authTimer = null;
    }
    state.auth = ctx;
    this.sendJson(state.ws, {
      type: "auth:ok",
      sessionId: ctx.session.id,
      userId: ctx.user.id,
      effectiveRole: ctx.effectiveRole,
      tenantId: ctx.user.tenantId,
    });
  }

  private refreshClientAuth(state: WsClientState): AuthenticatedContext | null {
    if (!state.auth) return null;
    const latest = resolveSessionById(state.auth.session.id);
    if (!latest) {
      this.sendJson(state.ws, { type: "auth:revoked", reason: "SESSION_EXPIRED_OR_REVOKED" });
      state.ws.close(4401, "Session expired or revoked");
      return null;
    }
    state.auth = latest;
    return latest;
  }

  private handleIncomingMessage(state: WsClientState, text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      this.sendJson(state.ws, { type: "error", error: "无效的 JSON 消息格式" });
      return;
    }

    if (msg?.type === "ping") {
      this.sendJson(state.ws, { type: "pong", ts: new Date().toISOString() });
      return;
    }

    if (msg?.type === "auth") {
      const ticket = typeof msg.ticket === "string" ? msg.ticket : "";
      const consumed = wsTicketStore.consume(ticket);
      if (!consumed) {
        store.addAuditLog({
          actorId: "ANONYMOUS",
          actorName: "WS_CLIENT",
          actorRole: "MEMBER",
          tenantId: null,
          action: "WS_AUTH_FAILED",
          targetType: "WEBSOCKET",
          targetId: state.id,
          detail: `WebSocket 一次性连接票据无效或已过期 (IP: ${state.ip})`,
        });
        this.sendJson(state.ws, { type: "auth:error", error: "无效或已过期的一次性 WebSocket 票据" });
        state.ws.close(4401, "Invalid wsTicket");
        return;
      }
      const ctx = resolveSessionById(consumed.sessionId);
      if (!ctx || ctx.user.id !== consumed.userId) {
        this.sendJson(state.ws, { type: "auth:error", error: "对应登录会话已失效" });
        state.ws.close(4401, "Invalid session");
        return;
      }
      this.markAuthenticated(state, ctx);
      return;
    }

    // All other commands strictly require authenticated active session
    const ctx = this.refreshClientAuth(state);
    if (!ctx) {
      store.addAuditLog({
        actorId: "ANONYMOUS",
        actorName: "WS_CLIENT",
        actorRole: "MEMBER",
        tenantId: null,
        action: "WS_UNAUTHENTICATED_COMMAND",
        targetType: "WEBSOCKET",
        targetId: String(msg?.type || "UNKNOWN"),
        detail: `未认证 WebSocket 尝试执行 ${String(msg?.type || "UNKNOWN")} (IP: ${state.ip})`,
      });
      this.sendJson(state.ws, { type: "error", error: "未完成身份认证，禁止订阅或操作频道" });
      return;
    }

    if (msg?.type === "subscribe") {
      const channels = Array.isArray(msg.channels)
        ? msg.channels.filter((c: unknown): c is string => typeof c === "string")
        : typeof msg.channel === "string"
        ? [msg.channel]
        : [];

      const health = marketEngine.getHealth(this.getAuthenticatedCount(), STORE_FILE);
      const granted: string[] = [];
      const denied: { channel: string; reason: string }[] = [];

      for (const ch of channels) {
        const check = authorizeWsChannel(ch, {
          actor: ctx.user,
          tenant: ctx.tenant,
          tenants: store.db.tenants,
          accounts: store.db.accounts,
          redistributionAllowed: health.collector.redistributionAllowed,
          marketMode: health.mode,
        });

        if (check.ok) {
          state.subscriptions.add(ch);
          granted.push(ch);
        } else {
          const reason = check.reason || "无权限订阅此频道";
          denied.push({ channel: ch, reason });
          store.addAuditLog({
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            actorRole: ctx.effectiveRole,
            tenantId: ctx.user.tenantId,
            action: "WS_SUBSCRIBE_DENIED",
            targetType: "WS_CHANNEL",
            targetId: ch,
            detail: `越权订阅拦截: ${reason} (IP: ${state.ip})`,
          });
          store.db.riskEvents.unshift({
            id: `rsk-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: ctx.user.tenantId || "PLATFORM",
            userId: ctx.user.id,
            accountId: "N/A",
            eventType: "ISOLATION_DENIED",
            detail: `WS 频道越权订阅拦截: 用户 ${ctx.user.id} (${ctx.effectiveRole}) 尝试订阅 [${ch}] -> ${reason}`,
            createdAt: new Date().toISOString(),
          });
          store.persist();
        }
      }

      this.sendJson(state.ws, {
        type: "subscription:ack",
        granted,
        denied,
      });

      // Send scoped initial snapshot only for granted market channels
      if (granted.some((c) => c.startsWith("market.quotes."))) {
        const scopedQuotes = this.filterQuotesForClient(ctx, state.subscriptions, marketEngine.getQuotes());
        this.sendJson(state.ws, {
          type: "market:snapshot",
          quotes: scopedQuotes,
          health: this.sanitizeHealthForClient(ctx, health),
        });
      }
      return;
    }

    if (msg?.type === "unsubscribe") {
      const channels = Array.isArray(msg.channels)
        ? msg.channels.filter((c: unknown): c is string => typeof c === "string")
        : typeof msg.channel === "string"
        ? [msg.channel]
        : [];
      for (const ch of channels) {
        state.subscriptions.delete(ch);
      }
      this.sendJson(state.ws, {
        type: "subscription:unsubscribed",
        channels,
      });
    }
  }

  private filterQuotesForClient(
    ctx: AuthenticatedContext,
    subs: Set<string>,
    allQuotes: MarketQuote[]
  ): MarketQuote[] {
    const subAll = subs.has("market.quotes.*");
    return allQuotes.filter((q) => {
      if (!subAll && !subs.has(`market.quotes.${q.instrumentCode}`)) {
        return false;
      }
      if (ctx.tenant && !ctx.tenant.allowedInstruments.includes(q.instrumentCode)) {
        return false;
      }
      return true;
    });
  }

  private sanitizeHealthForClient(ctx: AuthenticatedContext, health: ReturnType<typeof marketEngine.getHealth>) {
    if (
      ctx.effectiveRole === "SUPER_ADMIN" ||
      ctx.effectiveRole === "PLATFORM_OPS" ||
      ctx.effectiveRole === "RISK_OFFICER"
    ) {
      return health;
    }
    return {
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
    };
  }

  public broadcastMarketTick(
    quotes: MarketQuote[],
    matchResult: {
      triggeredOrders: TradeOrder[];
      updatedAccounts: TradingAccount[];
    }
  ): void {
    const fullHealth = marketEngine.getHealth(this.getAuthenticatedCount(), STORE_FILE);

    for (const state of this.clients.values()) {
      if (state.ws.readyState !== WebSocket.OPEN) continue;
      if (!state.auth) continue;

      const ctx = this.refreshClientAuth(state);
      if (!ctx) continue;

      // 1. Market quotes stream (only if subscribed AND permitted by license/tenant)
      const hasMarketSub = Array.from(state.subscriptions).some((c) => c.startsWith("market.quotes."));
      if (hasMarketSub) {
        const isInternalMonitor =
          ctx.effectiveRole === "SUPER_ADMIN" ||
          ctx.effectiveRole === "PLATFORM_OPS" ||
          ctx.effectiveRole === "RISK_OFFICER";
        const canReceiveMarket =
          fullHealth.mode === "DEV_TEST_SIM" ||
          fullHealth.collector.redistributionAllowed ||
          isInternalMonitor;

        if (canReceiveMarket) {
          const scopedQuotes = this.filterQuotesForClient(ctx, state.subscriptions, quotes);
          if (scopedQuotes.length > 0) {
            // Note: triggeredOrderIds & updatedAccountIds are NEVER sent in market:tick broadcasts
            this.sendJson(state.ws, {
              type: "market:tick",
              quotes: scopedQuotes,
              health: this.sanitizeHealthForClient(ctx, fullHealth),
            });
          }
        } else {
          for (const sub of Array.from(state.subscriptions)) {
            if (sub.startsWith("market.quotes.")) {
              state.subscriptions.delete(sub);
            }
          }
          this.sendJson(state.ws, {
            type: "market:restricted",
            reason: "当前数据源未对会员端开放",
            quotes: [],
            health: this.sanitizeHealthForClient(ctx, fullHealth),
          });
        }
      }

      // 2. Targeted account updates (ONLY to sockets authorized & subscribed to account.<id>)
      for (const acc of matchResult.updatedAccounts) {
        if (state.subscriptions.has(`account.${acc.id}`)) {
          this.sendJson(state.ws, {
            type: "account:update",
            account: acc,
          });
        }
      }

      // 3. Targeted order updates (ONLY to sockets authorized & subscribed to orders.user.<userId>)
      for (const ord of matchResult.triggeredOrders) {
        if (state.subscriptions.has(`orders.user.${ord.userId}`)) {
          this.sendJson(state.ws, {
            type: "order:update",
            order: ord,
          });
        }
      }
    }
  }

  public getAuthenticatedCount(): number {
    let count = 0;
    for (const s of this.clients.values()) {
      if (s.auth && s.ws.readyState === WebSocket.OPEN) count += 1;
    }
    return count;
  }

  public getTotalConnections(): number {
    return this.clients.size;
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ignore transient socket error
      }
    }
  }

  public dispose(): void {
    this.server.off("upgrade", this.upgradeHandler);
    this.unsubRevoke?.();
    this.wss.close();
  }
}
