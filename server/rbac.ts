import type { CanonicalUserRole, InstrumentCode, Tenant, TradingAccount, User } from "../types";

export type PermissionKey =
  | "admin:overview:read"
  | "tenants:read"
  | "tenants:manage"
  | "instruments:read"
  | "instruments:manage"
  | "matching_rules:read"
  | "matching_rules:manage"
  | "market:internal:read"
  | "market:collector:control"
  | "market:provider:switch"
  | "risk:read"
  | "risk:control"
  | "finance:ledger:read"
  | "finance:accounts:adjust"
  | "approvals:read"
  | "approvals:decide"
  | "sessions:admin:read"
  | "sessions:admin:revoke"
  | "audit:read"
  | "agent:overview:read"
  | "agent:children:read"
  | "agent:members:create"
  | "agent:accounts:adjust"
  | "agent:settings:edit"
  | "agent:staff:manage"
  | "support:members:read"
  | "support:tickets:manage"
  | "member:workspace:read"
  | "trade:execute"
  | "market:quotes:read";

export const ROLE_PERMISSIONS: Record<CanonicalUserRole, PermissionKey[]> = {
  SUPER_ADMIN: [
    "admin:overview:read",
    "tenants:read",
    "tenants:manage",
    "instruments:read",
    "instruments:manage",
    "matching_rules:read",
    "matching_rules:manage",
    "market:internal:read",
    "market:collector:control",
    "market:provider:switch",
    "risk:read",
    "risk:control",
    "finance:ledger:read",
    "finance:accounts:adjust",
    "approvals:read",
    "approvals:decide",
    "sessions:admin:read",
    "sessions:admin:revoke",
    "audit:read",
    "agent:overview:read",
    "agent:children:read",
    "agent:members:create",
    "agent:accounts:adjust",
    "agent:settings:edit",
    "agent:staff:manage",
    "support:members:read",
    "support:tickets:manage",
    "market:quotes:read",
  ],
  PLATFORM_OPS: [
    "admin:overview:read",
    "tenants:read",
    "tenants:manage",
    "instruments:read",
    "market:internal:read",
    "market:collector:control",
    "audit:read",
    "support:members:read",
    "market:quotes:read",
  ],
  RISK_OFFICER: [
    "admin:overview:read",
    "tenants:read",
    "instruments:read",
    "matching_rules:read",
    "matching_rules:manage",
    "market:internal:read",
    "risk:read",
    "risk:control",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "market:quotes:read",
  ],
  FINANCE_OFFICER: [
    "admin:overview:read",
    "tenants:read",
    "finance:ledger:read",
    "finance:accounts:adjust",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "market:quotes:read",
  ],
  AGENT_L1: [
    "agent:overview:read",
    "agent:children:read",
    "agent:members:create",
    "agent:accounts:adjust",
    "agent:settings:edit",
    "agent:staff:manage",
    "market:quotes:read",
  ],
  AGENT_L2: [
    "agent:overview:read",
    "agent:members:create",
    "agent:accounts:adjust",
    "agent:settings:edit",
    "agent:staff:manage",
    "market:quotes:read",
  ],
  AGENT_STAFF: [
    "agent:overview:read",
    "market:quotes:read",
  ],
  SUPPORT: [
    "support:members:read",
    "support:tickets:manage",
    "market:quotes:read",
  ],
  MEMBER: [
    "member:workspace:read",
    "trade:execute",
    "market:quotes:read",
  ],
};

export const PLATFORM_STAFF_ROLES: CanonicalUserRole[] = [
  "SUPER_ADMIN",
  "PLATFORM_OPS",
  "RISK_OFFICER",
  "FINANCE_OFFICER",
];

export const AGENT_ROLES: CanonicalUserRole[] = ["AGENT_L1", "AGENT_L2", "AGENT_STAFF"];

export function resolveEffectiveRole(
  user: Pick<User, "role" | "tenantId">,
  tenants: Tenant[]
): CanonicalUserRole {
  if (user.role === "AGENT_ADMIN") {
    const t = user.tenantId ? tenants.find((item) => item.id === user.tenantId) : undefined;
    if (t && t.parentId) {
      return "AGENT_L2";
    }
    return "AGENT_L1";
  }
  return user.role;
}

export function getEffectivePermissions(
  user: Pick<User, "role" | "tenantId" | "permissions">,
  tenants: Tenant[]
): string[] {
  const role = resolveEffectiveRole(user, tenants);
  const base = ROLE_PERMISSIONS[role] ?? [];
  if (role === "SUPER_ADMIN") {
    return Array.from(new Set(["*", ...base]));
  }
  if (role === "AGENT_STAFF") {
    // AGENT_STAFF strictly receives base read permissions + explicitly granted scoped permissions (never platform admin perms)
    const allowedStaffExtras = new Set<string>([
      "accounts:adjust",
      "agent:accounts:adjust",
      "agent:members:create",
      "members:read",
      "orders:read",
      "reports:read",
    ]);
    const extras = (user.permissions || []).filter((p) => allowedStaffExtras.has(p));
    if (extras.includes("accounts:adjust") && !extras.includes("agent:accounts:adjust")) {
      extras.push("agent:accounts:adjust");
    }
    return Array.from(new Set([...base, ...extras]));
  }
  return Array.from(new Set(base));
}

export function hasPermission(
  user: Pick<User, "role" | "tenantId" | "permissions">,
  tenants: Tenant[],
  permission: PermissionKey
): boolean {
  const role = resolveEffectiveRole(user, tenants);
  if (role === "SUPER_ADMIN") return true;
  const perms = getEffectivePermissions(user, tenants);
  return perms.includes(permission);
}

/**
 * ABAC: Which tenant IDs is this actor allowed to READ?
 * - Platform roles (SUPER_ADMIN / PLATFORM_OPS / RISK_OFFICER / FINANCE_OFFICER / SUPPORT): all tenants (subject to route permissions)
 * - AGENT_L1: own tenant + direct child AGENT_L2 tenants (parentId === actor.tenantId)
 * - AGENT_L2 / AGENT_STAFF / MEMBER: strictly own tenantId only
 */
export function getReadableTenantIds(
  actor: Pick<User, "role" | "tenantId">,
  tenants: Tenant[]
): string[] | "ALL" {
  const role = resolveEffectiveRole(actor, tenants);
  if (PLATFORM_STAFF_ROLES.includes(role) || role === "SUPPORT") {
    return "ALL";
  }
  if (!actor.tenantId) return [];
  if (role === "AGENT_L1") {
    const childIds = tenants.filter((t) => t.parentId === actor.tenantId).map((t) => t.id);
    return Array.from(new Set([actor.tenantId, ...childIds]));
  }
  return [actor.tenantId];
}

export function canViewTenant(
  actor: Pick<User, "role" | "tenantId">,
  targetTenantId: string | null | undefined,
  tenants: Tenant[]
): boolean {
  if (!targetTenantId) return false;
  const scope = getReadableTenantIds(actor, tenants);
  if (scope === "ALL") return true;
  return scope.includes(targetTenantId);
}

/**
 * ABAC: Can actor mutate/adjust funds or settings for targetTenantId?
 * CRITICAL RULE:
 * - AGENT_L1 CANNOT modify/adjust funds or accounts of child AGENT_L2 tenants! Only own tenantId!
 * - AGENT_L2 / AGENT_STAFF can only touch own tenantId (with permission).
 * - Only SUPER_ADMIN / FINANCE_OFFICER can touch platform-wide accounts (subject to finance permission & dual-approval).
 */
export function canMutateTenantFunds(
  actor: Pick<User, "role" | "tenantId" | "permissions">,
  targetTenantId: string,
  tenants: Tenant[]
): boolean {
  const role = resolveEffectiveRole(actor, tenants);
  if (role === "SUPER_ADMIN" || role === "FINANCE_OFFICER") {
    return true;
  }
  if (role === "AGENT_L1" || role === "AGENT_L2") {
    return actor.tenantId === targetTenantId;
  }
  if (role === "AGENT_STAFF") {
    return (
      actor.tenantId === targetTenantId &&
      hasPermission(actor, tenants, "agent:accounts:adjust")
    );
  }
  return false;
}

export function canMutateTenantConfig(
  actor: Pick<User, "role" | "tenantId">,
  targetTenantId: string,
  tenants: Tenant[]
): boolean {
  const role = resolveEffectiveRole(actor, tenants);
  if (role === "SUPER_ADMIN") return true;
  if (role === "AGENT_L1" || role === "AGENT_L2") {
    return actor.tenantId === targetTenantId;
  }
  return false;
}

export function canAccessAccountResource(
  actor: Pick<User, "id" | "role" | "tenantId">,
  account: Pick<TradingAccount, "userId" | "tenantId">,
  tenants: Tenant[]
): boolean {
  const role = resolveEffectiveRole(actor, tenants);
  if (role === "MEMBER") {
    return account.userId === actor.id && account.tenantId === actor.tenantId;
  }
  if (role === "AGENT_L1") {
    return canViewTenant(actor, account.tenantId, tenants);
  }
  if (role === "AGENT_L2" || role === "AGENT_STAFF") {
    return account.tenantId === actor.tenantId;
  }
  if (role === "FINANCE_OFFICER" || role === "RISK_OFFICER" || role === "SUPER_ADMIN" || role === "SUPPORT") {
    return true;
  }
  return false;
}

export interface WsChannelAuthContext {
  actor: Pick<User, "id" | "role" | "tenantId" | "permissions">;
  tenant: Tenant | null;
  tenants: Tenant[];
  accounts: TradingAccount[];
  redistributionAllowed: boolean;
  marketMode: "PRODUCTION_REAL" | "DEV_TEST_SIM";
}

export function authorizeWsChannel(
  channel: string,
  ctx: WsChannelAuthContext
): { ok: boolean; reason?: string } {
  const role = resolveEffectiveRole(ctx.actor, ctx.tenants);
  const trimmed = channel.trim();

  if (trimmed === "admin.system") {
    if (PLATFORM_STAFF_ROLES.includes(role)) {
      return { ok: true };
    }
    return { ok: false, reason: "仅平台内部管理/运营/风控/财务角色可订阅系统频道" };
  }

  if (trimmed.startsWith("market.quotes.")) {
    const symbolPart = trimmed.slice("market.quotes.".length).toUpperCase();
    const isInternalMonitor = role === "SUPER_ADMIN" || role === "PLATFORM_OPS" || role === "RISK_OFFICER";

    // Commercial license enforcement: public non-commercial feed cannot enter member/external commercial distribution
    if (ctx.marketMode === "PRODUCTION_REAL" && !ctx.redistributionAllowed && !isInternalMonitor) {
      return {
        ok: false,
        reason: "当前数据源未对会员端开放",
      };
    }

    if (symbolPart !== "*" && ctx.tenant) {
      if (!ctx.tenant.allowedInstruments.includes(symbolPart as InstrumentCode)) {
        return { ok: false, reason: `所属租户未开通 ${symbolPart} 品种行情权限` };
      }
    }
    return { ok: true };
  }

  if (trimmed.startsWith("account.")) {
    const accountId = trimmed.slice("account.".length);
    const acc = ctx.accounts.find((a) => a.id === accountId);
    if (!acc) {
      return { ok: false, reason: "目标账户不存在" };
    }
    if (role === "MEMBER") {
      if (acc.userId === ctx.actor.id && acc.tenantId === ctx.actor.tenantId) {
        return { ok: true };
      }
      return { ok: false, reason: "越权拦截：会员禁止订阅他人账户频道" };
    }
    if (role === "AGENT_L1" || role === "AGENT_L2" || role === "AGENT_STAFF") {
      if (canViewTenant(ctx.actor, acc.tenantId, ctx.tenants)) {
        return { ok: true };
      }
      return { ok: false, reason: "越权拦截：代理商禁止订阅非授权团队账户频道" };
    }
    if (role === "SUPER_ADMIN" || role === "FINANCE_OFFICER" || role === "RISK_OFFICER") {
      return { ok: true };
    }
    return { ok: false, reason: "当前角色无权订阅账户资金实时频道" };
  }

  if (trimmed.startsWith("orders.user.")) {
    const targetUserId = trimmed.slice("orders.user.".length);
    if (role === "MEMBER") {
      return targetUserId === ctx.actor.id
        ? { ok: true }
        : { ok: false, reason: "越权拦截：会员禁止订阅他人订单频道" };
    }
    const targetAccount = ctx.accounts.find((a) => a.userId === targetUserId);
    if (!targetAccount) {
      return { ok: false, reason: "目标会员订单频道不存在" };
    }
    if (role === "AGENT_L1" || role === "AGENT_L2" || role === "AGENT_STAFF") {
      return canViewTenant(ctx.actor, targetAccount.tenantId, ctx.tenants)
        ? { ok: true }
        : { ok: false, reason: "越权拦截：禁止订阅非授权租户订单频道" };
    }
    if (role === "SUPER_ADMIN" || role === "RISK_OFFICER" || role === "FINANCE_OFFICER") {
      return { ok: true };
    }
    return { ok: false, reason: "当前角色无权订阅会员订单频道" };
  }

  if (trimmed.startsWith("agent.team.")) {
    const targetTenantId = trimmed.slice("agent.team.".length);
    if (role === "MEMBER" || role === "SUPPORT") {
      return { ok: false, reason: "当前角色无权订阅代理商团队频道" };
    }
    if (PLATFORM_STAFF_ROLES.includes(role)) {
      return { ok: true };
    }
    if (canViewTenant(ctx.actor, targetTenantId, ctx.tenants)) {
      return { ok: true };
    }
    return { ok: false, reason: "越权拦截：禁止订阅其他代理商团队频道" };
  }

  return { ok: false, reason: `未知或未授权的 WebSocket 频道: ${trimmed}` };
}
