import type { Browser, KeyInput, Page } from "puppeteer";
import { getDatabase } from "../db/database.js";
import { writeSystemLog } from "../system/system-log.js";
import { getChromiumLaunchArgs, getCurrentChromiumIdentity, getPersistentChromiumProfileDir } from "./chromium-profile.js";
import type { ScrapingProgramAction } from "./scraping-engine.js";

const VIDEO_PATTERN = /\.(?:mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)(?:$|[?#])/i;
const CAPTCHA_SELECTORS = [
  "iframe[src*='recaptcha' i]",
  "iframe[title*='recaptcha' i]",
  "iframe[src*='hcaptcha' i]",
  "iframe[src*='turnstile' i]",
  "iframe[src*='challenges.cloudflare.com' i]",
  ".g-recaptcha",
  ".h-captcha",
  "[data-sitekey]",
  "[class*='captcha' i]",
  "[id*='captcha' i]"
];

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

export type CaptchaState = {
  detected: boolean;
  kind: string;
  message: string;
  detectedAt: string;
};

export type LiveTestEvent = {
  id: string;
  type: "info" | "step" | "captcha" | "error" | "success";
  message: string;
  createdAt: string;
};

type LiveTestSession = {
  id: string;
  programId: string;
  programName: string;
  startUrl: string;
  browser: Browser;
  page: Page;
  browserVersion: string;
  width: number;
  height: number;
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
  const actionRows = db.prepare(
    "SELECT id, action_type, selector, x, y, value, wait_ms, sort_order FROM scraping_actions WHERE config_id = ? ORDER BY sort_order ASC, created_at ASC"
  ).all(programId) as ActionRow[];
  const actions = actionRows.map((row) => ({
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
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(12_000);
  await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600, deviceScaleFactor: 1 });
  await page.setUserAgent(program.user_agent?.trim() || identity.userAgent);
  const headers = parseHeaders(program.headers_json);
  if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);

  const now = new Date().toISOString();
  const session: LiveTestSession = {
    id: crypto.randomUUID(),
    programId,
    programName: program.name,
    startUrl,
    browser,
    page,
    browserVersion: identity.version,
    width,
    height,
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
  attachNetworkCollection(session);
  addEvent(session, "info", `Uruchamianie testu procesu „${program.name}” w Chromium ${identity.version} z trwałym profilem cookies.`);

  try {
    await page.goto(session.startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
    addEvent(session, "error", `Nie udało się otworzyć strony startowej: ${errorMessage(error)}`);
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
  return Buffer.from(await session.page.screenshot({ type: "jpeg", quality: 70, fullPage: false, captureBeyondViewport: false }));
}

export async function clickLiveTest(id: string, xInput: number, yInput: number) {
  const session = requireSession(id);
  touch(session);
  const x = clamp(xInput, 0, session.width - 1, 0);
  const y = clamp(yInput, 0, session.height - 1, 0);
  await session.page.mouse.move(x, y, { steps: 8 });
  await delay(40);
  await session.page.mouse.click(x, y, { delay: 70 });
  await settle(session.page, 180);
  return publicState(session);
}

export async function typeLiveTest(id: string, text: string, replace = true) {
  const session = requireSession(id);
  touch(session);
  if (replace) {
    await session.page.keyboard.down("Control");
    await session.page.keyboard.press("A");
    await session.page.keyboard.up("Control");
    await session.page.keyboard.press("Backspace");
  }
  await session.page.keyboard.type(text, { delay: 35 });
  return publicState(session);
}

export async function keyLiveTest(id: string, keyInput: string) {
  const session = requireSession(id);
  touch(session);
  await session.page.keyboard.press(normalizeKey(keyInput));
  await settle(session.page, 150);
  return publicState(session);
}

export async function scrollLiveTest(id: string, deltaYInput: number) {
  const session = requireSession(id);
  touch(session);
  await session.page.mouse.wheel({ deltaY: clamp(deltaYInput, -4000, 4000, 0) });
  return publicState(session);
}

export async function commandLiveTest(id: string, command: "back" | "forward" | "reload") {
  const session = requireSession(id);
  touch(session);
  if (command === "back") await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "forward") await session.page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "reload") await session.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  await settle(session.page, 300);
  return publicState(session);
}

export async function resumeLiveTest(id: string, force = false) {
  const session = requireSession(id);
  touch(session);
  if (session.status !== "paused_captcha") return publicState(session);
  const captcha = await detectCaptcha(session.page);
  if (captcha.detected && !force) {
    session.captcha = captcha;
    throw new Error("CAPTCHA nadal jest widoczna. Rozwiąż ją w oknie Chromium albo użyj wymuszonego wznowienia.");
  }
  session.captcha = null;
  session.status = "running";
  addEvent(session, "info", "Wznowiono test po ręcznej obsłudze CAPTCHA.");
  void runRemainingSteps(id);
  return publicState(session);
}

export async function skipCurrentLiveTestStep(id: string) {
  const session = requireSession(id);
  touch(session);
  if (session.currentStepIndex < session.steps.length) {
    const step = session.steps[session.currentStepIndex];
    if (step && (step.status === "pending" || step.status === "running")) {
      step.status = "skipped";
      step.message = "Pominięto ręcznie przez użytkownika.";
      step.finishedAt = new Date().toISOString();
      session.skippedSteps += 1;
      session.currentStepIndex += 1;
      addEvent(session, "info", `Pominięto krok ${step.index + 1}: ${step.actionType}.`);
    }
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
      const captchaBefore = await detectCaptcha(session.page);
      if (captchaBefore.detected) {
        pauseForCaptcha(session, captchaBefore);
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
        await executeAction(session.page, action, session.videoUrls);
        step.status = "ok";
        step.finishedAt = new Date().toISOString();
        session.successfulSteps += 1;
        addEvent(session, "success", `Krok ${index + 1} wykonany poprawnie.`);
      } catch (error) {
        const message = errorMessage(error);
        step.status = "failed";
        step.message = message;
        step.finishedAt = new Date().toISOString();
        session.failedSteps += 1;
        addEvent(session, "error", `Krok ${index + 1} nie powiódł się i został pominięty: ${message}`);
        writeSystemLog("warn", "scraping-test", "Live scraper test step failed and was skipped.", {
          programId: session.programId,
          step: index + 1,
          actionType: action.actionType,
          selector: action.selector,
          error: message
        });
      }

      session.currentStepIndex += 1;
      const captchaAfter = await detectCaptcha(session.page);
      if (captchaAfter.detected) {
        pauseForCaptcha(session, captchaAfter);
        return;
      }
    }

    if (session.stopRequested || session.status !== "running") return;
    finishSession(session);
  } finally {
    session.runnerActive = false;
  }
}

function finishSession(session: LiveTestSession) {
  session.finishedAt = new Date().toISOString();
  if (session.successfulSteps === 0) {
    session.status = "failed";
    addEvent(session, "error", "Żaden krok procesu nie został wykonany poprawnie. Sprawdź selektory, stronę startową i ewentualne zabezpieczenia strony.");
  } else if (session.failedSteps > 0 || session.skippedSteps > 0) {
    session.status = "completed_with_errors";
    addEvent(session, "info", `Test zakończony: ${session.successfulSteps} poprawnych, ${session.failedSteps} błędnych, ${session.skippedSteps} pominiętych kroków.`);
  } else {
    session.status = "completed";
    addEvent(session, "success", `Test zakończony poprawnie. Wykonano ${session.successfulSteps} kroków.`);
  }
  saveCollectedResults(session.programId, [...session.videoUrls]);
}

function pauseForCaptcha(session: LiveTestSession, captcha: CaptchaState) {
  session.status = "paused_captcha";
  session.captcha = captcha;
  addEvent(session, "captcha", captcha.message);
  writeSystemLog("warn", "scraping-test", "CAPTCHA detected during live scraper test.", {
    programId: session.programId,
    step: session.currentStepIndex + 1,
    kind: captcha.kind,
    url: session.page.url()
  });
}

async function executeAction(page: Page, action: ScrapingProgramAction, collectedUrls: Set<string>) {
  const selector = action.selector?.trim() || "";
  const value = action.value ?? "";
  const waitMs = clamp(action.waitMs, 0, 120_000, 0);
  switch (action.actionType) {
    case "goto":
      await page.goto(validateUrl(value), { waitUntil: "domcontentloaded", timeout: 60_000 });
      break;
    case "click": {
      let clicked = false;
      if (selector) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: 8_000 });
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
      break;
    }
    case "type":
      if (!selector) throw new Error("Brak selektora pola tekstowego.");
      await page.waitForSelector(selector, { visible: true, timeout: 8_000 });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(selector, value, { delay: 30 });
      break;
    case "select":
      if (!selector) throw new Error("Brak selektora listy wyboru.");
      await page.waitForSelector(selector, { timeout: 8_000 });
      await page.select(selector, value);
      break;
    case "press":
      if (selector) {
        await page.waitForSelector(selector, { visible: true, timeout: 8_000 });
        await page.focus(selector);
      }
      await page.keyboard.press(normalizeKey(value || "Enter"));
      break;
    case "wait":
      await delay(waitMs || clamp(Number(value), 0, 120_000, 1000));
      break;
    case "waitFor":
      if (!selector) throw new Error("Brak selektora oczekiwanego elementu.");
      await page.waitForSelector(selector, { visible: value !== "hidden", timeout: waitMs || 12_000 });
      break;
    case "scroll":
      await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: Number(action.x ?? 0), y: Number(action.y ?? 800) });
      break;
    case "hover":
      if (!selector) throw new Error("Brak selektora elementu hover.");
      await page.waitForSelector(selector, { visible: true, timeout: 8_000 });
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
      for (const candidate of values) collectUrl(collectedUrls, candidate, page.url(), true);
      break;
    }
    default:
      throw new Error(`Nieobsługiwany typ kroku: ${String(action.actionType)}`);
  }
  if (waitMs > 0 && action.actionType !== "wait" && action.actionType !== "waitFor") await settle(page, waitMs);
  collectFromHtml(collectedUrls, await page.content(), page.url());
}

async function detectCaptcha(page: Page): Promise<CaptchaState> {
  try {
    const detection = await page.evaluate((selectors) => {
      const visible = (element: Element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 20 && rect.height > 20;
      };
      const matched = selectors.find((selector) => {
        try { return [...document.querySelectorAll(selector)].some(visible); }
        catch { return false; }
      });
      const text = (document.body?.innerText || "").toLowerCase().slice(0, 100_000);
      const phrases = [
        "i'm not a robot", "i am not a robot", "nie jestem robotem", "verify you are human",
        "potwierdź, że jesteś człowiekiem", "security check", "human verification",
        "complete the captcha", "rozwiąż captcha", "challenge-platform"
      ];
      const phrase = phrases.find((item) => text.includes(item));
      return { matched: matched || null, phrase: phrase || null };
    }, CAPTCHA_SELECTORS);
    if (detection.matched || detection.phrase) {
      const kind = detection.matched?.includes("hcaptcha") ? "hCaptcha"
        : detection.matched?.includes("turnstile") || detection.matched?.includes("cloudflare") ? "Cloudflare Turnstile"
        : detection.matched?.includes("recaptcha") ? "reCAPTCHA"
        : "CAPTCHA / weryfikacja człowieka";
      return {
        detected: true,
        kind,
        message: `Wykryto ${kind}. Test został zatrzymany. Rozwiąż zagadkę ręcznie w podglądzie Chromium, a następnie kliknij „CAPTCHA rozwiązana — wznów”.`,
        detectedAt: new Date().toISOString()
      };
    }
  } catch {
    // Detection is best-effort. Page navigation can invalidate the evaluation context.
  }
  return { detected: false, kind: "", message: "", detectedAt: new Date().toISOString() };
}

function attachNetworkCollection(session: LiveTestSession) {
  session.page.on("request", (request) => collectUrl(session.videoUrls, request.url(), session.startUrl));
  session.page.on("response", (response) => {
    const contentType = response.headers()["content-type"] || "";
    collectUrl(session.videoUrls, response.url(), session.startUrl, contentType.startsWith("video/") || /mpegurl|dash\+xml/.test(contentType));
  });
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
    for (const url of urls) {
      if (!exists.get(programId, url)) insert.run(crypto.randomUUID(), programId, url, new Date().toISOString());
    }
  })();
}

function publicState(session: LiveTestSession) {
  touch(session);
  return {
    id: session.id,
    programId: session.programId,
    programName: session.programName,
    startUrl: session.startUrl,
    url: session.page.url(),
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
    steps: session.steps,
    events: session.events,
    captcha: session.captcha,
    videoUrls: [...session.videoUrls],
    createdAt: session.createdAt,
    touchedAt: session.touchedAt,
    finishedAt: session.finishedAt
  };
}

function requireSession(id: string) {
  const session = sessions.get(id);
  if (!session) throw new Error("Sesja testowa wygasła albo nie istnieje.");
  return session;
}

function addEvent(session: LiveTestSession, type: LiveTestEvent["type"], message: string) {
  session.events.push({ id: crypto.randomUUID(), type, message, createdAt: new Date().toISOString() });
  if (session.events.length > 150) session.events.shift();
}

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, session] of sessions) if (Date.parse(session.touchedAt) < cutoff) void closeLiveTest(id);
  }, 60_000);
  cleanupTimer.unref();
}

function parseHeaders(value?: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === "string")) as Record<string, string>;
  } catch { return {}; }
}

function normalizeKey(value: string): KeyInput {
  const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"] as KeyInput[];
  return allowed.includes(value as KeyInput) ? value as KeyInput : "Enter";
}
function validateUrl(value: string) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dozwolone są tylko adresy HTTP i HTTPS."); return url.toString(); }
function clamp(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback; }
function touch(session: LiveTestSession) { session.touchedAt = new Date().toISOString(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function settle(page: Page, ms: number) { await delay(ms); await page.waitForNetworkIdle({ idleTime: 300, timeout: 2500 }).catch(() => undefined); }
