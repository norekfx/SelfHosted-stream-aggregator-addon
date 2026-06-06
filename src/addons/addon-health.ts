import { fetchAddonManifest } from "./addon-client.js";
import type { AddonHealthResult } from "./types.js";

export async function checkAddonHealth(manifestUrl: string): Promise<AddonHealthResult> {
  const startedAt = Date.now();

  try {
    const manifest = await fetchAddonManifest(manifestUrl);
    return {
      status: "online",
      responseTimeMs: Date.now() - startedAt,
      manifest
    };
  } catch (error) {
    return {
      status: error instanceof Error && error.message.startsWith("Invalid addon manifest") ? "invalid" : "offline",
      responseTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown addon health error."
    };
  }
}
