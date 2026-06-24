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
  headless?: boolean | number;
  user_agent?: string | null;
  viewport_width?: number | null;
  viewport_height?: number | null;
  initial_wait_ms?: number | null;
  headers_json?: string | null;
};

export type ScrapingProgramAction = {
  id?: string;
  actionType: "goto" | "click" | "type" | "select" | "press" | "wait" | "waitFor" | "scroll" | "hover" | "script" | "extract";
  selector?: string | null;
  value?: string | null;
  x?: number | null;
  y?: number | null;
  waitMs?: number | null;
  sortOrder?: number;
};

export type ScrapingRunAction = {
  type: string;
  selector?: string;
  value?: string;
  status: "ok" | "error";
  message?: string;
  timestamp: string;
};

export type ScrapingRunResult = {
  videoUrls: string[];
  actions: ScrapingRunAction[];
  finalUrl: string;
  title: string;
};

export async function runScraping(config: ScrapingConfig): Promise<ScrapingRunResult> {
  const targetUrl = validateTargetUrl(config.url);
  const cloudflare = Boolean(config.cloudflare);
  const collectedUrls = new Set<string>();
  const executedActions: ScrapingRunAction[] = [];
  const program = loadProgramActions(config.id);
  let browser: Awaited<ReturnType<(typeof import("puppeteer"))["launch"]>> | undefined;

  writeSystemLog("info", "scraping", `Starting Chromium program: ${config.name} (${targetUrl})`, {
    id: config.id,
    cloudflare,
    actions: program.length
  });

  try {
    const puppeteer = await import("puppeteer");
    const executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    browser = await puppeteer.launch({
      headless: config.headless === 0 || config.headless === false ? false : true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--no-first-run",
        "--autoplay-policy=no-user-gesture-required"
      ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(20_000);
    await page.setUserAgent(
      config.user_agent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setViewport({
      width: clampNumber(config.viewport_width, 320, 7680, 1440),
      height: clampNumber(config.viewport_height, 240, 4320, 900)
    });

    const headers = parseHeaders(config.headers_json);
    if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);

    page.on("request", (request) => collectCandidateUrl(collectedUrls, request.url(), targetUrl));
    page.on("response", (response) => {
      const contentType = response.headers()["content-type"] ?? "";
      collectCandidateUrl(collectedUrls, response.url(), targetUrl, VIDEO_CONTENT_TYPES.test(contentType));
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await waitForPageToSettle(page, clampNumber(config.initial_wait_ms, 0, 120_000, cloudflare ? 8_000 : 1_500));
    collectUrlsFromHtml(collectedUrls, await page.content(), page.url());

    if (program.length) {
      for (const action of program) {
        const startedAt = new Date().toISOString();
        try {
          await executeProgramAction(page, action, collectedUrls);
          collectUrlsFromHtml(collectedUrls, await page.content(), page.url());
          executedActions.push({
            type: action.actionType,
            ...(action.selector ? { selector: action.selector } : {}),
            ...(action.value ? { value: action.value } : {}),
            status: "ok",
            timestamp: startedAt
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          executedActions.push({
            type: action.actionType,
            ...(action.selector ? { selector: action.selector } : {}),
            ...(action.value ? { value: action.value } : {}),
            status: "error",
            message,
            timestamp: startedAt
          });
          writeSystemLog("warn", "scraping", "Chromium program step failed.", {
            id: config.id,
            actionType: action.actionType,
            selector: action.selector,
            sortOrder: action.sortOrder,
            error: message
          });
          throw new Error(`Step ${action.sortOrder ?? 0} (${action.actionType}) failed: ${message}`);
        }
      }
    } else {
      await runAutomaticDiscovery(page, targetUrl, collectedUrls, executedActions, config.id);
    }

    const videoUrls = [...collectedUrls];
    saveResults(config.id, videoUrls);
    const result = {
      videoUrls,
      actions: executedActions,
      finalUrl: page.url(),
      title: await page.title().catch(() => "")
    };

    writeSystemLog("info", "scraping", `Chromium program completed. Found ${videoUrls.length} media URLs.`, {
      id: config.id,
      actions: executedActions.length,
      finalUrl: result.finalUrl
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSystemLog("error", "scraping", `Chromium program failed: ${message}`, {
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

function loadProgramActions(configId: string): ScrapingProgramAction[] {
  const rows = getDatabase()
    .prepare("SELECT id, action_type, selector, x, y, value, wait_ms, sort_order FROM scraping_actions WHERE config_id = ? ORDER BY sort_order ASC, created_at ASC")
    .all(configId) as Array<{
      id: string;
      action_type: ScrapingProgramAction["actionType"];
      selector: string | null;
      x: number | null;
      y: number | null;
      value: string | null;
      wait_ms: number | null;
      sort_order: number;
    }>;
  return rows.map((row) => ({
    id: row.id,
    actionType: row.action_type,
    selector: row.selector,
    x: row.x,
    y: row.y,
    value: row.value,
    waitMs: row.wait_ms,
    sortOrder: row.sort_order
  }));
}

async function executeProgramAction(
  page: import("puppeteer").Page,
  action: ScrapingProgramAction,
  collectedUrls: Set<string>
): Promise<void> {
  const selector = action.selector?.trim() || "";
  const value = action.value ?? "";
  const waitMs = clampNumber(action.waitMs, 0, 120_000, 0);

  switch (action.actionType) {
    case "goto":
      await page.goto(validateTargetUrl(value), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      break;
    case "click":
      requireSelector(selector, action.actionType);
      await page.waitForSelector(selector, { visible: true });
      await page.click(selector, { delay: 40 });
      break;
    case "type":
      requireSelector(selector, action.actionType);
      await page.waitForSelector(selector, { visible: true });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(selector, value, { delay: 20 });
      break;
    case "select":
      requireSelector(selector, action.actionType);
      await page.waitForSelector(selector);
      await page.select(selector, value);
      break;
    case "press":
      if (selector) {
        await page.waitForSelector(selector, { visible: true });
        await page.focus(selector);
      }
      await page.keyboard.press((value || "Enter") as import("puppeteer").KeyInput);
      break;
    case "wait":
      await delay(waitMs || clampNumber(Number(value), 0, 120_000, 1000));
      break;
    case "waitFor":
      requireSelector(selector, action.actionType);
      await page.waitForSelector(selector, { visible: value !== "hidden", timeout: waitMs || 20_000 });
      break;
    case "scroll":
      await page.evaluate(({ x, y }) => window.scrollBy(x, y), {
        x: clampNumber(action.x, -100_000, 100_000, 0),
        y: clampNumber(action.y, -100_000, 100_000, 800)
      });
      break;
    case "hover":
      requireSelector(selector, action.actionType);
      await page.waitForSelector(selector, { visible: true });
      await page.hover(selector);
      break;
    case "script":
      if (!value.trim()) throw new Error("Custom JavaScript is empty.");
      await page.evaluate((source) => {
        // Runs only inside the loaded page. It does not expose Node.js or the host filesystem.
        return (0, eval)(source);
      }, value);
      break;
    case "extract": {
      requireSelector(selector, action.actionType);
      const attribute = value.trim() || "href";
      const extracted = await page.$$eval(
        selector,
        (elements, attr) => elements.map((element) => {
          if (attr === "text" || attr === "textContent") return element.textContent ?? "";
          return element.getAttribute(attr) ?? (element as HTMLAnchorElement).href ?? "";
        }),
        attribute
      );
      for (const candidate of extracted) collectCandidateUrl(collectedUrls, candidate, page.url(), true);
      break;
    }
    default:
      throw new Error(`Unsupported action type: ${String(action.actionType)}`);
  }

  if (waitMs > 0 && action.actionType !== "wait" && action.actionType !== "waitFor") {
    await waitForPageToSettle(page, waitMs);
  }
}

async function runAutomaticDiscovery(
  page: import("puppeteer").Page,
  targetUrl: string,
  collectedUrls: Set<string>,
  actions: ScrapingRunAction[],
  configId: string
): Promise<void> {
  const selectors = await page.$$eval("a[href], button, [role='button'], [onclick]", (elements) =>
    elements.slice(0, 50).map((element, index) => {
      const htmlElement = element as HTMLElement;
      const anchor = element as HTMLAnchorElement;
      const text = (htmlElement.innerText || htmlElement.getAttribute("aria-label") || "").trim().toLowerCase();
      const href = anchor.href || "";
      return {
        selector: element.id ? `#${CSS.escape(element.id)}` : `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
        likelyMedia: /play|watch|video|stream|episode|odtw|ogląd|player/.test(`${text} ${href}`)
      };
    })
  );

  for (const target of selectors.sort((a, b) => Number(b.likelyMedia) - Number(a.likelyMedia)).slice(0, MAX_CLICK_TARGETS)) {
    try {
      const beforeUrl = page.url();
      const element = await page.$(target.selector);
      if (!element) continue;
      await element.click({ delay: 50 });
      actions.push({ type: "auto-click", selector: target.selector, status: "ok", timestamp: new Date().toISOString() });
      await waitForPageToSettle(page, 1_500);
      collectUrlsFromHtml(collectedUrls, await page.content(), page.url());
      if (page.url() !== beforeUrl && page.url() !== targetUrl) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
        await waitForPageToSettle(page, 1_000);
      }
    } catch (error) {
      writeSystemLog("warn", "scraping", "Automatic click failed.", {
        id: configId,
        selector: target.selector,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function validateTargetUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs can be scraped.");
  return parsed.toString();
}

function collectUrlsFromHtml(target: Set<string>, html: string, baseUrl: string): void {
  const attributePattern = /(?:src|href|data-src|data-url|file|url)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) collectCandidateUrl(target, match[1] ?? "", baseUrl);
  const absolutePattern = /https?:\\?\/\\?\/[^"'<>\s]+/gi;
  for (const match of html.matchAll(absolutePattern)) collectCandidateUrl(target, (match[0] ?? "").replace(/\\\//g, "/"), baseUrl);
}

function collectCandidateUrl(target: Set<string>, candidate: string, baseUrl: string, force = false): void {
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return;
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (force || VIDEO_EXTENSIONS.test(resolved.href)) target.add(resolved.href);
  } catch {
    // Ignore malformed URLs.
  }
}

async function waitForPageToSettle(page: import("puppeteer").Page, delayMs: number): Promise<void> {
  await delay(delayMs);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(() => undefined);
}

function saveResults(configId: string, videoUrls: string[]): void {
  const db = getDatabase();
  const existing = db.prepare("SELECT 1 FROM scraping_results WHERE config_id = ? AND video_url = ? LIMIT 1");
  const insert = db.prepare("INSERT INTO scraping_results (id, config_id, video_url, created_at) VALUES (?, ?, ?, ?)");
  db.transaction((urls: string[]) => {
    for (const videoUrl of urls) {
      if (existing.get(configId, videoUrl)) continue;
      insert.run(crypto.randomUUID(), configId, videoUrl, new Date().toISOString());
    }
  })(videoUrls);
}

function parseHeaders(value?: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function requireSelector(selector: string, actionType: string): void {
  if (!selector) throw new Error(`Selector is required for ${actionType}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
