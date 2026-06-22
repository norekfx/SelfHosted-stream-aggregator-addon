import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "puppeteer";
import { env } from "../config/env.js";

export async function getPersistentChromiumProfileDir(profileKey: string, startUrl: string): Promise<string> {
  const parsed = new URL(startUrl);
  const host = parsed.hostname.toLowerCase();
  const safeHost = host.replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "site";
  const key = profileKey.trim() || host;
  const hash = createHash("sha256").update(key + "|" + host).digest("hex").slice(0, 20);
  const root = join(env.DATA_DIR, "chromium-profiles");
  const directory = join(root, safeHost + "-" + hash);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function getCurrentChromiumIdentity(browser: Browser, mobile: boolean): Promise<{ version: string; userAgent: string }> {
  const browserVersion = await browser.version().catch(() => "Chromium");
  const defaultUserAgent = await browser.userAgent().catch(() => "");
  const version = extractVersion(browserVersion) || extractVersion(defaultUserAgent) || "0.0.0.0";

  if (mobile) {
    return {
      version,
      userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`
    };
  }

  const normalized = defaultUserAgent
    .replace(/HeadlessChrome\//g, "Chrome/")
    .replace(/Chromium\//g, "Chrome/");

  return {
    version,
    userAgent: normalized || `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
  };
}

export function getChromiumLaunchArgs(): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required"
  ];
}

function extractVersion(value: string): string | null {
  const match = value.match(/(?:Chrome|Chromium|HeadlessChrome)\/(\d+(?:\.\d+){0,3})/i);
  if (!match?.[1]) return null;
  const parts = match[1].split(".");
  while (parts.length < 4) parts.push("0");
  return parts.slice(0, 4).join(".");
}
