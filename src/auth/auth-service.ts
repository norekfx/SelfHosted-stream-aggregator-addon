import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { getDatabase } from "../db/database.js";

export type AdminUser = {
  id: string;
  username: string;
  createdAt: string;
  lastLoginAt?: string;
};

type AdminUserRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

type AdminSessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  username: string;
  user_created_at: string;
  last_login_at: string | null;
};

const SESSION_DAYS = 7;

export function hasAdminUser(): boolean {
  const row = getDatabase().prepare("SELECT COUNT(*) as count FROM admin_users").get() as { count: number };
  return row.count > 0;
}

export function createFirstAdmin(username: string, password: string): { user: AdminUser; token: string; expiresAt: string } {
  if (hasAdminUser()) {
    throw new Error("Admin user already exists.");
  }

  assertValidCredentials(username, password);

  const now = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const userId = randomUUID();
  const passwordHash = hashPassword(password, salt);

  getDatabase().prepare(`
    INSERT INTO admin_users (id, username, password_hash, password_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username.trim(), passwordHash, salt, now, now);

  return createSessionForUser(userId);
}

export function loginAdmin(username: string, password: string): { user: AdminUser; token: string; expiresAt: string } {
  const row = getDatabase()
    .prepare("SELECT * FROM admin_users WHERE username = ?")
    .get(username.trim()) as AdminUserRow | undefined;

  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    throw new Error("Invalid username or password.");
  }

  getDatabase()
    .prepare("UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), new Date().toISOString(), row.id);

  return createSessionForUser(row.id);
}

export function verifySessionToken(token: string | undefined): AdminUser | undefined {
  if (!token) {
    return undefined;
  }

  const tokenHash = hashToken(token);
  const row = getDatabase()
    .prepare(`
      SELECT
        admin_sessions.*,
        admin_users.username,
        admin_users.created_at as user_created_at,
        admin_users.last_login_at
      FROM admin_sessions
      JOIN admin_users ON admin_users.id = admin_sessions.user_id
      WHERE admin_sessions.token_hash = ?
    `)
    .get(tokenHash) as AdminSessionRow | undefined;

  if (!row) {
    return undefined;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSessionByHash(tokenHash);
    return undefined;
  }

  getDatabase()
    .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
    .run(new Date().toISOString(), row.id);

  return {
    id: row.user_id,
    username: row.username,
    createdAt: row.user_created_at,
    lastLoginAt: row.last_login_at ?? undefined
  };
}

export function logoutSession(token: string | undefined): void {
  if (!token) {
    return;
  }

  deleteSessionByHash(hashToken(token));
}

function createSessionForUser(userId: string): { user: AdminUser; token: string; expiresAt: string } {
  const user = getDatabase()
    .prepare("SELECT * FROM admin_users WHERE id = ?")
    .get(userId) as AdminUserRow | undefined;

  if (!user) {
    throw new Error("Admin user not found.");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  getDatabase().prepare(`
    INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, tokenHash, now.toISOString(), expires.toISOString());

  return {
    user: mapUserRow(user),
    token,
    expiresAt: expires.toISOString()
  };
}

function deleteSessionByHash(tokenHash: string): void {
  getDatabase().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertValidCredentials(username: string, password: string): void {
  if (username.trim().length < 3) {
    throw new Error("Username must have at least 3 characters.");
  }

  if (password.length < 10) {
    throw new Error("Password must have at least 10 characters.");
  }
}

function mapUserRow(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined
  };
}
