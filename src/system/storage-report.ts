import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getDatabase } from "../db/database.js";
import { env, getDatabasePath, getTranscodeCacheDir } from "../config/env.js";

export type StorageReport = {
  generatedAt: string;
  totalBytes: number;
  files: StorageFileInfo[];
  categories: StorageCategoryInfo[];
};

type StorageFileInfo = { label: string; path: string; bytes: number; kind: "file" | "directory"; description: string };
type StorageCategoryInfo = { key: string; label: string; bytes: number; rows: number; description: string };

type CountRow = { count: number };
type SizeRow = { bytes: number | null };

export function getStorageReport(): StorageReport {
  const files = getAddonFiles();
  const categories = getDatabaseCategories();
  const fileTotal = files.reduce((sum, item) => sum + item.bytes, 0);
  const dbCategoryTotal = categories.reduce((sum, item) => sum + item.bytes, 0);
  return {
    generatedAt: new Date().toISOString(),
    totalBytes: Math.max(fileTotal, dbCategoryTotal + files.filter((file) => !isDatabaseFile(file.path)).reduce((sum, item) => sum + item.bytes, 0)),
    files,
    categories
  };
}

function getAddonFiles(): StorageFileInfo[] {
  const databasePath = getDatabasePath();
  const databaseDir = dirname(databasePath);
  const databaseBase = basename(databasePath);
  const knownFiles: StorageFileInfo[] = [
    fileInfo("Baza SQLite", databasePath, "Główna baza danych addonu: cache, historia, biblioteki, ustawienia, napisy i logi."),
    fileInfo("SQLite WAL", `${databasePath}-wal`, "Dziennik WAL SQLite. Może chwilowo rosnąć i kurczyć się po checkpointach."),
    fileInfo("SQLite SHM", `${databasePath}-shm`, "Plik współdzielony SQLite używany razem z WAL."),
    dirInfo("Cache transkodowania", getTranscodeCacheDir(), "Pliki HLS/segmenty tworzone podczas transkodowania."),
    dirInfo("Katalog bazy", databaseDir, `Katalog z plikami bazy zaczynającymi się od ${databaseBase}.`)
  ];
  return knownFiles.filter((item, index, array) => item.bytes > 0 || existsSync(item.path)).filter((item, index, array) => array.findIndex((other) => other.path === item.path) === index);
}

function getDatabaseCategories(): StorageCategoryInfo[] {
  const categories: StorageCategoryInfo[] = [
    tableCategory("subtitles", "Napisy AnimeSub", ["subtitle_cache"], ["subtitles_json", "addon_results_json"], "Cache napisów, w tym lokalne treści WebVTT zapisane w bazie."),
    tableCategory("stream_cache", "Cache streamów", ["search_cache"], ["selected_original_json", "ranked_streams_json", "stats_json"], "Zapamiętane wyniki agregacji streamów."),
    tableCategory("history", "Historia wyszukiwań", ["search_history"], ["selected_original_json", "result_json"], "Historia zapytań diagnostycznych i normalnych wyszukiwań."),
    tableCategory("libraries", "Biblioteki i cache katalogów", ["libraries", "library_cache", "meta_cache", "library_automation_status"], ["config_json", "items_json", "meta_json", "details_json"], "Definicje bibliotek, cache katalogów TMDB, metadane i status automatyzacji."),
    tableCategory("addons", "Addony", ["addons"], ["supported_resources_json", "supported_types_json", "description", "last_error"], "Zarejestrowane addony i ich statusy."),
    tableCategory("settings", "Ustawienia i bezpieczeństwo", ["app_settings", "admin_users", "admin_sessions", "schema_migrations"], ["value", "password_hash", "password_salt", "token_hash", "name"], "Ustawienia panelu, konta admina, sesje i migracje."),
    tableCategory("logs", "Logi systemowe", ["system_logs"], ["message", "details_json"], "Logi widoczne w zakładce System."),
  ];
  return categories.filter((category) => category.rows > 0 || category.bytes > 0);
}

function tableCategory(key: string, label: string, tables: string[], columns: string[], description: string): StorageCategoryInfo {
  let rows = 0;
  let bytes = 0;
  for (const table of tables) {
    if (!tableExists(table)) continue;
    rows += tableRows(table);
    bytes += estimateTableBytes(table, columns);
  }
  return { key, label, rows, bytes, description };
}

function tableExists(table: string): boolean {
  const row = getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function tableRows(table: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get() as CountRow;
  return Number(row.count || 0);
}

function estimateTableBytes(table: string, columns: string[]): number {
  const existing = columns.filter((column) => columnExists(table, column));
  if (!existing.length) return Math.max(0, tableRows(table) * 256);
  const expr = existing.map((column) => `COALESCE(LENGTH(${quoteIdent(column)}), 0)`).join(" + ");
  const row = getDatabase().prepare(`SELECT SUM(${expr}) AS bytes FROM ${quoteIdent(table)}`).get() as SizeRow;
  return Number(row.bytes || 0);
}

function columnExists(table: string, column: string): boolean {
  const rows = getDatabase().prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function fileInfo(label: string, path: string, description: string): StorageFileInfo {
  return { label, path, bytes: safeFileSize(path), kind: "file", description };
}

function dirInfo(label: string, path: string, description: string): StorageFileInfo {
  return { label, path, bytes: safeDirSize(path), kind: "directory", description };
}

function safeFileSize(path: string): number {
  try { return existsSync(path) ? statSync(path).size : 0; } catch { return 0; }
}

function safeDirSize(path: string, depth = 0): number {
  try {
    if (!existsSync(path)) return 0;
    const stat = statSync(path);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory() || depth > 8) return 0;
    return readdirSync(path).reduce((sum, entry) => sum + safeDirSize(join(path, entry), depth + 1), 0);
  } catch { return 0; }
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isDatabaseFile(path: string): boolean {
  const databasePath = getDatabasePath();
  return path === databasePath || path === `${databasePath}-wal` || path === `${databasePath}-shm`;
}
