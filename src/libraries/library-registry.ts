import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/database.js";
import type { Library, LibraryConfig, LibraryInput, LibraryMediaType, LibraryMode } from "./types.js";

const DOCCHI_AUTOMATION_MODES = new Set(["inherit", "disabled", "animation_series", "series", "all"]);
const ANIMESUB_AUTOMATION_MODES = new Set(["manual", "24h", "3d", "7d", "14d", "30d"]);
const ANIMESUB_MISSING_RETRY_MODES = new Set(["never", "once", "twice", "daily"]);
const AUTOMATION_INTERVALS = new Set([24, 72, 168, 336, 720]);

type LibraryRow = { id: string; name: string; slug: string; type: LibraryMediaType; source: "tmdb"; mode: LibraryMode; enabled: 0 | 1; sort_order: number; config_json: string; created_at: string; updated_at: string };

export function listLibraries(includeDisabled = true): Library[] {
  const sql = includeDisabled ? "SELECT * FROM libraries ORDER BY sort_order ASC, created_at ASC" : "SELECT * FROM libraries WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC";
  const rows = getDatabase().prepare(sql).all() as LibraryRow[];
  return rows.map(mapLibraryRow);
}
export function listEnabledLibraries(): Library[] { return listLibraries(false); }
export function getLibrary(idOrSlug: string): Library | undefined { const row = getDatabase().prepare("SELECT * FROM libraries WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as LibraryRow | undefined; return row ? mapLibraryRow(row) : undefined; }
export function getLibraryForCatalog(type: LibraryMediaType, idOrSlug: string): Library | undefined { const library = getLibrary(idOrSlug); return library && library.type === type && library.enabled ? library : undefined; }

export function createLibrary(input: LibraryInput): Library {
  const now = new Date().toISOString();
  const library: Library = { id: randomUUID(), name: input.name.trim(), slug: normalizeSlug(input.slug || input.name), type: input.type, source: input.source ?? "tmdb", mode: input.mode, enabled: input.enabled ?? true, sortOrder: input.sortOrder ?? 0, config: sanitizeConfig(input.config ?? {}), createdAt: now, updatedAt: now };
  getDatabase().prepare(`INSERT INTO libraries (id, name, slug, type, source, mode, enabled, sort_order, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(library.id, library.name, library.slug, library.type, library.source, library.mode, library.enabled ? 1 : 0, library.sortOrder, JSON.stringify(library.config), library.createdAt, library.updatedAt);
  return library;
}

export function updateLibrary(idOrSlug: string, input: Partial<LibraryInput>): Library | undefined {
  const current = getLibrary(idOrSlug);
  if (!current) return undefined;
  const updated: Library = { ...current, name: input.name?.trim() || current.name, slug: input.slug !== undefined ? normalizeSlug(input.slug || current.name) : current.slug, type: input.type ?? current.type, source: input.source ?? current.source, mode: input.mode ?? current.mode, enabled: input.enabled ?? current.enabled, sortOrder: input.sortOrder ?? current.sortOrder, config: sanitizeConfig({ ...current.config, ...(input.config ?? {}) }), updatedAt: new Date().toISOString() };
  getDatabase().prepare(`UPDATE libraries SET name = ?, slug = ?, type = ?, source = ?, mode = ?, enabled = ?, sort_order = ?, config_json = ?, updated_at = ? WHERE id = ?`).run(updated.name, updated.slug, updated.type, updated.source, updated.mode, updated.enabled ? 1 : 0, updated.sortOrder, JSON.stringify(updated.config), updated.updatedAt, current.id);
  return updated;
}
export function deleteLibrary(idOrSlug: string): boolean { const library = getLibrary(idOrSlug); if (!library) return false; const db = getDatabase(); db.transaction(() => { db.prepare("DELETE FROM library_cache WHERE library_id = ?").run(library.id); db.prepare("DELETE FROM libraries WHERE id = ?").run(library.id); })(); return true; }

function mapLibraryRow(row: LibraryRow): Library { return { id: row.id, name: row.name, slug: row.slug, type: row.type, source: row.source, mode: row.mode, enabled: row.enabled === 1, sortOrder: row.sort_order, config: safeParseConfig(row.config_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function safeParseConfig(value: string): LibraryConfig { try { const parsed = JSON.parse(value) as unknown; return sanitizeConfig(typeof parsed === "object" && parsed !== null ? parsed as LibraryConfig : {}); } catch { return {}; } }

function sanitizeConfig(config: LibraryConfig): LibraryConfig {
  const sanitized: LibraryConfig = {};
  for (const [key, value] of Object.entries(config) as Array<[keyof LibraryConfig, unknown]>) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "docchiAutomationMode") { if (typeof value === "string" && DOCCHI_AUTOMATION_MODES.has(value)) sanitized.docchiAutomationMode = value as never; continue; }
    if (key === "animeSubAutomationMode") { if (typeof value === "string" && ANIMESUB_AUTOMATION_MODES.has(value)) sanitized.animeSubAutomationMode = value as never; continue; }
    if (key === "animeSubMissingRetryMode") { if (typeof value === "string" && ANIMESUB_MISSING_RETRY_MODES.has(value)) sanitized.animeSubMissingRetryMode = value as never; continue; }
    if (key === "docchiAutomationIntervalHours" || key === "animeSubAutomationIntervalHours") { const number = Number(value); if (AUTOMATION_INTERVALS.has(number)) sanitized[key] = number as never; continue; }
    if (typeof value === "string") sanitized[key] = value.trim() as never;
    else if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value as never;
    else if (typeof value === "boolean") sanitized[key] = value as never;
  }
  if (sanitized.docchiAutomationMode && sanitized.docchiAutomationMode !== "disabled" && !sanitized.docchiAutomationIntervalHours) sanitized.docchiAutomationIntervalHours = 168;
  if (sanitized.animeSubAutomationMode && sanitized.animeSubAutomationMode !== "manual" && !sanitized.animeSubAutomationIntervalHours) sanitized.animeSubAutomationIntervalHours = 168;
  if (sanitized.animeSubAutomationMode && sanitized.animeSubAutomationMode !== "manual" && !sanitized.animeSubMissingRetryMode) sanitized.animeSubMissingRetryMode = "once";
  return sanitized;
}

function normalizeSlug(value: string): string { const slug = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); return slug || randomUUID().slice(0, 8); }
