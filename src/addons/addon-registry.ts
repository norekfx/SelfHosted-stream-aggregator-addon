import { randomUUID } from "node:crypto";
import { normalizeManifestUrl } from "./addon-client.js";
import { checkAddonHealth } from "./addon-health.js";
import type { AddonRegistrationInput, AddonResource, ExternalAddonManifest, RegisteredAddon } from "./types.js";

const addons = new Map<string, RegisteredAddon>();

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

  addons.set(addon.id, addon);
  return addon;
}

export function listAddons(): RegisteredAddon[] {
  return Array.from(addons.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getAddon(addonId: string): RegisteredAddon | undefined {
  return addons.get(addonId);
}

export async function refreshAddonHealth(addonId: string): Promise<RegisteredAddon | undefined> {
  const addon = addons.get(addonId);
  if (!addon) {
    return undefined;
  }

  const health = await checkAddonHealth(addon.manifestUrl);
  const manifest = health.manifest;
  const updated: RegisteredAddon = {
    ...addon,
    name: manifest?.name ?? addon.name,
    version: manifest?.version ?? addon.version,
    description: manifest?.description ?? addon.description,
    supportedResources: manifest ? extractSupportedResources(manifest) : addon.supportedResources,
    supportedTypes: manifest?.types ?? addon.supportedTypes,
    status: health.status,
    updatedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    lastError: health.error,
    responseTimeMs: health.responseTimeMs
  };

  addons.set(addonId, updated);
  return updated;
}

export function setAddonEnabled(addonId: string, enabled: boolean): RegisteredAddon | undefined {
  const addon = addons.get(addonId);
  if (!addon) {
    return undefined;
  }

  const updated = {
    ...addon,
    enabled,
    updatedAt: new Date().toISOString()
  };
  addons.set(addonId, updated);
  return updated;
}

function findAddonByManifestUrl(manifestUrl: string): RegisteredAddon | undefined {
  return Array.from(addons.values()).find((addon) => addon.manifestUrl === manifestUrl);
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
