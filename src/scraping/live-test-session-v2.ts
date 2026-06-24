import type { Browser, KeyInput, Page } from "puppeteer";
import { getDatabase } from "../db/database.js";
import { writeSystemLog } from "../system/system-log.js";
import { detectActiveChallenge } from "./active-challenge-detector.js";
import { chooseMostSimilarPage, decodeClickMetadata, isExpectedAdClick, isObviousAdUrl, tabLabel } from "./browser-tab-strategy.js";
import { getChromiumLaunchArgs, getCurrentChromiumIdentity, getPersistentChromiumProfileDir } from "./chromium-profile.js";
import type { ScrapingProgramAction } from "./scraping-engine.js";

const VIDEO_PATTERN = /\.(?:mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)(?:$|[?#])/i;

type TestStatus = "starting" | "running" | "paused_captcha" | "completed" | "completed_with_errors" | "failed" | "stopped";
type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";
type ProgramRow = {
  id: string;
  name: string;
  url: string;
  viewport_width: number | null;
  viewport_height: number | null;
  user_agent: string | null;
  headers_json: string | null;
  initial_wait_ms: number | null;
};
type ActionRow = {
  id: string;
  action_type: ScrapingProgramAction["actionType"];
  selector: string | null;
  x: number | null;
  y: number | null;
  value: string | null;
  wait_ms: number | null;
  sort_order: number;
};

export type LiveTestStep = ScrapingProgramAction & {
  index: number;
  status: StepStatus;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
};
export type CaptchaState = { detected: boolean; kind: string; message: string; detectedAt: string };
export type LiveTestEvent = { id: string; type: "info" | "step" | "captcha" | "error" | "success"; message: string; createdAt: string };

type LiveTestSession = {
  id: string;
  programId: string;
  programName: string;
  startUrl: string;
  browser: Browser;
  page: Page;
  browserVersion: string;
  userAgent: string;
  width: number;
  height: number;
  headers: Record<string, string>;
  tabs: Map<string, Page>;
  attachedPages: WeakSet<Page>;
  actions: ScrapingProgramAction[];
  steps: LiveTestStep[];
  events: LiveTestEvent[];
  videoUrls: Set<string>;
  status: TestStatus;
  currentStepIndex: number;
  successfulSteps: number;
  failedSteps: number;
  skippedSteps: number;
  captcha: CaptchaState | null;
  runnerActive: boolean;
  stopRequested: boolean;
  createdAt: string;
  touchedAt: string;
  finishedAt: string | null;
};

const sessions = new Map<string, LiveTestSession>();
let cleanupTimer: NodeJS.Timeout | undefined;

export async function createLiveTestSession(programId: string) {
  ensureCleanup();
  const db = getDatabase();
  const program = db.prepare("SELECT * FROM scraping_configs WHERE id = ?").get(programId) as ProgramRow | undefined;
  if (!program) throw new Error("Nie znaleziono procesu scrapowania.");
  const rows = db.prepare(
    "SELECT id, action_type, selector, x, y, value, wait_ms, sort_order FROM scraping_actions WHERE config_id = ? ORDER BY sort_order ASC, created_at ASC"
  ).all(programId) as ActionRow[];
  const actions: ScrapingProgramAction[] = rows.map((row) => ({
    id: row.id,
    actionType: row.action_type,
    selector: row.selector,
    x: row.x,
    y: row.y,
    value: row.value,
    waitMs: row.wait_ms,
    sortOrder: row.sort_order
  }));

  const width = clamp(program.viewport_width, 320, 2560, 1280);
  const height = clamp(program.viewport_height, 240, 1600, 720);
  const startUrl = validateUrl(program.url);
  const puppeteer = await import("puppeteer");
  const executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const userDataDir = await getPersistentChromiumProfileDir(startUrl);
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    ...(executablePath ? { executablePath } : {}),
    args: getChromiumLaunchArgs()
  });
  const identity = await getCurrentChromiumIdentity(browser, width < 600);
  const headers = parseHeaders(program.headers_json);
  const page = await browser.newPage();
  await configurePage(page, program.user_agent?.trim() || identity.userAgent, width, height, headers);

  const now = new Date().toISOString();
  const session: LiveTestSession = {
    id: crypto.randomUUID(),
    programId,
    programName: program.name,
    startUrl,
    browser,
    page,
    browserVersion: identity.version,
    userAgent: program.user_agent?.trim() || identity.userAgent,
    width,
    height,
    headers,
    tabs: new Map<string, Page>(),
    attachedPages: new WeakSet<Page>(),
    actions,
    steps: actions.map((action, index) => ({ ...action, index, status: "pending" })),
    events: [],
    videoUrls: new Set<string>(),
    status: "starting",
    currentStepIndex: 0,
    successfulSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    captcha: null,
    runnerActive: false,
    stopRequested: false,
    createdAt: now,
    touchedAt: now,
    finishedAt: null
  };
  sessions.set(session.id, session);
  attachPage(session, page);
  browser.on("targetcreated", (target) => void attachCreatedPage(session, target));
  browser.on("disconnected", () => sessions.delete(session.id));
  addEvent(session, "info", `Uruchamianie testu procesu „${program.name}” w Chromium ${identity.version}.`);

  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page, clamp(program.initial_wait_ms, 0, 120_000, 1000));
    session.status = actions.length ? "running" : "failed";
    if (!actions.length) {
      session.finishedAt = new Date().toISOString();
      addEvent(session, "error", "Proces nie zawiera żadnych kroków do przetestowania.");
    } else {
      void runRemainingSteps(session.id);
    }
    return publicState(session);
  } catch (error) {
    session.status = "failed";
    session.finishedAt = new Date().toISOString();
    addEvent(session, "error", `Nie udało się otworzyć strony startowej: ${message(error)}`);
    return publicState(session);
  }
}

export function getLiveTestState(id: string) {
  const session = requireSession(id);
  touch(session);
  return publicState(session);
}

export async function getLiveTestScreenshot(id: string): Promise<Buffer> {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  return Buffer.from(await page.screenshot({ type: "jpeg", quality: 72, fullPage: false, captureBeyondViewport: false }));
}

export async function clickLiveTest(id: string, xInput: number, yInput: number) {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  const x = clamp(xInput, 0, session.width - 1, 0);
  const y = clamp(yInput, 0, session.height - 1, 0);
  await page.mouse.move(x, y, { steps: 8 });
  await delay(40);
  await page.mouse.click(x, y, { delay: 70 });
  await settle(page, 180);
  return publicState(session);
}

export async function typeLiveTest(id: string, text: string, replace = true) {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  if (replace) {
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(text, { delay: 35 });
  return publicState(session);
}

export async function keyLiveTest(id: string, keyInput: string) {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  await page.keyboard.press(normalizeKey(keyInput));
  await settle(page, 150);
  return publicState(session);
}

export async function scrollLiveTest(id: string, deltaYInput: number) {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  await page.mouse.wheel({ deltaY: clamp(deltaYInput, -4000, 4000, 0) });
  return publicState(session);
}

export async function commandLiveTest(id: string, command: "back" | "forward" | "reload") {
  const session = requireSession(id);
  touch(session);
  const page = await ensurePage(session);
  if (command === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  await settle(page, 300);
  return publicState(session);
}

export async function resumeLiveTest(id: string, force = false) {
  const session = requireSession(id);
  touch(session);
  if (session.status !== "paused_captcha") return publicState(session);
  const active = await detectActiveChallenge(await ensurePage(session));
  if (active.detected && !force) throw new Error("Aktywna weryfikacja nadal jest widoczna.");
  session.captcha = null;
  session.status = "running";
  addEvent(session, "info", "Wznowiono test po ręcznej weryfikacji.");
  void runRemainingSteps(id);
  return publicState(session);
}

export async function skipCurrentLiveTestStep(id: string) {
  const session = requireSession(id);
  touch(session);
  const step = session.steps[session.currentStepIndex];
  if (step && (step.status === "pending" || step.status === "running")) {
    step.status = "skipped";
    step.message = "Pominięto ręcznie przez użytkownika.";
    step.finishedAt = new Date().toISOString();
    session.skippedSteps += 1;
    session.currentStepIndex += 1;
    addEvent(session, "info", `Pominięto krok ${step.index + 1}: ${step.actionType}.`);
  }
  session.captcha = null;
  session.status = "running";
  void runRemainingSteps(id);
  return publicState(session);
}

export async function stopLiveTest(id: string) {
  const session = requireSession(id);
  session.stopRequested = true;
  session.status = "stopped";
  session.finishedAt = new Date().toISOString();
  addEvent(session, "info", "Test został zatrzymany przez użytkownika.");
  return publicState(session);
}

export async function closeLiveTest(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.stopRequested = true;
  await session.browser.close().catch(() => undefined);
}

async function runRemainingSteps(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.runnerActive || session.status !== "running") return;
  session.runnerActive = true;
  try {
    while (!session.stopRequested && session.status === "running" && session.currentStepIndex < session.actions.length) {
      const page = await ensurePage(session);
      const before = await challengeState(page);
      if (before) {
        pauseForChallenge(session, before);
        return;
      }

      const index = session.currentStepIndex;
      const action = session.actions[index];
      const step = session.steps[index];
      if (!action || !step) break;
      step.status = "running";
      step.startedAt = new Date().toISOString();
      addEvent(session, "step", `Krok ${index + 1}/${session.actions.length}: ${action.actionType}.`);

      try {
        await executeAction(session, action);
        step.status = "ok";
        step.finishedAt = new Date().toISOString();
        session.successfulSteps += 1;
        addEvent(session, "success", `Krok ${index + 1} wykonany poprawnie.`);
      } catch (error) {
        const text = message(error);
        step.status = "failed";
        step.message = text;
        step.finishedAt = new Date().toISOString();
        session.failedSteps += 1;
        addEvent(session, "error", `Krok ${index + 1} nie powiódł się i został pominięty: ${text}`);
        writeSystemLog("warn", "scraping-test", "Live scraper test step failed and was skipped.", {
          programId: session.programId,
          step: index + 1,
          actionType: action.actionType,
          selector: action.selector,
          error: text
        });
      }

      session.currentStepIndex += 1;
      const after = await challengeState(await ensurePage(session));
      if (after) {
        pauseForChallenge(session, after);
        return;
      }
    }
    if (!session.stopRequested && session.status === "running") finishSession(session);
  } finally {
    session.runnerActive = false;
  }
}

async function executeAction(session: LiveTestSession, action: ScrapingProgramAction) {
  const page = await ensurePage(session);
  const selector = action.selector?.trim() || "";
  const value = action.value ?? "";
  const waitMs = clamp(action.waitMs, 0, 120000, 0);

  switch (action.actionType) {
    case "goto":
      await page.goto(validateUrl(value), { waitUntil: "domcontentloaded", timeout: 60000 });
      break;
    case "click": {
      const sourcePage = page;
      const sourceUrl = decodeClickMetadata(value).sourceUrl || page.url();
      const beforePages = new Set(await session.browser.pages());
      let clicked = false;
      if (selector) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: 8000 });
          await page.click(selector, { delay: 55 });
          clicked = true;
        } catch {
          clicked = false;
        }
      }
      if (!clicked && action.x != null && action.y != null) {
        await page.mouse.move(Number(action.x), Number(action.y), { steps: 8 });
        await page.mouse.click(Number(action.x), Number(action.y), { delay: 70 });
        clicked = true;
      }
      if (!clicked) throw new Error("Nie znaleziono elementu do kliknięcia ani współrzędnych zastępczych.");
      await settle(page, Math.max(waitMs, 500));
      await refreshTabs(session);
      if (isExpectedAdClick(action)) {
        await recoverFromExpectedAd(session, sourcePage, sourceUrl, beforePages);
      } else {
        const pages = (await session.browser.pages()).filter((item) => !item.isClosed());
        const created = pages.filter((item) => !beforePages.has(item) && !isObviousAdUrl(item.url()));
        if (created.length) session.page = created.at(-1)!;
      }
      break;
    }
    case "type":
      if (!selector) throw new Error("Brak selektora pola tekstowego.");
      await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(selector, value, { delay: 30 });
      break;
    case "select":
      if (!selector) throw new Error("Brak selektora listy wyboru.");
      await page.waitForSelector(selector, { timeout: 8000 });
      await page.select(selector, value);
      break;
    case "press":
      if (selector) {
        await page.waitForSelector(selector, { visible: true, timeout: 8000 });
        await page.focus(selector);
      }
      await page.keyboard.press(normalizeKey(value || "Enter"));
      break;
    case "wait":
      await delay(waitMs || clamp(Number(value), 0, 120000, 1000));
      break;
    case "waitFor":
      if (!selector) throw new Error("Brak selektora oczekiwanego elementu.");
      await page.waitForSelector(selector, { visible: value !== "hidden", timeout: waitMs || 12000 });
      break;
    case "scroll":
      await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: Number(action.x ?? 0), y: Number(action.y ?? 800) });
      break;
    case "hover":
      if (!selector) throw new Error("Brak selektora elementu hover.");
      await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      await page.hover(selector);
      break;
    case "script":
      if (!value.trim()) throw new Error("Kod JavaScript jest pusty.");
      await page.evaluate((source) => (0, eval)(source), value);
      break;
    case "extract": {
      if (!selector) throw new Error("Brak selektora elementów do pobrania.");
      const attribute = value.trim() || "href";
      const values = await page.$$eval(selector, (elements, attr) => elements.map((element) => {
        if (attr === "text" || attr === "textContent") return element.textContent ?? "";
        return element.getAttribute(attr) ?? (element as HTMLAnchorElement).href ?? "";
      }), attribute);
      for (const candidate of values) collectUrl(session.videoUrls, candidate, page.url(), true);
      break;
    }
    default:
      throw new Error(`Nieobsługiwany typ kroku: ${String(action.actionType)}`);
  }

  if (waitMs > 0 && !["wait", "waitFor", "click"].includes(action.actionType)) await settle(await ensurePage(session), waitMs);
  const active = await ensurePage(session);
  collectFromHtml(session.videoUrls, await active.content(), active.url());
}

async function recoverFromExpectedAd(session: LiveTestSession, sourcePage: Page, sourceUrl: string, beforePages: Set<Page>) {
  await delay(700);
  const pages = (await session.browser.pages()).filter((page) => !page.isClosed());
  const preferred = !sourcePage.isClosed() ? sourcePage : undefined;
  const target = chooseMostSimilarPage(pages.filter((page) => !isObviousAdUrl(page.url())), sourceUrl, preferred) || preferred;

  for (const page of pages) {
    if (page === target) continue;
    if (!beforePages.has(page) || isObviousAdUrl(page.url())) await page.close().catch(() => undefined);
  }

  if (target && !target.isClosed()) {
    session.page = target;
    if (target.url() !== sourceUrl && target === sourcePage) {
      await target.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      if (urlScore(target.url(), sourceUrl) < 1000) await target.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
    }
    await target.bringToFront().catch(() => undefined);
    addEvent(session, "info", "Krok mógł otworzyć reklamę — zamknięto obce karty i wrócono do najbardziej podobnej strony.");
  }
  await refreshTabs(session);
}

async function challengeState(page: Page): Promise<CaptchaState | null> {
  const result = await detectActiveChallenge(page);
  if (!result.detected) return null;
  return {
    detected: true,
    kind: result.kind,
    message: `Wykryto aktywną weryfikację (${result.kind}). Test został zatrzymany. Rozwiąż ją ręcznie i wznów proces.`,
    detectedAt: new Date().toISOString()
  };
}

function pauseForChallenge(session: LiveTestSession, state: CaptchaState) {
  session.status = "paused_captcha";
  session.captcha = state;
  addEvent(session, "captcha", state.message);
}

function finishSession(session: LiveTestSession) {
  session.finishedAt = new Date().toISOString();
  if (session.successfulSteps === 0) {
    session.status = "failed";
    addEvent(session, "error", "Żaden krok procesu nie został wykonany poprawnie.");
  } else if (session.failedSteps > 0 || session.skippedSteps > 0) {
    session.status = "completed_with_errors";
    addEvent(session, "info", `Test zakończony: ${session.successfulSteps} poprawnych, ${session.failedSteps} błędnych, ${session.skippedSteps} pominiętych.`);
  } else {
    session.status = "completed";
    addEvent(session, "success", `Test zakończony poprawnie. Wykonano ${session.successfulSteps} kroków.`);
  }
  saveCollectedResults(session.programId, [...session.videoUrls]);
}

async function attachCreatedPage(session: LiveTestSession, target: import("puppeteer").Target) {
  if (target.type() !== "page") return;
  const page = await target.page().catch(() => null);
  if (!page) return;
  await configurePage(page, session.userAgent, session.width, session.height, session.headers).catch(() => undefined);
  attachPage(session, page);
}

function attachPage(session: LiveTestSession, page: Page) {
  registerTab(session, page);
  if (session.attachedPages.has(page)) return;
  session.attachedPages.add(page);
  page.on("request", (request) => collectUrl(session.videoUrls, request.url(), session.startUrl));
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] || "";
    collectUrl(session.videoUrls, response.url(), session.startUrl, contentType.startsWith("video/") || /mpegurl|dash\+xml/.test(contentType));
  });
  page.on("close", () => {
    for (const [id, value] of session.tabs) if (value === page) session.tabs.delete(id);
  });
}

async function configurePage(page: Page, userAgent: string, width: number, height: number, headers: Record<string, string>) {
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(12000);
  await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600, deviceScaleFactor: 1 });
  await page.setUserAgent(userAgent);
  if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);
}

async function refreshTabs(session: LiveTestSession) {
  for (const page of await session.browser.pages()) if (!page.isClosed()) attachPage(session, page);
}

async function ensurePage(session: LiveTestSession) {
  await refreshTabs(session);
  if (!session.page.isClosed()) return session.page;
  const pages = [...session.tabs.values()].filter((page) => !page.isClosed());
  const next = chooseMostSimilarPage(pages, session.startUrl) || pages[0];
  if (!next) throw new Error("Brak aktywnej karty Chromium.");
  session.page = next;
  return next;
}

function publicState(session: LiveTestSession) {
  touch(session);
  const tabs = [...session.tabs.entries()].filter(([, page]) => !page.isClosed()).map(([id, page], index) => ({
    id,
    url: page.url(),
    label: tabLabel(page.url(), index),
    active: page === session.page
  }));
  return {
    id: session.id,
    programId: session.programId,
    programName: session.programName,
    startUrl: session.startUrl,
    url: session.page.isClosed() ? "" : session.page.url(),
    browserVersion: session.browserVersion,
    persistentProfile: true,
    viewportWidth: session.width,
    viewportHeight: session.height,
    status: session.status,
    currentStepIndex: session.currentStepIndex,
    totalSteps: session.steps.length,
    successfulSteps: session.successfulSteps,
    failedSteps: session.failedSteps,
    skippedSteps: session.skippedSteps,
    tabs,
    steps: session.steps,
    events: session.events,
    captcha: session.captcha,
    videoUrls: [...session.videoUrls],
    createdAt: session.createdAt,
    touchedAt: session.touchedAt,
    finishedAt: session.finishedAt
  };
}

function registerTab(session: LiveTestSession, page: Page) {
  for (const [id, current] of session.tabs) if (current === page) return id;
  const id = crypto.randomUUID();
  session.tabs.set(id, page);
  return id;
}

function collectFromHtml(target: Set<string>, html: string, baseUrl: string) {
  const pattern = /(?:src|href|data-src|data-url|file|url)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) collectUrl(target, match[1] || "", baseUrl);
}

function collectUrl(target: Set<string>, candidate: string, baseUrl: string, force = false) {
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return;
  try {
    const url = new URL(candidate, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (force || VIDEO_PATTERN.test(url.href)) target.add(url.href);
  } catch {
    // Ignore invalid URLs.
  }
}

function saveCollectedResults(programId: string, urls: string[]) {
  if (!urls.length) return;
  const db = getDatabase();
  const exists = db.prepare("SELECT 1 FROM scraping_results WHERE config_id = ? AND video_url = ? LIMIT 1");
  const insert = db.prepare("INSERT INTO scraping_results (id, config_id, video_url, created_at) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const url of urls) if (!exists.get(programId, url)) insert.run(crypto.randomUUID(), programId, url, new Date().toISOString());
  })();
}

function addEvent(session: LiveTestSession, type: LiveTestEvent["type"], text: string) {
  session.events.push({ id: crypto.randomUUID(), type, message: text, createdAt: new Date().toISOString() });
  if (session.events.length > 150) session.events.shift();
}

function requireSession(id: string) {
  const session = sessions.get(id);
  if (!session) throw new Error("Sesja testowa wygasła albo nie istnieje.");
  return session;
}

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60000;
    for (const [id, session] of sessions) if (Date.parse(session.touchedAt) < cutoff) void closeLiveTest(id);
  }, 60000);
  cleanupTimer.unref();
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

function urlScore(candidate: string, reference: string) {
  try {
    const left = new URL(candidate);
    const right = new URL(reference);
    if (left.href === right.href) return 10000;
    if (left.origin === right.origin) return 4000;
    if (left.hostname === right.hostname) return 3000;
    return 0;
  } catch {
    return 0;
  }
}

function normalizeKey(value: string): KeyInput {
  const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"] as KeyInput[];
  return allowed.includes(value as KeyInput) ? value as KeyInput : "Enter";
}
function validateUrl(value: string) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dozwolone są tylko adresy HTTP i HTTPS."); return url.toString(); }
function clamp(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback; }
function touch(session: LiveTestSession) { session.touchedAt = new Date().toISOString(); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function settle(page: Page, ms: number) { await delay(ms); await page.waitForNetworkIdle({ idleTime: 300, timeout: 2500 }).catch(() => undefined); }
