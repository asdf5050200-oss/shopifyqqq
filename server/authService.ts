import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { CanonicalUserRole, Tenant, User } from "../types";
import { getEffectivePermissions, hasPermission, type PermissionKey, resolveEffectiveRole } from "./rbac";
import { sessionRepository, type SessionRecord } from "./sessionRepository";
import { store, verifyPassword } from "./store";

export const HT_SESSION_COOKIE = "ht_session";

export interface AuthenticatedContext {
  session: SessionRecord;
  user: User;
  effectiveRole: CanonicalUserRole;
  permissions: string[];
  tenant: Tenant | null;
  authMethod: "COOKIE" | "BEARER";
}

export interface AuthRequest extends Request {
  auth?: AuthenticatedContext;
  requestId?: string;
}

type SessionRevokeListener = (sessionIds: string[], reason: string) => void;
const revokeListeners = new Set<SessionRevokeListener>();

export function onSessionRevoked(listener: SessionRevokeListener): () => void {
  revokeListeners.add(listener);
  return () => revokeListeners.delete(listener);
}

function notifySessionsRevoked(sessionIds: string[], reason: string): void {
  if (sessionIds.length === 0) return;
  for (const listener of revokeListeners) {
    try {
      listener(sessionIds, reason);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Mandatory server startup guard:
 * Production MUST NEVER run with DEV_DEMO_MODE=true.
 */
export function assertSafeRuntimeEnvironment(): void {
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  const demoMode = (process.env.DEV_DEMO_MODE || "").trim().toLowerCase();
  if (nodeEnv === "production" && demoMode === "true") {
    throw new Error(
      "FATAL SECURITY VIOLATION: DEV_DEMO_MODE=true is strictly prohibited when NODE_ENV=production. Server startup aborted."
    );
  }
}

export function isDemoModeAllowed(): boolean {
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  const demoMode = (process.env.DEV_DEMO_MODE || "").trim().toLowerCase();
  return nodeEnv !== "production" && demoMode === "true";
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function extractAuthToken(req: Request): { token?: string; method?: "COOKIE" | "BEARER" } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return { token, method: "BEARER" };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[HT_SESSION_COOKIE]) {
    return { token: cookies[HT_SESSION_COOKIE], method: "COOKIE" };
  }
  return {};
}

export function isSecureRequest(req: Request): boolean {
  const xfProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return req.secure || xfProto.includes("https");
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, expiresAtIso: string): void {
  const maxAgeSec = Math.max(60, Math.floor((Date.parse(expiresAtIso) - Date.now()) / 1000));
  const secure = isSecureRequest(req);
  const parts = [
    `${HT_SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
  ];
  if (secure) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureRequest(req);
  const parts = [
    `${HT_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
  ];
  if (secure) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function getAllowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = isSecureRequest(req) ? "https" : "http";
  if (typeof host === "string" && host.trim()) {
    const primaryHost = host.split(",")[0].trim();
    allowed.add(`${proto}://${primaryHost}`.toLowerCase());
    allowed.add(`https://${primaryHost}`.toLowerCase());
    allowed.add(`http://${primaryHost}`.toLowerCase());
  }
  const configured = process.env.ALLOWED_ORIGINS || "";
  for (const item of configured.split(",")) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed) allowed.add(trimmed);
  }
  return allowed;
}

/**
 * Strict CORS middleware: never emits wildcard '*' on authenticated endpoints.
 */
export function corsAndSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  const allowed = getAllowedOrigins(req);

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");

  if (origin) {
    if (allowed.has(origin.toLowerCase())) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      res.setHeader("Vary", "Origin");
    } else if (req.method === "OPTIONS") {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * CSRF & Origin verification for cookie-authenticated state-changing requests.
 */
export function csrfOriginGuard(req: AuthRequest, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Only enforce strict CSRF checks when authenticated via Cookie (not explicit Bearer API token)
  if (req.auth?.authMethod !== "COOKIE") {
    next();
    return;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim().toLowerCase() : "";
  const allowed = getAllowedOrigins(req);
  if (origin && !allowed.has(origin)) {
    store.addAuditLog({
      actorId: req.auth.user.id,
      actorName: req.auth.user.name,
      actorRole: req.auth.effectiveRole,
      tenantId: req.auth.user.tenantId,
      action: "CSRF_ORIGIN_BLOCKED",
      targetType: "SECURITY",
      targetId: req.path,
      detail: `拦截跨站异常 Origin 请求: ${origin}`,
    });
    res.status(403).json({ error: "CSRF 校验拦截：请求来源 Origin 不受信任" });
    return;
  }

  const xrw = req.headers["x-requested-with"];
  if (!xrw && !origin) {
    res.status(403).json({ error: "CSRF 校验拦截：缺少安全请求头或来源标识" });
    return;
  }

  next();
}

// Sliding-window login rate limiter & lockout
interface AttemptBucket {
  timestamps: number[];
  consecutiveFailures: number;
  lockedUntilMs: number;
}

class LoginRateLimiter {
  private buckets = new Map<string, AttemptBucket>();
  private readonly windowMs = 5 * 60 * 1000;
  private readonly maxPerWindow = 15;
  private readonly lockoutThreshold = 6;
  private readonly lockoutMs = 5 * 60 * 1000;

  private getBucket(key: string): AttemptBucket {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], consecutiveFailures: 0, lockedUntilMs: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < this.windowMs);
    return bucket;
  }

  public check(ip: string, email: string): { allowed: boolean; retryAfterSec?: number; reason?: string } {
    const now = Date.now();
    const ipBucket = this.getBucket(`ip:${ip}`);
    const emailBucket = this.getBucket(`email:${email.toLowerCase()}`);

    if (emailBucket.lockedUntilMs > now) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((emailBucket.lockedUntilMs - now) / 1000),
        reason: "连续密码错误次数过多，账户已触发安全临时锁定",
      };
    }

    if (ipBucket.timestamps.length >= this.maxPerWindow) {
      return {
        allowed: false,
        retryAfterSec: 60,
        reason: "登录请求过于频繁，请稍后再试",
      };
    }

    return { allowed: true };
  }

  public recordFailure(ip: string, email: string): void {
    const now = Date.now();
    const ipBucket = this.getBucket(`ip:${ip}`);
    ipBucket.timestamps.push(now);

    const emailBucket = this.getBucket(`email:${email.toLowerCase()}`);
    emailBucket.timestamps.push(now);
    emailBucket.consecutiveFailures += 1;
    if (emailBucket.consecutiveFailures >= this.lockoutThreshold) {
      emailBucket.lockedUntilMs = now + this.lockoutMs;
    }
  }

  public recordSuccess(email: string): void {
    this.buckets.delete(`email:${email.toLowerCase()}`);
  }
}

export const loginRateLimiter = new LoginRateLimiter();

export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function resolveSessionContext(
  rawToken: string | undefined,
  authMethod: "COOKIE" | "BEARER" = "BEARER"
): AuthenticatedContext | null {
  if (!rawToken) return null;
  const session = sessionRepository.findActiveByRawToken(rawToken);
  if (!session) return null;

  const user = store.db.users.find((u) => u.id === session.userId);
  if (!user || user.status !== "ACTIVE") {
    sessionRepository.revokeById(session.id, "SYSTEM", "USER_INACTIVE");
    notifySessionsRevoked([session.id], "USER_INACTIVE");
    return null;
  }

  const tenant = user.tenantId
    ? store.db.tenants.find((t) => t.id === user.tenantId) ?? null
    : null;
  const effectiveRole = resolveEffectiveRole(user, store.db.tenants);

  if (tenant && tenant.status === "SUSPENDED" && effectiveRole !== "SUPER_ADMIN") {
    sessionRepository.revokeById(session.id, "SYSTEM", "TENANT_SUSPENDED");
    notifySessionsRevoked([session.id], "TENANT_SUSPENDED");
    return null;
  }

  // Also check parent L1 tenant suspension for L2 members/agents
  if (tenant?.parentId) {
    const parentTenant = store.db.tenants.find((t) => t.id === tenant.parentId);
    if (parentTenant && parentTenant.status === "SUSPENDED") {
      sessionRepository.revokeById(session.id, "SYSTEM", "PARENT_TENANT_SUSPENDED");
      notifySessionsRevoked([session.id], "PARENT_TENANT_SUSPENDED");
      return null;
    }
  }

  sessionRepository.touch(session.id);
  return {
    session,
    user: store.sanitizeUser(user),
    effectiveRole,
    permissions: getEffectivePermissions(user, store.db.tenants),
    tenant,
    authMethod,
  };
}

export function resolveSessionById(sessionId: string): AuthenticatedContext | null {
  const session = sessionRepository.findById(sessionId);
  if (!session || session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }
  const user = store.db.users.find((u) => u.id === session.userId);
  if (!user || user.status !== "ACTIVE") return null;

  const tenant = user.tenantId
    ? store.db.tenants.find((t) => t.id === user.tenantId) ?? null
    : null;
  const effectiveRole = resolveEffectiveRole(user, store.db.tenants);

  if (tenant && tenant.status === "SUSPENDED" && effectiveRole !== "SUPER_ADMIN") {
    return null;
  }

  return {
    session,
    user: store.sanitizeUser(user),
    effectiveRole,
    permissions: getEffectivePermissions(user, store.db.tenants),
    tenant,
    authMethod: "COOKIE",
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const { token, method } = extractAuthToken(req);
  const ctx = resolveSessionContext(token, method || "BEARER");
  if (!ctx) {
    res.status(401).json({ error: "未登录或会话已过期/已吊销，请重新登录" });
    return;
  }
  req.auth = ctx;
  csrfOriginGuard(req, res, next);
}

export function requirePermission(permission: PermissionKey) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    if (!hasPermission(req.auth.user, store.db.tenants, permission)) {
      store.addAuditLog({
        actorId: req.auth.user.id,
        actorName: req.auth.user.name,
        actorRole: req.auth.effectiveRole,
        tenantId: req.auth.user.tenantId,
        action: "RBAC_PERMISSION_DENIED",
        targetType: "API_ROUTE",
        targetId: `${req.method} ${req.path}`,
        detail: `权限拦截：角色 ${req.auth.effectiveRole} 缺少权限 ${permission}`,
      });
      res.status(403).json({
        error: `403 Forbidden：角色 [${req.auth.effectiveRole}] 缺少操作权限 (${permission})`,
      });
      return;
    }
    next();
  };
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.effectiveRole !== "SUPER_ADMIN") {
    if (req.auth) {
      store.addAuditLog({
        actorId: req.auth.user.id,
        actorName: req.auth.user.name,
        actorRole: req.auth.effectiveRole,
        tenantId: req.auth.user.tenantId,
        action: "SUPER_ADMIN_REQUIRED_DENIED",
        targetType: "API_ROUTE",
        targetId: `${req.method} ${req.path}`,
        detail: `越权尝试：非超级管理员 (${req.auth.effectiveRole}) 请求总控接口`,
      });
    }
    res.status(403).json({ error: "权限不足：仅平台超级管理员可执行此操作" });
    return;
  }
  next();
}

export function authenticateCredentials(
  email: string,
  password: string,
  meta: { ip: string; userAgent: string }
): { ok: true; rawToken: string; ctx: AuthenticatedContext } | { ok: false; status: number; error: string } {
  const normalizedEmail = email.trim().toLowerCase();
  const rateCheck = loginRateLimiter.check(meta.ip, normalizedEmail);
  if (!rateCheck.allowed) {
    store.addAuditLog({
      actorId: "ANONYMOUS",
      actorName: normalizedEmail,
      actorRole: "MEMBER",
      tenantId: null,
      action: "LOGIN_RATE_LIMITED",
      targetType: "AUTH",
      targetId: normalizedEmail,
      detail: `IP ${meta.ip} 登录触发限流/锁定：${rateCheck.reason}`,
    });
    return { ok: false, status: 429, error: rateCheck.reason || "请求过于频繁" };
  }

  const target = store.db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!target || !verifyPassword(password, target.passwordHash)) {
    loginRateLimiter.recordFailure(meta.ip, normalizedEmail);
    store.addAuditLog({
      actorId: target?.id || "UNKNOWN",
      actorName: target?.name || normalizedEmail,
      actorRole: target?.role || "MEMBER",
      tenantId: target?.tenantId ?? null,
      action: "LOGIN_FAILED",
      targetType: "AUTH",
      targetId: normalizedEmail,
      detail: `登录密码校验失败 (IP: ${meta.ip})`,
    });
    return { ok: false, status: 401, error: "账号或密码错误" };
  }

  if (target.status !== "ACTIVE") {
    store.addAuditLog({
      actorId: target.id,
      actorName: target.name,
      actorRole: target.role,
      tenantId: target.tenantId,
      action: "LOGIN_BLOCKED_DISABLED",
      targetType: "AUTH",
      targetId: target.id,
      detail: `停用账号尝试登录 (IP: ${meta.ip})`,
    });
    return { ok: false, status: 403, error: "账号已被停用" };
  }

  const tenant = target.tenantId ? store.db.tenants.find((t) => t.id === target.tenantId) ?? null : null;
  const effectiveRole = resolveEffectiveRole(target, store.db.tenants);

  if (tenant && tenant.status === "SUSPENDED" && effectiveRole !== "SUPER_ADMIN") {
    return { ok: false, status: 403, error: `代理商 [${tenant.name}] 已被停用` };
  }
  if (tenant?.parentId) {
    const parent = store.db.tenants.find((t) => t.id === tenant.parentId);
    if (parent && parent.status === "SUSPENDED") {
      return { ok: false, status: 403, error: `上级一级代理 [${parent.name}] 已被停用` };
    }
  }

  loginRateLimiter.recordSuccess(normalizedEmail);

  const issued = sessionRepository.create({
    userId: target.id,
    tenantId: target.tenantId,
    role: effectiveRole,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  store.addAuditLog({
    actorId: target.id,
    actorName: target.name,
    actorRole: effectiveRole,
    tenantId: target.tenantId,
    action: "LOGIN_SUCCESS",
    targetType: "SESSION",
    targetId: issued.record.id,
    detail: `账号登录成功 (${effectiveRole}, IP: ${meta.ip})`,
  });

  const ctx: AuthenticatedContext = {
    session: issued.record,
    user: store.sanitizeUser(target),
    effectiveRole,
    permissions: getEffectivePermissions(target, store.db.tenants),
    tenant,
    authMethod: "COOKIE",
  };
  return { ok: true, rawToken: issued.rawToken, ctx };
}

export function logoutCurrentSession(ctx: AuthenticatedContext): void {
  sessionRepository.revokeById(ctx.session.id, ctx.user.id, "USER_LOGOUT");
  notifySessionsRevoked([ctx.session.id], "USER_LOGOUT");
  store.addAuditLog({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    actorRole: ctx.effectiveRole,
    tenantId: ctx.user.tenantId,
    action: "LOGOUT",
    targetType: "SESSION",
    targetId: ctx.session.id,
    detail: `用户主动退出登录，会话 ${ctx.session.id} 已吊销`,
  });
}

export function revokeSessionByActor(
  actor: AuthenticatedContext,
  sessionId: string,
  reason = "USER_REVOKED"
): { ok: boolean; error?: string; status?: number } {
  const targetSession = sessionRepository.findById(sessionId);
  if (!targetSession) {
    return { ok: false, status: 404, error: "目标会话不存在" };
  }
  const isOwner = targetSession.userId === actor.user.id;
  const isAdminRevoker = hasPermission(actor.user, store.db.tenants, "sessions:admin:revoke");
  if (!isOwner && !isAdminRevoker) {
    return { ok: false, status: 403, error: "无权吊销其他用户的会话" };
  }
  sessionRepository.revokeById(sessionId, actor.user.id, reason);
  notifySessionsRevoked([sessionId], reason);
  store.addAuditLog({
    actorId: actor.user.id,
    actorName: actor.user.name,
    actorRole: actor.effectiveRole,
    tenantId: actor.user.tenantId,
    action: "SESSION_REVOKED",
    targetType: "SESSION",
    targetId: sessionId,
    detail: `吊销会话 ${sessionId} (目标用户 ${targetSession.userId}，原因: ${reason})`,
  });
  return { ok: true };
}

export function forceLogoutUserSessions(
  actor: AuthenticatedContext,
  targetUserId: string,
  reason = "ADMIN_FORCE_LOGOUT"
): string[] {
  const revokedIds = sessionRepository.revokeAllByUserId(targetUserId, actor.user.id, reason);
  notifySessionsRevoked(revokedIds, reason);
  store.addAuditLog({
    actorId: actor.user.id,
    actorName: actor.user.name,
    actorRole: actor.effectiveRole,
    tenantId: actor.user.tenantId,
    action: "FORCE_LOGOUT_USER",
    targetType: "USER",
    targetId: targetUserId,
    detail: `管理员强制下线用户 ${targetUserId}，共吊销 ${revokedIds.length} 个会话`,
  });
  return revokedIds;
}

export function attachRequestId(req: AuthRequest, res: Response, next: NextFunction): void {
  const id = `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
