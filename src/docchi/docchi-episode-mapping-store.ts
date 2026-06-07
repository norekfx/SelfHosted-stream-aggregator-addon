import { getDatabase } from "../db/database.js";
import type { StremioCatalogMeta } from "../libraries/types.js";
import { writeSystemLog } from "../system/system-log.js";

export type PersistedDocchiEpisodeMapping = {
  originalId: string;
  seriesId: string;
  sourceSeason: number;
  sourceEpisode: number;
  mappedId: string;
  mappedSeason: number;
  mappedEpisode: number;
  docchiId: string;
  docchiTitle?: string;
  matchMethod?: string;
  confidence?: number;
  updatedAt: string;
};

const KEY_PREFIX = "docchi_episode_mapping:";

export function saveDocchiEpisodeMapping(mapping: Omit<PersistedDocchiEpisodeMapping, "updatedAt">): void {
  const now = new Date().toISOString();
  const value: PersistedDocchiEpisodeMapping = { ...mapping, updatedAt: now };
  getDatabase()
    .prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(createMappingKey(mapping.originalId), JSON.stringify(value), now);

  invalidateMetadataCaches(mapping.seriesId);
  writeSystemLog("info", "docchi", "Persisted Docchi episode mapping.", value);
}

export function saveDocchiEpisodeMappingFromFix(fix: {
  originalId: string;
  mappedId: string;
  docchiId?: string;
  docchiTitle?: string;
  mappedSeason?: number;
  mappedEpisode?: number;
  matchMethod?: string;
  confidence?: number;
}): void {
  const source = parseEpisodeId(fix.originalId);
  const mapped = parseEpisodeId(fix.mappedId);
  if (!source || !mapped || !fix.docchiId) return;
  saveDocchiEpisodeMapping({
    originalId: fix.originalId,
    seriesId: source.seriesId,
    sourceSeason: source.season,
    sourceEpisode: source.episode,
    mappedId: fix.mappedId,
    mappedSeason: fix.mappedSeason ?? mapped.season,
    mappedEpisode: fix.mappedEpisode ?? mapped.episode,
    docchiId: fix.docchiId,
    docchiTitle: fix.docchiTitle,
    matchMethod: fix.matchMethod,
    confidence: fix.confidence
  });
}

export function getDocchiEpisodeMapping(originalId: string): PersistedDocchiEpisodeMapping | undefined {
  const row = getDatabase()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(createMappingKey(originalId)) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.value) as PersistedDocchiEpisodeMapping;
    return parsed?.originalId === originalId ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function getDocchiEpisodeMappingByMappedId(mappedId: string): PersistedDocchiEpisodeMapping | undefined {
  const parsed = parseEpisodeId(mappedId);
  if (!parsed) return undefined;
  return listDocchiEpisodeMappingsForSeries(parsed.seriesId).find((mapping) => mapping.mappedId === mappedId);
}

export function listDocchiEpisodeMappingsForSeries(seriesId: string): PersistedDocchiEpisodeMapping[] {
  const rows = getDatabase()
    .prepare("SELECT value FROM app_settings WHERE key LIKE ?")
    .all(`${KEY_PREFIX}${seriesId}:%`) as Array<{ value: string }>;
  const mappings: PersistedDocchiEpisodeMapping[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as PersistedDocchiEpisodeMapping;
      if (parsed.seriesId === seriesId) mappings.push(parsed);
    } catch {}
  }
  return mappings.sort((a, b) => a.sourceEpisode - b.sourceEpisode);
}

export function applyPersistedDocchiMappingsToMeta(meta: StremioCatalogMeta): StremioCatalogMeta {
  if (meta.type !== "series" || !meta.videos?.length) return meta;
  const mappings = listDocchiEpisodeMappingsForSeries(meta.id);
  if (!mappings.length) return meta;
  const byOriginalId = new Map(mappings.map((mapping) => [mapping.originalId, mapping]));
  const videos = meta.videos.map((video) => {
    const mapping = byOriginalId.get(video.id);
    if (!mapping) return video;
    return {
      ...video,
      id: mapping.mappedId,
      season: mapping.mappedSeason,
      episode: mapping.mappedEpisode
    };
  }).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  return { ...meta, videos };
}

function createMappingKey(originalId: string): string {
  return `${KEY_PREFIX}${originalId}`;
}

function parseEpisodeId(id: string): { seriesId: string; season: number; episode: number } | undefined {
  const match = id.match(/^(tt\d+):(\d+):(\d+)$/i);
  if (!match) return undefined;
  const season = Number.parseInt(match[2] ?? "0", 10);
  const episode = Number.parseInt(match[3] ?? "0", 10);
  if (!season || !episode) return undefined;
  return { seriesId: match[1] ?? "", season, episode };
}

function invalidateMetadataCaches(seriesId: string): void {
  getDatabase().prepare("DELETE FROM meta_cache WHERE type = 'series' AND imdb_id = ?").run(seriesId);
  getDatabase().prepare("DELETE FROM library_cache").run();
}
