import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/database.js";

export type SystemLogLevel = "debug" | "info" | "warn" | "error";

export type SystemLogEntry = {
  id: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details?: unknown;
  createdAt: string;
};

type SystemLogRow = {
  id: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details_json: string | null;
  created_at: string;
};

export function writeSystemLog(level: SystemLogLevel, source: string, message: string, details?: unknown): void {
  try {
    getDatabase().prepare(`
      INSERT INTO system_logs (id, level, source, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), level, source, message, details === undefined ? null : JSON.stringify(details), new Date().toISOString());
  } catch {
    // Logging must never break playback or admin actions.
  }
}

export function listSystemLogs(limit = 100, level?: SystemLogLevel): SystemLogEntry[] {
  const db = getDatabase();
  const rows = level
    ? db.prepare("SELECT * FROM system_logs WHERE level = ? ORDER BY created_at DESC LIMIT ?").all(level, limit) as SystemLogRow[]
    : db.prepare("SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?").all(limit) as SystemLogRow[];

  return rows.map(mapRow);
}

export function clearSystemLogs(): void {
  getDatabase().prepare("DELETE FROM system_logs").run();
}

function mapRow(row: SystemLogRow): SystemLogEntry {
  return {
    id: row.id,
    level: row.level,
    source: row.source,
    message: row.message,
    details: row.details_json ? safeParse(row.details_json) : undefined,
    createdAt: row.created_at
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
