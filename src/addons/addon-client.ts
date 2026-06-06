import { z } from "zod";
import type { ExternalAddonManifest } from "./types.js";

const manifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  resources: z.array(z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      types: z.array(z.string()).optional()
    }).passthrough()
  ])).optional(),
  types: z.array(z.string()).optional(),
  idPrefixes: z.array(z.string()).optional(),
  catalogs: z.array(z.unknown()).optional(),
  behaviorHints: z.record(z.unknown()).optional()
}).passthrough();

export function normalizeManifestUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Manifest URL is required.");
  }

  const url = new URL(trimmed);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Manifest URL must use http or https.");
  }

  if (!url.pathname.endsWith("/manifest.json")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/manifest.json`;
  }

  return url.toString();
}

export async function fetchAddonManifest(manifestUrl: string, timeoutMs = 8000): Promise<ExternalAddonManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(manifestUrl, {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Manifest request failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !contentType.includes("text/plain")) {
      throw new Error(`Unexpected manifest content type: ${contentType || "unknown"}.`);
    }

    const json = await response.json();
    return manifestSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid addon manifest: ${error.issues.map((issue) => issue.message).join(", ")}`);
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Manifest request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
