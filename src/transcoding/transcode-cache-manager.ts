import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTranscodeCacheDir } from "../config/env.js";
import { getAppSettings } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";

export type TranscodeCacheInfo = {
  id: string;
  mode: "live" | "vod";
  title?: string;
  streamId?: string;
  quality?: string;
  sourceQuality?: string;
  strategy?: string;
  createdAt?: string;
  updatedAt?: string;
  poster?: string;
};

export type TranscodeCacheItem = TranscodeCacheInfo & {
  path: string;
  sizeBytes: number;
  segmentCount: number;
  totalSegments?: number;
  generatedSeconds?: number;
  totalSeconds?: number;
  progressPercent?: number;
  lastModifiedAt: string;
};

export type TranscodeCacheReport = {
  root: string;
  limitGb: number;
  limitBytes: number;
  totalBytes: number;
  itemCount: number;
  movieCount: number;
  episodeCount: number;
  prunedBytes?: number;
  prunedItems?: number;
  items: TranscodeCacheItem[];
};

const INFO_FILE = "cache-info.json";
const GB = 1024 * 1024 * 1024;

export function writeTranscodeCacheInfo(directory: string, info: Omit<TranscodeCacheInfo, "updatedAt">): void {
  try {
    mkdirSync(directory, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(join(directory, INFO_FILE), JSON.stringify({ ...info, updatedAt: now }, null, 2), "utf-8");
  } catch (error) {
    writeSystemLog("warn", "transcode-cache", "Could not write transcode cache metadata.", { directory, error: error instanceof Error ? error.message : String(error) });
  }
}

export function getTranscodeCacheReport(prune = true): TranscodeCacheReport {
  if (prune) enforceTranscodeCacheLimit();
  const root = getTranscodeCacheDir();
  const items = listTranscodeCacheItems();
  const settings = getAppSettings();
  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  return {
    root,
    limitGb: settings.transcodeCacheLimitGb,
    limitBytes: settings.transcodeCacheLimitGb * GB,
    totalBytes,
    itemCount: items.length,
    movieCount: items.filter((item) => !isEpisodeLike(item)).length,
    episodeCount: items.filter(isEpisodeLike).length,
    items
  };
}

export function clearTranscodeCache(): { deletedBytes: number; deletedItems: number } {
  const root = getTranscodeCacheDir();
  const items = listTranscodeCacheItems();
  let deletedBytes = 0;
  let deletedItems = 0;
  for (const item of items) {
    try {
      rmSync(item.path, { recursive: true, force: true });
      deletedBytes += item.sizeBytes;
      deletedItems += 1;
    } catch (error) {
      writeSystemLog("warn", "transcode-cache", "Could not delete transcode cache item.", { path: item.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (existsSync(root)) {
    try { mkdirSync(join(root, "vod"), { recursive: true }); } catch {}
  }
  writeSystemLog("info", "transcode-cache", "Transcode cache cleared.", { deletedBytes, deletedItems });
  return { deletedBytes, deletedItems };
}

export function enforceTranscodeCacheLimit(): { prunedBytes: number; prunedItems: number } {
  const limitBytes = getAppSettings().transcodeCacheLimitGb * GB;
  const items = listTranscodeCacheItems().sort((a, b) => new Date(a.lastModifiedAt).getTime() - new Date(b.lastModifiedAt).getTime());
  let totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  let prunedBytes = 0;
  let prunedItems = 0;
  for (const item of items) {
    if (totalBytes <= limitBytes) break;
    try {
      rmSync(item.path, { recursive: true, force: true });
      totalBytes -= item.sizeBytes;
      prunedBytes += item.sizeBytes;
      prunedItems += 1;
    } catch (error) {
      writeSystemLog("warn", "transcode-cache", "Could not prune transcode cache item.", { path: item.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (prunedItems > 0) writeSystemLog("info", "transcode-cache", "Old transcode cache entries pruned after reaching limit.", { limitBytes, prunedBytes, prunedItems });
  return { prunedBytes, prunedItems };
}

function listTranscodeCacheItems(): TranscodeCacheItem[] {
  const root = getTranscodeCacheDir();
  if (!existsSync(root)) return [];
  const items: TranscodeCacheItem[] = [];
  for (const entry of safeReadDir(root)) {
    const path = join(root, entry);
    if (entry === "vod") {
      for (const vodEntry of safeReadDir(path)) {
        const vodPath = join(path, vodEntry);
        if (safeIsDirectory(vodPath)) items.push(buildItem(vodEntry, vodPath, "vod"));
      }
      continue;
    }
    if (safeIsDirectory(path)) items.push(buildItem(entry, path, "live"));
  }
  return items.sort((a, b) => new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime());
}

function buildItem(id: string, path: string, fallbackMode: "live" | "vod"): TranscodeCacheItem {
  const info = readInfo(path) ?? decodeInfo(id, fallbackMode);
  const size = scanDirectory(path);
  const playlist = readPlaylist(path);
  const segmentCount = countSegments(path);
  const totalSegments = playlist.segmentCount || undefined;
  const totalSeconds = playlist.durationSeconds || undefined;
  const generatedSeconds = segmentCount * (playlist.targetDuration || 0 || 0);
  const progressPercent = totalSegments ? Math.min(100, Math.round((segmentCount / totalSegments) * 100)) : undefined;
  return {
    ...info,
    id,
    mode: info.mode ?? fallbackMode,
    path,
    sizeBytes: size.bytes,
    segmentCount,
    totalSegments,
    generatedSeconds: generatedSeconds || undefined,
    totalSeconds,
    progressPercent,
    lastModifiedAt: new Date(size.mtimeMs || Date.now()).toISOString()
  };
}

function readInfo(path: string): TranscodeCacheInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(path, INFO_FILE), "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as TranscodeCacheInfo : undefined;
  } catch { return undefined; }
}

function decodeInfo(id: string, mode: "live" | "vod"): TranscodeCacheInfo {
  try {
    const parts = Buffer.from(id, "base64url").toString("utf-8").split("|");
    return { id, mode, streamId: parts[0], quality: parts[1], title: parts[0] };
  } catch {
    return { id, mode, title: id };
  }
}

function readPlaylist(path: string): { segmentCount: number; durationSeconds: number; targetDuration: number } {
  const candidates = [join(path, "master.m3u8"), ...safeReadDir(path).filter((file) => file.endsWith(".m3u8")).map((file) => join(path, file))];
  for (const candidate of candidates) {
    try {
      const text = readFileSync(candidate, "utf-8");
      const durations = Array.from(text.matchAll(/#EXTINF:([0-9.]+)/g)).map((match) => Number.parseFloat(match[1] ?? "0")).filter(Number.isFinite);
      const target = Number.parseFloat(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1] ?? "0");
      if (durations.length) return { segmentCount: durations.length, durationSeconds: durations.reduce((sum, value) => sum + value, 0), targetDuration: Number.isFinite(target) && target > 0 ? target : Math.max(...durations) };
    } catch {}
  }
  return { segmentCount: 0, durationSeconds: 0, targetDuration: 0 };
}

function countSegments(path: string): number {
  return safeReadDir(path).filter((file) => /^segment_\d{5}\.ts$/.test(file)).length;
}

function scanDirectory(path: string): { bytes: number; mtimeMs: number } {
  let bytes = 0;
  let mtimeMs = 0;
  try {
    const stat = statSync(path);
    mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
    if (stat.isFile()) return { bytes: stat.size, mtimeMs };
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const result = scanDirectory(join(path, entry.name));
      bytes += result.bytes;
      mtimeMs = Math.max(mtimeMs, result.mtimeMs);
    }
  } catch {}
  return { bytes, mtimeMs };
}

function safeReadDir(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function safeIsDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isEpisodeLike(item: TranscodeCacheItem): boolean {
  return /S\d{1,2}E\d{1,3}|season|episode|odcinek|serial/i.test(`${item.title ?? ""} ${item.streamId ?? ""}`);
}
