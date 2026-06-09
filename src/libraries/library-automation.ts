import { getDatabase } from "../db/database.js";
import { findDocchiEpisodeFix } from "../docchi/docchi-public-mapper.js";
import { getAppSettings } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";
import { fetchAnimeSubSubtitles } from "../subtitles/animesub-client.js";
import { localizeSubtitleResults } from "../subtitles/subtitle-local-cache.js";
import { getSubtitleCache, saveSubtitleCache } from "../subtitles/subtitle-cache.js";
import { fetchTmdbCatalog, fetchTmdbMeta } from "../tmdb/tmdb-client.js";
import { listEnabledLibraries } from "./library-registry.js";
import type { Library, LibraryConfig, StremioCatalogMeta } from "./types.js";

const TASK_DOCCHI = "docchi";
const TASK_ANIMESUB = "animesub";
const DEFAULT_INTERVAL_HOURS = 168;
const WORKER_INTERVAL_MS = 60_000;
let running = false;
let timer: NodeJS.Timeout | undefined;

export type LibraryAutomationStatus = {
  libraryId: string;
  task: string;
  status: "idle" | "running" | "done" | "error";
  total: number;
  done: number;
  startedAt?: string;
  finishedAt?: string;
  nextRunAt?: string;
  lastError?: string;
  details?: Record<string, unknown>;
  updatedAt: string;
};

export function startLibraryAutomationWorker(): void {
  if (timer) return;
  timer = setInterval(() => void runDueLibraryAutomation(), WORKER_INTERVAL_MS);
  setTimeout(() => void runDueLibraryAutomation(), 10_000).unref?.();
}

export function listLibraryAutomationStatuses(): LibraryAutomationStatus[] {
  const rows = getDatabase().prepare("SELECT * FROM library_automation_status ORDER BY updated_at DESC").all() as AutomationRow[];
  return rows.map(rowToStatus);
}

export function listActiveLibraryAutomationStatuses(): LibraryAutomationStatus[] {
  return listLibraryAutomationStatuses().filter((item) => item.status === "running");
}

export async function runDueLibraryAutomation(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const library of listEnabledLibraries()) {
      await maybeRunDocchi(library);
      await maybeRunAnimeSub(library);
    }
  } finally {
    running = false;
  }
}

async function maybeRunDocchi(library: Library): Promise<void> {
  const mode = resolveDocchiMode(library.config);
  if (mode === "disabled") return;
  if (!shouldRun(library, TASK_DOCCHI, intervalHours(library.config.docchiAutomationIntervalHours))) return;
  await runTask(library, TASK_DOCCHI, async (items) => {
    const targets = await buildDocchiTargets(library, items, mode);
    setRunning(library.id, TASK_DOCCHI, targets.length, { mode });
    let done = 0;
    for (const id of targets) {
      await findDocchiEpisodeFix(id, { force: true }).catch((error) => writeSystemLog("warn", "library-automation", "Docchi library item failed.", { libraryId: library.id, id, error: error instanceof Error ? error.message : String(error) }));
      done += 1;
      updateProgress(library.id, TASK_DOCCHI, done, targets.length, { mode, currentId: id });
    }
  });
}

async function maybeRunAnimeSub(library: Library): Promise<void> {
  const mode = library.config.animeSubAutomationMode ?? "7d";
  if (mode === "manual") return;
  if (!shouldRun(library, TASK_ANIMESUB, intervalHours(library.config.animeSubAutomationIntervalHours ?? modeToInterval(mode)))) return;
  await runTask(library, TASK_ANIMESUB, async (items) => {
    const targets = await buildAnimeSubTargets(library, items);
    setRunning(library.id, TASK_ANIMESUB, targets.length, { mode });
    let done = 0;
    for (const target of targets) {
      const cached = getSubtitleCache(target.type, target.id);
      if (!cached?.subtitles?.length) {
        const results = await fetchAnimeSubSubtitles(target.type, target.id).catch((error) => { writeSystemLog("warn", "library-automation", "AnimeSub library item failed.", { libraryId: library.id, target, error: error instanceof Error ? error.message : String(error) }); return []; });
        const localized = await localizeSubtitleResults(target.type, target.id, results).catch(() => results);
        saveSubtitleCache(target.type, target.id, localized);
      }
      done += 1;
      updateProgress(library.id, TASK_ANIMESUB, done, targets.length, { mode, currentId: target.id });
    }
  });
}

async function runTask(library: Library, task: string, runner: (items: StremioCatalogMeta[]) => Promise<void>): Promise<void> {
  const interval = task === TASK_DOCCHI ? intervalHours(library.config.docchiAutomationIntervalHours) : intervalHours(library.config.animeSubAutomationIntervalHours ?? modeToInterval(library.config.animeSubAutomationMode ?? "7d"));
  const now = new Date();
  try {
    writeSystemLog("info", "library-automation", "Library automation task started.", { libraryId: library.id, libraryName: library.name, task });
    const items = await fetchTmdbCatalog(library, 1);
    setRunning(library.id, task, items.length, { phase: "catalog" });
    await runner(items);
    setFinished(library.id, task, interval, undefined);
    writeSystemLog("info", "library-automation", "Library automation task completed.", { libraryId: library.id, libraryName: library.name, task, responseTimeMs: Date.now() - now.getTime() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFinished(library.id, task, interval, message);
    writeSystemLog("error", "library-automation", "Library automation task failed.", { libraryId: library.id, libraryName: library.name, task, error: message });
  }
}

async function buildDocchiTargets(library: Library, items: StremioCatalogMeta[], mode: string): Promise<string[]> {
  if (mode === "series" && library.type !== "series") return [];
  const result: string[] = [];
  for (const item of items) {
    if (library.type !== "series") continue;
    if (mode === "animation_series" && !isAnimationItem(item, library.config)) continue;
    const meta = await fetchTmdbMeta("series", item.id).catch(() => null);
    for (const video of meta?.videos ?? []) if (video.id) result.push(video.id);
  }
  return Array.from(new Set(result));
}

async function buildAnimeSubTargets(library: Library, items: StremioCatalogMeta[]): Promise<Array<{ type: "movie" | "series"; id: string }>> {
  const result: Array<{ type: "movie" | "series"; id: string }> = [];
  for (const item of items) {
    if (library.type === "movie") result.push({ type: "movie", id: item.id });
    else {
      const meta = await fetchTmdbMeta("series", item.id).catch(() => null);
      for (const video of meta?.videos ?? []) if (video.id) result.push({ type: "series", id: video.id });
    }
  }
  return result;
}

function resolveDocchiMode(config: LibraryConfig): "disabled" | "animation_series" | "series" | "all" {
  const mode = config.docchiAutomationMode ?? config.docchiPublicMappingMode ?? "inherit";
  if (mode === "inherit") return getAppSettings().docchiPublicMappingMode;
  return mode;
}

function isAnimationItem(item: StremioCatalogMeta, config: LibraryConfig): boolean {
  const genreText = `${(item.genres ?? []).join(" ")} ${config.withGenres ?? ""} ${config.withKeywords ?? ""}`.toLowerCase();
  return /animation|anime|\b16\b|animacja/.test(genreText) || config.withOriginalLanguage === "ja";
}

function shouldRun(library: Library, task: string, interval: number): boolean {
  const row = getRow(library.id, task);
  if (!row) return true;
  if (row.status === "running") return false;
  if (!row.finished_at) return true;
  const next = row.next_run_at ? Date.parse(row.next_run_at) : Date.parse(row.finished_at) + interval * 60 * 60 * 1000;
  return !Number.isFinite(next) || Date.now() >= next;
}

function intervalHours(value?: number): number { return [24, 72, 168, 336, 720].includes(Number(value)) ? Number(value) : DEFAULT_INTERVAL_HOURS; }
function modeToInterval(mode: string): number { if (mode === "24h") return 24; if (mode === "3d") return 72; if (mode === "14d") return 336; if (mode === "30d") return 720; return 168; }
function getRow(libraryId: string, task: string): AutomationRow | undefined { return getDatabase().prepare("SELECT * FROM library_automation_status WHERE library_id = ? AND task = ?").get(libraryId, task) as AutomationRow | undefined; }
function setRunning(libraryId: string, task: string, total: number, details: Record<string, unknown>): void { upsert(libraryId, task, "running", total, 0, new Date().toISOString(), undefined, undefined, undefined, details); }
function updateProgress(libraryId: string, task: string, done: number, total: number, details: Record<string, unknown>): void { upsert(libraryId, task, "running", total, done, undefined, undefined, undefined, undefined, details); }
function setFinished(libraryId: string, task: string, interval: number, error?: string): void { const now = new Date(); const next = new Date(now.getTime() + interval * 60 * 60 * 1000); const row = getRow(libraryId, task); upsert(libraryId, task, error ? "error" : "done", row?.total ?? 0, row?.done ?? row?.total ?? 0, row?.started_at, now.toISOString(), next.toISOString(), error, { ...(safeJson(row?.details_json) ?? {}), nextRunAt: next.toISOString() }); }
function upsert(libraryId: string, task: string, status: string, total: number, done: number, startedAt?: string, finishedAt?: string, nextRunAt?: string, lastError?: string, details: Record<string, unknown> = {}): void { const now = new Date().toISOString(); getDatabase().prepare(`INSERT INTO library_automation_status (library_id, task, status, total, done, started_at, finished_at, next_run_at, last_error, details_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(library_id, task) DO UPDATE SET status=excluded.status,total=excluded.total,done=excluded.done,started_at=COALESCE(excluded.started_at, library_automation_status.started_at),finished_at=COALESCE(excluded.finished_at, library_automation_status.finished_at),next_run_at=COALESCE(excluded.next_run_at, library_automation_status.next_run_at),last_error=excluded.last_error,details_json=excluded.details_json,updated_at=excluded.updated_at`).run(libraryId, task, status, total, done, startedAt, finishedAt, nextRunAt, lastError, JSON.stringify(details), now); }
function rowToStatus(row: AutomationRow): LibraryAutomationStatus { return { libraryId: row.library_id, task: row.task, status: row.status as never, total: row.total, done: row.done, startedAt: row.started_at ?? undefined, finishedAt: row.finished_at ?? undefined, nextRunAt: row.next_run_at ?? undefined, lastError: row.last_error ?? undefined, details: safeJson(row.details_json) ?? {}, updatedAt: row.updated_at }; }
function safeJson(value?: string | null): Record<string, unknown> | undefined { if (!value) return undefined; try { return JSON.parse(value) as Record<string, unknown>; } catch { return undefined; } }

type AutomationRow = { library_id: string; task: string; status: string; total: number; done: number; started_at?: string | null; finished_at?: string | null; next_run_at?: string | null; last_error?: string | null; details_json: string; updated_at: string };
