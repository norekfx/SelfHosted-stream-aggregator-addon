import { getDatabase } from "../db/database.js";
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

function createMappingKey(originalId: string): string {
  return `${KEY_PREFIX}${originalId}`;
}

function invalidateMetadataCaches(seriesId: string): void {
  getDatabase().prepare("DELETE FROM meta_cache WHERE type = 'series' AND imdb_id = ?").run(seriesId);
  getDatabase().prepare("DELETE FROM library_cache").run();
}
