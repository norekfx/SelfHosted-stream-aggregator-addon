import type { Browser, KeyInput, Page, Target } from "puppeteer";
import type { ScrapingProgramAction } from "./scraping-engine.js";

export type RecordedLiveStep = ScrapingProgramAction & {
  id: string;
  label: string;
  createdAt: string;
};

export type LiveBrowserEvent = {
  id: string;
  type: "info" | "navigation" | "popup" | "ad" | "error";
  message: string;
  url?: string;
  createdAt: string;
};

type ElementInfo = {
  selector: string | null;
  tagName: string;
  editable: boolean;
  label: string;
};

type Session = {
  id: string;
  name: string;
  startUrl: string;
  browser: Browser;
  page: Page;
  recording: boolean;
  autoAds: boolean;
  mobile: boolean;
  width: number;
  height: number;
  steps: RecordedLiveStep[];
  events: LiveBrowserEvent[];
  safeUrls: string[];
  adHosts: Set<string>;
  createdAt: string;
  touchedAt: string;
  closing: boolean;
};

const sessions = new Map<string, Session>();
let cleanupTimer: NodeJS.Timeout | undefined;

export async function createLiveBrowser(input: {
  name: string;
  url: string;
  mobile?: boolean;
  recording?: boolean;
  autoAds?: boolean;
}): Promise<ReturnType<typeof publicState>> {
  ensureCleanup();
  const url = validateUrl(input.url);
  const mobile = Boolean(input.mobile);
  const width = mobile ? 390 : 1280;
  const height = mobile ? 844 : 720;
  const puppeteer = await import("puppeteer");
  const executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-extensions", "--no-first-run"]
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(20_000);
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await page.setUserAgent(mobile
    ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");

  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(), name: input.name.trim(), startUrl: url, browser, page,
    recording: input.recording !== false, autoAds: input.autoAds !== false, mobile, width, height,
    steps: [], events: [], safeUrls: [], adHosts: new Set(), createdAt: now, touchedAt: now, closing: false
  };
  sessions.set(session.id, session);
  attachListeners(session);
  addEvent(session, "info", "Uruchomiono zdalne Chromium.", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page, 700);
  rememberSafe(session);
  return publicState(session);
}

export function getLiveBrowserState(id: string) {
  const session = requireSession(id);
  touch(session);
  return publicState(session);
}

export async function getLiveBrowserScreenshot(id: string): Promise<Buffer> {
  const session = requireSession(id);
  touch(session);
  const image = await session.page.screenshot({ type: "jpeg", quality: 68, fullPage: false, captureBeyondViewport: false });
  return Buffer.from(image);
}

export async function clickLiveBrowser(id: string, xInput: number, yInput: number) {
  const session = requireSession(id);
  touch(session);
  const x = clamp(xInput, 0, session.width - 1);
  const y = clamp(yInput, 0, session.height - 1);
  const element = await elementAt(session.page, x, y).catch(() => null);
  await session.page.mouse.move(x, y, { steps: 8 });
  await delay(45);
  await session.page.mouse.click(x, y, { delay: 75 });
  if (session.recording) addStep(session, {
    actionType: "click", selector: element?.selector ?? null, x, y, waitMs: 450,
    label: element ? `Kliknij ${element.label}` : `Kliknij (${x}, ${y})`
  });
  await settle(session.page, 220);
  await handleAdRedirect(session);
  return { element, state: publicState(session) };
}

export async function typeLiveBrowser(id: string, text: string, replace = true) {
  const session = requireSession(id);
  touch(session);
  const active = await activeElement(session.page);
  if (!active?.editable) throw new Error("Najpierw kliknij pole tekstowe w Chromium.");
  if (replace) {
    await session.page.keyboard.down("Control");
    await session.page.keyboard.press("A");
    await session.page.keyboard.up("Control");
    await session.page.keyboard.press("Backspace");
  }
  await session.page.keyboard.type(text, { delay: 35 });
  if (session.recording) addStep(session, {
    actionType: "type", selector: active.selector, value: text, waitMs: 250,
    label: `Wpisz tekst w ${active.label}`
  });
  return publicState(session);
}

export async function keyLiveBrowser(id: string, keyInput: string) {
  const session = requireSession(id);
  touch(session);
  const key = normalizeKey(keyInput);
  const active = await activeElement(session.page).catch(() => null);
  await session.page.keyboard.press(key);
  if (session.recording) addStep(session, {
    actionType: "press", selector: active?.selector ?? null, value: key, waitMs: 400, label: `Klawisz ${key}`
  });
  await settle(session.page, 180);
  await handleAdRedirect(session);
  return publicState(session);
}

export async function scrollLiveBrowser(id: string, deltaYInput: number) {
  const session = requireSession(id);
  touch(session);
  const deltaY = clamp(deltaYInput, -4000, 4000);
  await session.page.mouse.wheel({ deltaY });
  if (session.recording && Math.abs(deltaY) > 25) {
    const previous = session.steps.at(-1);
    if (previous?.actionType === "scroll" && Date.now() - Date.parse(previous.createdAt) < 1200) {
      previous.y = Number(previous.y ?? 0) + deltaY;
      previous.createdAt = new Date().toISOString();
    } else addStep(session, { actionType: "scroll", x: 0, y: deltaY, waitMs: 200, label: deltaY > 0 ? "Przewiń w dół" : "Przewiń w górę" });
  }
  return publicState(session);
}

export async function navigateLiveBrowser(id: string, value: string) {
  const session = requireSession(id);
  touch(session);
  const url = validateUrl(value);
  await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(session.page, 500);
  if (session.recording) addStep(session, { actionType: "goto", value: url, waitMs: 600, label: `Przejdź do ${url}` });
  rememberSafe(session);
  return publicState(session);
}

export async function commandLiveBrowser(id: string, command: "back" | "forward" | "reload") {
  const session = requireSession(id);
  touch(session);
  if (command === "back") await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "forward") await session.page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "reload") await session.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  await settle(session.page, 350);
  await handleAdRedirect(session);
  return publicState(session);
}

export function setLiveBrowserRecording(id: string, enabled: boolean) {
  const session = requireSession(id);
  session.recording = enabled;
  touch(session);
  addEvent(session, "info", enabled ? "Włączono nagrywanie." : "Wstrzymano nagrywanie.");
  return publicState(session);
}

export function setLiveBrowserAds(id: string, enabled: boolean) {
  const session = requireSession(id);
  session.autoAds = enabled;
  touch(session);
  addEvent(session, "ad", enabled ? "Włączono ochronę przed reklamami." : "Wyłączono ochronę przed reklamami.");
  return publicState(session);
}

export async function markLiveBrowserAd(id: string) {
  const session = requireSession(id);
  const host = safeHost(session.page.url());
  if (host) session.adHosts.add(host);
  addEvent(session, "ad", `Oznaczono jako reklamę: ${host || session.page.url()}.`, session.page.url());
  await returnSafe(session);
  return publicState(session);
}

export async function markLiveSearchField(id: string) {
  const session = requireSession(id);
  const active = await activeElement(session.page);
  if (!active?.editable || !active.selector) throw new Error("Kliknij najpierw pole wyszukiwania.");
  await session.page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element) { element.style.outline = "3px solid #7c5cff"; element.style.outlineOffset = "2px"; }
  }, active.selector);
  addEvent(session, "info", `Pole wyszukiwania: ${active.selector}`);
  return publicState(session);
}

export function undoLiveBrowserStep(id: string) {
  const session = requireSession(id);
  const step = session.steps.pop();
  addEvent(session, "info", step ? `Usunięto krok: ${step.label}.` : "Brak kroków do usunięcia.");
  return publicState(session);
}

export function clearLiveBrowserSteps(id: string) {
  const session = requireSession(id);
  session.steps = [];
  addEvent(session, "info", "Wyczyszczono kroki.");
  return publicState(session);
}

export async function closeLiveBrowser(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.closing) return;
  session.closing = true;
  sessions.delete(id);
  await session.browser.close().catch(() => undefined);
}

export async function closeAllLiveBrowsers(): Promise<void> {
  await Promise.all([...sessions.keys()].map(closeLiveBrowser));
}

function attachListeners(session: Session) {
  session.page.on("framenavigated", (frame) => {
    if (frame !== session.page.mainFrame() || !frame.url().startsWith("http")) return;
    addEvent(session, "navigation", `Nawigacja: ${short(frame.url())}`, frame.url());
    void handleAdRedirect(session);
  });
  session.page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  session.page.on("pageerror", (error) => addEvent(session, "error", `Błąd strony: ${short(error.message)}`));
  session.browser.on("targetcreated", (target) => void handlePopup(session, target));
  session.browser.on("disconnected", () => sessions.delete(session.id));
}

async function handlePopup(session: Session, target: Target) {
  if (session.closing || target.type() !== "page" || target === session.page.target()) return;
  const popup = await target.page().catch(() => null);
  if (!popup) return;
  await delay(300);
  const popupHost = safeHost(popup.url());
  const mainHost = safeHost(session.page.url());
  const likelyAd = target.opener() === session.page.target() && popupHost !== mainHost;
  if (session.autoAds && likelyAd) {
    if (popupHost) session.adHosts.add(popupHost);
    addEvent(session, "ad", `Zamknięto kartę reklamową: ${popupHost}.`, popup.url());
    await popup.close().catch(() => undefined);
    await session.page.bringToFront().catch(() => undefined);
  } else addEvent(session, "popup", `Otworzono nową kartę: ${popupHost || popup.url()}.`, popup.url());
}

async function handleAdRedirect(session: Session) {
  const host = safeHost(session.page.url());
  if (!session.autoAds || !host || !session.adHosts.has(host)) { rememberSafe(session); return; }
  addEvent(session, "ad", `Powrót z domeny reklamowej: ${host}.`, session.page.url());
  await returnSafe(session);
}

async function returnSafe(session: Session) {
  const fallback = [...session.safeUrls].reverse().find((url) => !session.adHosts.has(safeHost(url))) || session.startUrl;
  await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
  if (session.adHosts.has(safeHost(session.page.url()))) await session.page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await session.page.bringToFront().catch(() => undefined);
  rememberSafe(session);
}

function rememberSafe(session: Session) {
  const url = session.page.url();
  const host = safeHost(url);
  if (!host || session.adHosts.has(host) || session.safeUrls.at(-1) === url) return;
  session.safeUrls.push(url);
  if (session.safeUrls.length > 25) session.safeUrls.shift();
}

function publicState(session: Session) {
  touch(session);
  return {
    id: session.id, name: session.name, startUrl: session.startUrl, url: session.page.url(),
    recording: session.recording, autoAds: session.autoAds, mobile: session.mobile,
    viewportWidth: session.width, viewportHeight: session.height,
    steps: session.steps, events: session.events, createdAt: session.createdAt, touchedAt: session.touchedAt
  };
}

function addStep(session: Session, input: Omit<RecordedLiveStep, "id" | "createdAt" | "sortOrder">) {
  session.steps.push({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), sortOrder: session.steps.length });
  if (session.steps.length > 300) session.steps.shift();
}

function addEvent(session: Session, type: LiveBrowserEvent["type"], message: string, url?: string) {
  session.events.push({ id: crypto.randomUUID(), type, message, ...(url ? { url } : {}), createdAt: new Date().toISOString() });
  if (session.events.length > 100) session.events.shift();
}

async function elementAt(page: Page, x: number, y: number): Promise<ElementInfo | null> {
  return page.evaluate(({ x, y }) => info(document.elementFromPoint(x, y)), { x, y });
}

async function activeElement(page: Page): Promise<ElementInfo | null> {
  return page.evaluate(() => info(document.activeElement));
}

function info(element: Element | null): ElementInfo | null {
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  const editable = element.matches("input,textarea,[contenteditable='true'],[role='textbox']");
  const label = element.getAttribute("placeholder") || element.getAttribute("aria-label") || element.innerText || element.tagName.toLowerCase();
  let selector: string | null = element.id ? `#${CSS.escape(element.id)}` : null;
  if (!selector && element.getAttribute("name")) selector = `${element.tagName.toLowerCase()}[name="${CSS.escape(element.getAttribute("name") || "")}"]`;
  if (!selector) {
    const parent = element.parentElement;
    const index = parent ? [...parent.children].filter((item) => item.tagName === element.tagName).indexOf(element) + 1 : 1;
    selector = `${element.tagName.toLowerCase()}:nth-of-type(${Math.max(1, index)})`;
  }
  return { selector, tagName: element.tagName.toLowerCase(), editable, label: String(label).trim().slice(0, 80) };
}

function requireSession(id: string) {
  const session = sessions.get(id);
  if (!session || session.closing) throw new Error("Sesja Chromium wygasła albo nie istnieje.");
  return session;
}

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, session] of sessions) if (Date.parse(session.touchedAt) < cutoff) void closeLiveBrowser(id);
  }, 60_000);
  cleanupTimer.unref();
}

function touch(session: Session) { session.touchedAt = new Date().toISOString(); }
function validateUrl(value: string) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Dozwolone są tylko adresy HTTP i HTTPS."); return url.toString(); }
function safeHost(value: string) { try { return new URL(value).host.toLowerCase(); } catch { return ""; } }
function clamp(value: number, min: number, max: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : min; }
function short(value: string) { return value.length > 110 ? `${value.slice(0, 109)}…` : value; }
function normalizeKey(value: string): KeyInput { const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"] as KeyInput[]; return allowed.includes(value as KeyInput) ? value as KeyInput : "Enter"; }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function settle(page: Page, ms: number) { await delay(ms); await page.waitForNetworkIdle({ idleTime: 300, timeout: 2200 }).catch(() => undefined); }
