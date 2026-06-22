import { getDatabase } from "../db/database.js";
import { writeSystemLog } from "../system/system-log.js";

const VIDEO_EXTENSIONS = /\.(?:mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)(?:$|[?#])/i;
const VIDEO_CONTENT_TYPES = /^(?:video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|octet-stream))/i;
const MAX_CLICK_TARGETS = 20;
const NAVIGATION_TIMEOUT_MS = 60_000;

type ScrapingConfig = {
  id: string;
  name: string;
  url: string;
  cloudflare?: boolean | number;
};

type ScrapingAction = {
  type: "click";
  selector: string;
  timestamp: string;
};

export type ScrapingRunResult = {
  videoUrls: string[];
  actions: ScrapingAction[];
};

export async function runScraping(config: ScrapingConfig): Promise<ScrapingRunResult> {
  const targetUrl = validateTargetUrl(config.url);
  const cloudflare = Boolean(config.cloudflare);
  const collectedUrls = new Set<string>();
  const actions: ScrapingAction[] = [];
  let browser: Awaited<ReturnType<(typeof import("puppeteer"))["launch"]>> | undefined;

  writeSystemLog("info", "scraping", `Starting scraping for: ${config.name} (${targetUrl})`, {
    id: config.id,
    cloudflare
  });

  try {
    const puppeteer = await import("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run"
      ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(15_000);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });

    page.on("request", (request) => {
      collectCandidateUrl(collectedUrls, request.url(), targetUrl);
    });
    page.on("response", (response) => {
      const responseUrl = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      if (VIDEO_CONTENT_TYPES.test(contentType)) {
        collectCandidateUrl(collectedUrls, responseUrl, targetUrl, true);
      } else {
        collectCandidateUrl(collectedUrls, responseUrl, targetUrl);
      }
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await waitForPageToSettle(page, cloudflare ? 8_000 : 2_000);
    collectUrlsFromHtml(collectedUrls, await page.content(), page.url());

    const selectors = await page.$$eval(
      "a[href], button, [role='button'], [onclick]",
      (elements) => elements.slice(0, 50).map((element, index) => {
        const htmlElement = element as HTMLElement;
        const anchor = element as HTMLAnchorElement;
        const text = (htmlElement.innerText || htmlElement.getAttribute("aria-label") || "").trim().toLowerCase();
        const href = anchor.href || "";
        const likelyMedia = /play|watch|video|stream|episode|odtw|ogląd|player/.test(`${text} ${href}`);
        return {
          selector: element.id
            ? `#${CSS.escape(element.id)}`
            : `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
          likelyMedia
        };
      })
    );

    const clickTargets = selectors
      .sort((a, b) => Number(b.likelyMedia) - Number(a.likelyMedia))
      .slice(0, MAX_CLICK_TARGETS);

    for (const target of clickTargets) {
      try {
        const beforeUrl = page.url();
        const element = await page.$(target.selector);
        if (!element) continue;

        await element.click({ delay: 50 });
        actions.push({ type: "click", selector: target.selector, timestamp: new Date().toISOString() });
        await waitForPageToSettle(page, 1_500);
        collectUrlsFromHtml(collectedUrls, await page.content(), page.url());

        if (page.url() !== beforeUrl && page.url() !== targetUrl) {
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
          await waitForPageToSettle(page, 1_000);
        }
      } catch (error) {
        writeSystemLog("warn", "scraping", "Click target failed during scraping.", {
          id: config.id,
          selector: target.selector,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const videoUrls = [...collectedUrls];
    saveResults(config.id, videoUrls);
    writeSystemLog("info", "scraping", `Scraping completed. Found ${videoUrls.length} video URLs`, {
      id: config.id,
      actions: actions.length
    });

    return { videoUrls, actions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSystemLog("error", "scraping", `Scraping failed: ${message}`, {
      id: config.id,
      error: error instanceof Error ? error.stack : message
    });
    throw new Error(`Scraping failed: ${message}`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function getScrapingResults(configId: string): { id: string; videoUrl: string; createdAt: string }[] {
  const rows = getDatabase()
    .prepare("SELECT id, video_url, created_at FROM scraping_results WHERE config_id = ? ORDER BY created_at DESC")
    .all(configId) as Array<{ id: string; video_url: string; created_at: string }>;

  return rows.map((row) => ({ id: row.id, videoUrl: row.video_url, createdAt: row.created_at }));
}

export function clearScrapingResults(configId: string): void {
  getDatabase().prepare("DELETE FROM scraping_results WHERE config_id = ?").run(configId);
}

function validateTargetUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be scraped.");
  }
  return parsed.toString();
}

function collectUrlsFromHtml(target: Set<string>, html: string, baseUrl: string): void {
  const attributePattern = /(?:src|href|data-src|data-url|file|url)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    collectCandidateUrl(target, match[1] ?? "", baseUrl);
  }

  const absolutePattern = /https?:\\?\/\\?\/[^"'<>\s]+/gi;
  for (const match of html.matchAll(absolutePattern)) {
    collectCandidateUrl(target, (match[0] ?? "").replace(/\\\//g, "/"), baseUrl);
  }
}

function collectCandidateUrl(target: Set<string>, candidate: string, baseUrl: string, force = false): void {
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return;
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (force || VIDEO_EXTENSIONS.test(resolved.href)) target.add(resolved.href);
  } catch {
    // Ignore malformed URLs found in page markup.
  }
}

async function waitForPageToSettle(page: import("puppeteer").Page, delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(() => undefined);
}

function saveResults(configId: string, videoUrls: string[]): void {
  const db = getDatabase();
  const existing = db.prepare("SELECT 1 FROM scraping_results WHERE config_id = ? AND video_url = ? LIMIT 1");
  const insert = db.prepare("INSERT INTO scraping_results (id, config_id, video_url, created_at) VALUES (?, ?, ?, ?)");
  const save = db.transaction((urls: string[]) => {
    for (const videoUrl of urls) {
      if (existing.get(configId, videoUrl)) continue;
      insert.run(crypto.randomUUID(), configId, videoUrl, new Date().toISOString());
    }
  });
  save(videoUrls);
}
