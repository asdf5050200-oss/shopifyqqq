import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { CanonicalUserRole, SessionSummary } from "../types";

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  tenantId: string | null;
  role: CanonicalUserRole;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface CreateSessionInput {
  userId: string;
  tenantId: string | null;
  role: CanonicalUserRole;
  userAgent: string;
  ip: string;
  ttlMs?: number;
}

export interface IssuedSessionResult {
  rawToken: string;
  record: SessionRecord;
}

export interface SessionRepository {
  create(input: CreateSessionInput): IssuedSessionResult;
  findActiveByRawToken(rawToken: string): SessionRecord | null;
  findById(sessionId: string): SessionRecord | null;
  touch(sessionId: string): void;
  revokeById(sessionId: string, revokedBy: string, reason: string): SessionRecord | null;
  revokeAllByUserId(userId: string, revokedBy: string, reason: string, exceptSessionId?: string): string[];
  listActiveByUserId(userId: string): SessionRecord[];
  listAllActive(): SessionRecord[];
  purgeExpired(): number;
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function toSessionSummary(
  rec: SessionRecord,
  currentSessionId?: string,
  userMeta?: { name: string; email: string }
): SessionSummary {
  return {
    id: rec.id,
    userId: rec.userId,
    userName: userMeta?.name,
    userEmail: userMeta?.email,
    tenantId: rec.tenantId,
    role: rec.role,
    userAgent: rec.userAgent,
    ip: rec.ip,
    createdAt: rec.createdAt,
    lastSeenAt: rec.lastSeenAt,
    expiresAt: rec.expiresAt,
    revokedAt: rec.revokedAt,
    revokeReason: rec.revokeReason,
    isCurrent: currentSessionId ? rec.id === currentSessionId : undefined,
  };
}

interface SessionStorePayload {
  sessions: SessionRecord[];
}

const DEFAULT_TTL_MS =
  Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 24) * 3600 * 1000;

export class JsonSessionRepository implements SessionRepository {
  private readonly filePath: string;
  private sessions: SessionRecord[] = [];
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(filePath = path.join(process.cwd(), "data", "sessions-store.json")) {
    this.filePath = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.sessions = [];
      this.persistImmediate();
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionStorePayload;
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    } catch (err) {
      console.error("[SessionRepository] Failed to load sessions-store.json, starting empty:", err);
      this.sessions = [];
    }
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistImmediate();
    }, 150);
  }

  public persistImmediate(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp`;
      const payload: SessionStorePayload = { sessions: this.sessions };
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error("[SessionRepository] Failed to persist sessions:", err);
    }
  }

  private isRecordActive(rec: SessionRecord, nowMs = Date.now()): boolean {
    if (rec.revokedAt !== null) return false;
    return Date.parse(rec.expiresAt) > nowMs;
  }

  public create(input: CreateSessionInput): IssuedSessionResult {
    const nowMs = Date.now();
    const rawToken = `mfc_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHash = hashSessionToken(rawToken);
    const ttlMs = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS;

    const record: SessionRecord = {
      id: `sess_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      tokenHash,
      userId: input.userId,
      tenantId: input.tenantId,
      role: input.role,
      userAgent: input.userAgent.slice(0, 160),
      ip: input.ip,
      createdAt: new Date(nowMs).toISOString(),
      lastSeenAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };

    this.purgeExpired();
    this.sessions.unshift(record);
    if (this.sessions.length > 2000) {
      this.sessions.length = 2000;
    }
    this.persistImmediate();
    return { rawToken, record };
  }

  public findActiveByRawToken(rawToken: string): SessionRecord | null {
    if (!rawToken || typeof rawToken !== "string") return null;
    const hash = hashSessionToken(rawToken);
    const rec = this.sessions.find((s) => s.tokenHash === hash);
    if (!rec || !this.isRecordActive(rec)) return null;
    return rec;
  }

  public findById(sessionId: string): SessionRecord | null {
    return this.sessions.find((s) => s.id === sessionId) ?? null;
  }

  public touch(sessionId: string): void {
    const rec = this.sessions.find((s) => s.id === sessionId);
    if (!rec || !this.isRecordActive(rec)) return;
    rec.lastSeenAt = new Date().toISOString();
    this.persistSoon();
  }

  public revokeById(sessionId: string, revokedBy: string, reason: string): SessionRecord | null {
    const rec = this.sessions.find((s) => s.id === sessionId);
    if (!rec) return null;
    if (!rec.revokedAt) {
      rec.revokedAt = new Date().toISOString();
      rec.revokedBy = revokedBy;
      rec.revokeReason = reason;
      this.persistImmediate();
    }
    return rec;
  }

  public revokeAllByUserId(
    userId: string,
    revokedBy: string,
    reason: string,
    exceptSessionId?: string
  ): string[] {
    const nowIso = new Date().toISOString();
    const revokedIds: string[] = [];
    for (const rec of this.sessions) {
      if (rec.userId === userId && rec.id !== exceptSessionId && !rec.revokedAt) {
        rec.revokedAt = nowIso;
        rec.revokedBy = revokedBy;
        rec.revokeReason = reason;
        revokedIds.push(rec.id);
      }
    }
    if (revokedIds.length > 0) {
      this.persistImmediate();
    }
    return revokedIds;
  }

  public listActiveByUserId(userId: string): SessionRecord[] {
    const nowMs = Date.now();
    return this.sessions.filter((s) => s.userId === userId && this.isRecordActive(s, nowMs));
  }

  public listAllActive(): SessionRecord[] {
    const nowMs = Date.now();
    return this.sessions.filter((s) => this.isRecordActive(s, nowMs));
  }

  public purgeExpired(): number {
    const nowMs = Date.now();
    const cutoffMs = nowMs - 7 * 24 * 3600 * 1000;
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => {
      const expMs = Date.parse(s.expiresAt);
      if (s.revokedAt) {
        return Date.parse(s.revokedAt) > cutoffMs;
      }
      return expMs > nowMs;
    });
    const removed = before - this.sessions.length;
    if (removed > 0) {
      this.persistSoon();
    }
    return removed;
  }
}

export interface WsTicketRecord {
  ticketHash: string;
  sessionId: string;
  userId: string;
  expiresAtMs: number;
  consumed: boolean;
}

export class WsTicketStore {
  private tickets = new Map<string, WsTicketRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  public issue(sessionId: string, userId: string): { ticket: string; expiresAt: string } {
    this.prune();
    const ticket = `wst_${crypto.randomBytes(24).toString("hex")}`;
    const ticketHash = hashSessionToken(ticket);
    const expiresAtMs = Date.now() + this.ttlMs;
    this.tickets.set(ticketHash, {
      ticketHash,
      sessionId,
      userId,
      expiresAtMs,
      consumed: false,
    });
    return {
      ticket,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public consume(rawTicket: string): { sessionId: string; userId: string } | null {
    if (!rawTicket || typeof rawTicket !== "string") return null;
    const hash = hashSessionToken(rawTicket);
    const entry = this.tickets.get(hash);
    if (!entry) return null;
    this.tickets.delete(hash);
    if (entry.consumed || entry.expiresAtMs <= Date.now()) {
      return null;
    }
    entry.consumed = true;
    return { sessionId: entry.sessionId, userId: entry.userId };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, val] of this.tickets.entries()) {
      if (val.consumed || val.expiresAtMs <= now) {
        this.tickets.delete(key);
      }
    }
  }
}

export const sessionRepository = new JsonSessionRepository();
export const wsTicketStore = new WsTicketStore();
