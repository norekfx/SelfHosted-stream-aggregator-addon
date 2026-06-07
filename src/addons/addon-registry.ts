import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/database.js";
import { normalizeManifestUrl } from "./addon-client.js";
import { checkAddonHealth } from "./addon-health.js";
import type { AddonHealthStatus, AddonRegistrationInput, AddonResource, ExternalAddonManifest, RegisteredAddon } from "./types.js";

type AddonRow = {
  id: string;
  manifest_url: string;
  name: string | null;
  version: string | null;
  description: string | null;
  supported_resources_json: string;
  supported_types_json: string;
  status: AddonHealthStatus;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_error: string | null;
  response_time_ms: number | null;
};

export type DeleteAddonResult =
  | { status: "deleted"; addon: RegisteredAddon }
  | { status: "enabled"; addon: RegisteredAddon }
  | { status: "not_found" };

export async function registerAddon(input: AddonRegistrationInput): Promise<RegisteredAddon> {
  const manifestUrl = normalizeManifestUrl(input.manifestUrl);
  const existing = findAddonByManifestUrl(manifestUrl);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const health = await checkAddonHealth(manifestUrl);
  const manifest = health.manifest;

  const addon: RegisteredAddon = {
    id: randomUUID(),
    manifestUrl,
    name: manifest?.name,
    version: manifest?.version,
    description: manifest?.description,
    supportedResources: manifest ? extractSupportedResources(manifest) : [],
    supportedTypes: manifest?.types ?? [],
    status: health.status,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: now,
    lastError: health.error,
    responseTimeMs: health.responseTimeMs
  };

  insertAddon(addon);
  return addon;
}

export function listAddons(): RegisteredAddon[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM addons ORDER BY created_at ASC")
    .all() as AddonRow[];

  return rows.map(mapAddonRow);
}

export function getAddon(addonId: string): RegisteredAddon | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM addons WHERE id = ?")
    .get(addonId) as AddonRow | undefined;

  return row ? mapAddonRow(row) : undefined;
}

export async function refreshAddonHealth(addonId: string): Promise<RegisteredAddon | undefined> {
  const addon = getAddon(addonId);
  if (!addon) {
    return undefined;
  }

  const health = await checkAddonHealth(addon.manifestUrl);
  const manifest = health.manifest;
  const now = new Date().toISOString();

  const updated: RegisteredAddon = {
    ...addon,
    name: manifest?.name ?? addon.name,
    version: manifest?.version ?? addon.version,
    description: manifest?.description ?? addon.description,
    supportedResources: manifest ? extractSupportedResources(manifest) : addon.supportedResources,
    supportedTypes: manifest?.types ?? addon.supportedTypes,
    status: health.status,
    updatedAt: now,
    lastCheckedAt: now,
    lastError: health.error,
    responseTimeMs: health.responseTimeMs
  };

  updateAddon(updated);
  return updated;
}

export function setAddonEnabled(addonId: string, enabled: boolean): RegisteredAddon | undefined {
  const addon = getAddon(addonId);
  if (!addon) {
    return undefined;
  }

  const updated: RegisteredAddon = {
    ...addon,
    enabled,
    updatedAt: new Date().toISOString()
  };

  updateAddon(updated);
  return updated;
}

export function deleteAddon(addonId: string): DeleteAddonResult {
  const addon = getAddon(addonId);
  if (!addon) {
    return { status: "not_found" };
  }

  if (addon.enabled) {
    return { status: "enabled", addon };
  }

  getDatabase().prepare("DELETE FROM addons WHERE id = ?").run(addonId);
  return { status: "deleted", addon };
}

function findAddonByManifestUrl(manifestUrl: string): RegisteredAddon | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM addons WHERE manifest_url = ?")
    .get(manifestUrl) as AddonRow | undefined;

  return row ? mapAddonRow(row) : undefined;
}

function insertAddon(addon: RegisteredAddon): void {
  getDatabase()
    .prepare(`
      INSERT INTO addons (
        id,
        manifest_url,
        name,
        version,
        description,
        supported_resources_json,
        supported_types_json,
        status,
        enabled,
        created_at,
        updated_at,
        last_checked_at,
        last_error,
        response_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      addon.id,
      addon.manifestUrl,
      addon.name ?? null,
      addon.version ?? null,
      addon.description ?? null,
      JSON.stringify(addon.supportedResources),
      JSON.stringify(addon.supportedTypes),
      addon.status,
      addon.enabled ? 1 : 0,
      addon.createdAt,
      addon.updatedAt,
      addon.lastCheckedAt ?? null,
      addon.lastError ?? null,
      addon.responseTimeMs ?? null
    );
}

function updateAddon(addon: RegisteredAddon): void {
  getDatabase()
    .prepare(`
      UPDATE addons
      SET
        name = ?,
        version = ?,
        description = ?,
        supported_resources_json = ?,
        supported_types_json = ?,
        status = ?,
        enabled = ?,
        updated_at = ?,
        last_checked_at = ?,
        last_error = ?,
        response_time_ms = ?
      WHERE id = ?
    `)
    .run(
      addon.name ?? null,
      addon.version ?? null,
      addon.description ?? null,
      JSON.stringify(addon.supportedResources),
      JSON.stringify(addon.supportedTypes),
      addon.status,
      addon.enabled ? 1 : 0,
      addon.updatedAt,
      addon.lastCheckedAt ?? null,
      addon.lastError ?? null,
      addon.responseTimeMs ?? null,
      addon.id
    );
}

function mapAddonRow(row: AddonRow): RegisteredAddon {
  return {
    id: row.id,
    manifestUrl: row.manifest_url,
    name: row.name ?? undefined,
    version: row.version ?? undefined,
    description: row.description ?? undefined,
    supportedResources: parseJsonArray<AddonResource>(row.supported_resources_json),
    supportedTypes: parseJsonArray<string>(row.supported_types_json),
    status: row.status,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at ?? undefined,
    lastError: row.last_error ?? undefined,
    responseTimeMs: row.response_time_ms ?? undefined
  };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function extractSupportedResources(manifest: ExternalAddonManifest): AddonResource[] {
  const supported = new Set<AddonResource>();

  for (const resource of manifest.resources ?? []) {
    const name = typeof resource === "string" ? resource : resource.name;
    if (name === "catalog" || name === "meta" || name === "stream" || name === "subtitles") {
      supported.add(name);
    }
  }

  return Array.from(supported);
}
