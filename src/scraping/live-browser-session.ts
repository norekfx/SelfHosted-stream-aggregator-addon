import type { Browser, KeyInput, Page, Target } from "puppeteer";
import { getChromiumLaunchArgs, getCurrentChromiumIdentity, getPersistentChromiumProfileDir } from "./chromium-profile.js";
import type { ScrapingProgramAction } from "./scraping-engine.js";

export type RecordedLiveStep = ScrapingProgramAction & { id: string; label: string; createdAt: string };
export type LiveBrowserEvent = { id: string; type: "info" | "navigation" | "popup" | "ad" | "error"; message: string; url?: string; createdAt: string };
type ElementInfo = { selector: string | null; tagName: string; editable: boolean; sensitive: boolean; label: string };
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
  browserVersion: string;
  steps: RecordedLiveStep[];
  events: LiveBrowserEvent[];
  safeUrls: string[];
  adHosts: Set<string>;
  attachedPages: WeakSet<Page>;
  createdAt: string;
  touchedAt: string;
  closing: boolean;
};

const sessions = new Map<string, Session>();
let cleanupTimer: NodeJS.Timeout | undefined;

export async function createLiveBrowser(input: { name: string; url: string; mobile?: boolean; recording?: boolean; autoAds?: boolean }) {
  ensureCleanup();
  const url = validateUrl(input.url);
  const mobile = Boolean(input.mobile);
  const width = mobile ? 390 : 1280;
  const height = mobile ? 844 : 720;
  const puppeteer = await import("puppeteer");
  const executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const userDataDir = await getPersistentChromiumProfileDir(url);
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    ...(executablePath ? { executablePath } : {}),
    args: getChromiumLaunchArgs()
  });
  const identity = await getCurrentChromiumIdentity(browser, mobile);
  const page = await browser.newPage();
  await configurePage(page, identity.userAgent, mobile, width, height);

  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    startUrl: url,
    browser,
    page,
    recording: input.recording !== false,
    autoAds: input.autoAds !== false,
    mobile,
    width,
    height,
    browserVersion: identity.version,
    steps: [],
    events: [],
    safeUrls: [],
    adHosts: new Set(),
    attachedPages: new WeakSet<Page>(),
    createdAt: now,
    touchedAt: now,
    closing: false
  };
  sessions.set(session.id, session);
  attachBrowserListeners(session);
  attachPageListeners(session, page);
  addEvent(session, "info", `Uruchomiono Chromium ${identity.version} z trwałym profilem cookies i sesji.`, url);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page, 700);
    rememberSafe(session);
    return publicState(session);
  } catch (error) {
    await closeLiveBrowser(session.id);
    throw error;
  }
}

export function getLiveBrowserState(id: string) {
  const session = requireSession(id);
  touch(session);
  return publicState(session);
}

export async function getLiveBrowserScreenshot(id: string): Promise<Buffer> {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  return Buffer.from(await page.screenshot({ type: "jpeg", quality: 72, fullPage: false, captureBeyondViewport: false }));
}

export async function clickLiveBrowser(id: string, xInput: number, yInput: number) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const x = clamp(xInput, 0, session.width - 1);
  const y = clamp(yInput, 0, session.height - 1);
  const element = await elementAt(page, x, y).catch(() => null);
  await page.mouse.move(x, y, { steps: 8 });
  await delay(45);
  await page.mouse.click(x, y, { delay: 75 });
  if (session.recording) {
    addStep(session, {
      actionType: "click",
      selector: element?.selector ?? null,
      x,
      y,
      waitMs: 450,
      label: element ? `Kliknij ${element.label}` : `Kliknij (${x}, ${y})`
    });
  }
  await settle(page, 220);
  await selectBestPage(session);
  await handleAdRedirect(session);
  return { element, state: publicState(session) };
}

export async function typeLiveBrowser(id: string, text: string, replace = true) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const active = await activeElement(page);
  if (!active?.editable) throw new Error("Najpierw kliknij pole tekstowe w Chromium.");
  if (replace) {
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(text, { delay: 35 });
  if (session.recording && active.sensitive) {
    addEvent(session, "info", "Wpisano hasło. Jego treść nie została zapisana w krokach procesu; zalogowana sesja pozostaje w profilu Chromium.");
  } else if (session.recording) {
    addStep(session, { actionType: "type", selector: active.selector, value: text, waitMs: 250, label: `Wpisz tekst w ${active.label}` });
  }
  return publicState(session);
}

export async function keyLiveBrowser(id: string, keyInput: string) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const key = normalizeKey(keyInput);
  const active = await activeElement(page).catch(() => null);
  await page.keyboard.press(key);
  if (session.recording) addStep(session, { actionType: "press", selector: active?.selector ?? null, value: key, waitMs: 400, label: `Klawisz ${key}` });
  await settle(page, 180);
  await selectBestPage(session);
  await handleAdRedirect(session);
  return publicState(session);
}

export async function scrollLiveBrowser(id: string, deltaYInput: number) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const deltaY = clamp(deltaYInput, -4000, 4000);
  await page.mouse.wheel({ deltaY });
  if (session.recording && Math.abs(deltaY) > 25) {
    const previous = session.steps.at(-1);
    if (previous?.actionType === "scroll" && Date.now() - Date.parse(previous.createdAt) < 1200) {
      previous.y = Number(previous.y ?? 0) + deltaY;
      previous.createdAt = new Date().toISOString();
    } else {
      addStep(session, { actionType: "scroll", x: 0, y: deltaY, waitMs: 200, label: deltaY > 0 ? "Przewiń w dół" : "Przewiń w górę" });
    }
  }
  return publicState(session);
}

export async function navigateLiveBrowser(id: string, value: string) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const url = validateUrl(value);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page, 500);
  if (session.recording) addStep(session, { actionType: "goto", value: url, waitMs: 600, label: `Przejdź do ${url}` });
  rememberSafe(session);
  return publicState(session);
}

export async function commandLiveBrowser(id: string, command: "back" | "forward" | "reload") {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  if (command === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (command === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  await settle(page, 350);
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
  const page = await ensureActivePage(session);
  const host = safeHost(page.url());
  if (host) session.adHosts.add(host);
  addEvent(session, "ad", `Oznaczono jako reklamę: ${host || page.url()}.`, page.url());
  await returnSafe(session);
  return publicState(session);
}

export async function markLiveSearchField(id: string) {
  const session = requireSession(id);
  const page = await ensureActivePage(session);
  const active = await activeElement(page);
  if (!active?.editable || !active.selector) throw new Error("Kliknij najpierw pole wyszukiwania.");
  await page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element) {
      element.style.outline = "3px solid #7c5cff";
      element.style.outlineOffset = "2px";
    }
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

export async function closeLiveBrowser(id: string) {
  const session = sessions.get(id);
  if (!session || session.closing) return;
  session.closing = true;
  sessions.delete(id);
  await session.browser.close().catch(() => undefined);
}

export async function closeAllLiveBrowsers() {
  await Promise.all([...sessions.keys()].map(closeLiveBrowser));
}

function attachBrowserListeners(session: Session) {
  session.browser.on("targetcreated", (target) => void handlePopup(session, target));
  session.browser.on("disconnected", () => sessions.delete(session.id));
}

function attachPageListeners(session: Session, page: Page) {
  if (session.attachedPages.has(page)) return;
  session.attachedPages.add(page);
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || !frame.url().startsWith("http")) return;
    if (page === session.page) {
      addEvent(session, "navigation", `Nawigacja: ${short(frame.url())}`, frame.url());
      void handleAdRedirect(session);
    }
  });
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on("pageerror", (error) => addEvent(session, "error", `Błąd strony: ${short(error.message)}`));
  page.on("close", () => {
    if (page === session.page && !session.closing) void selectBestPage(session);
  });
}

async function handlePopup(session: Session, target: Target) {
  if (session.closing || target.type() !== "page" || target === session.page.target()) return;
  const popup = await target.page().catch(() => null);
  if (!popup) return;
  attachPageListeners(session, popup);
  await delay(600);
  if (popup.isClosed()) return;

  const popupUrl = popup.url();
  const popupHost = safeHost(popupUrl);
  const currentHost = safeHost(session.page.url());
  const markedAd = popupHost && session.adHosts.has(popupHost);
  const obviousAd = isObviousAdUrl(popupUrl);

  if (session.autoAds && (markedAd || obviousAd)) {
    if (popupHost) session.adHosts.add(popupHost);
    addEvent(session, "ad", `Zamknięto kartę reklamową: ${popupHost || popupUrl}.`, popupUrl);
    await popup.close().catch(() => undefined);
    await session.page.bringToFront().catch(() => undefined);
    return;
  }

  session.page = popup;
  await popup.bringToFront().catch(() => undefined);
  addEvent(
    session,
    "popup",
    currentHost === popupHost ? "Przełączono na nową kartę serwisu." : "Przełączono na nową kartę logowania lub serwisu.",
    popupUrl
  );
  rememberSafe(session);
}

async function selectBestPage(session: Session) {
  const pages = (await session.browser.pages()).filter((page) => !page.isClosed());
  if (!pages.length) throw new Error("Chromium nie ma aktywnej karty.");
  const candidates = pages.filter((page) => page.url() !== "about:blank");
  const preferred = [...candidates].reverse().find((page) => !isObviousAdUrl(page.url()) && !session.adHosts.has(safeHost(page.url())));
  const next = preferred || candidates.at(-1) || pages.at(-1);
  if (!next) throw new Error("Nie znaleziono aktywnej karty Chromium.");
  attachPageListeners(session, next);
  if (session.page !== next) {
    session.page = next;
    addEvent(session, "popup", "Automatycznie przełączono na aktywną kartę.", next.url());
  }
  await next.bringToFront().catch(() => undefined);
  return next;
}

async function ensureActivePage(session: Session) {
  if (session.page.isClosed()) return selectBestPage(session);
  await selectBestPage(session).catch(() => session.page);
  return session.page;
}

async function handleAdRedirect(session: Session) {
  const page = await ensureActivePage(session);
  const host = safeHost(page.url());
  if (!session.autoAds || !host || !session.adHosts.has(host)) {
    rememberSafe(session);
    return;
  }
  addEvent(session, "ad", `Powrót z domeny reklamowej: ${host}.`, page.url());
  await returnSafe(session);
}

async function returnSafe(session: Session) {
  const page = await ensureActivePage(session);
  const fallback = [...session.safeUrls].reverse().find((url) => !session.adHosts.has(safeHost(url))) || session.startUrl;
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
  if (session.adHosts.has(safeHost(page.url()))) {
    await page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await page.bringToFront().catch(() => undefined);
  rememberSafe(session);
}

function rememberSafe(session: Session) {
  const url = session.page.url();
  const host = safeHost(url);
  if (!host || session.adHosts.has(host) || isObviousAdUrl(url) || session.safeUrls.at(-1) === url) return;
  session.safeUrls.push(url);
  if (session.safeUrls.length > 25) session.safeUrls.shift();
}

function publicState(session: Session) {
  touch(session);
  return {
    id: session.id,
    name: session.name,
    startUrl: session.startUrl,
    url: session.page.isClosed() ? "" : session.page.url(),
    recording: session.recording,
    autoAds: session.autoAds,
    mobile: session.mobile,
    browserVersion: session.browserVersion,
    persistentProfile: true,
    viewportWidth: session.width,
    viewportHeight: session.height,
    steps: session.steps,
    events: session.events,
    createdAt: session.createdAt,
    touchedAt: session.touchedAt
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

async function configurePage(page: Page, userAgent: string, mobile: boolean, width: number, height: number) {
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(20_000);
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await page.setUserAgent(userAgent);
}

async function elementAt(page: Page, x: number, y: number): Promise<ElementInfo | null> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    if (!(element instanceof HTMLElement) || element === document.body) return null;
    return describe(element);
    function describe(node: HTMLElement) {
      const editable = node.matches("input,textarea,[contenteditable='true'],[role='textbox']");
      const sensitive = node instanceof HTMLInputElement && node.type.toLowerCase() === "password";
      const label = node.getAttribute("placeholder") || node.getAttribute("aria-label") || node.innerText || node.tagName.toLowerCase();
      let selector: string | null = node.id ? `#${CSS.escape(node.id)}` : null;
      const name = node.getAttribute("name");
      if (!selector && name) selector = `${node.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      if (!selector) {
        const parent = node.parentElement;
        const siblings = parent ? [...parent.children].filter((item) => item.tagName === node.tagName) : [];
        selector = `${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`;
      }
      return { selector, tagName: node.tagName.toLowerCase(), editable, sensitive, label: String(label).trim().slice(0, 80) };
    }
  }, { x, y });
}

async function activeElement(page: Page): Promise<ElementInfo | null> {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement) || node === document.body) return null;
    const editable = node.matches("input,textarea,[contenteditable='true'],[role='textbox']");
    const sensitive = node instanceof HTMLInputElement && node.type.toLowerCase() === "password";
    const label = node.getAttribute("placeholder") || node.getAttribute("aria-label") || node.innerText || node.tagName.toLowerCase();
    let selector: string | null = node.id ? `#${CSS.escape(node.id)}` : null;
    const name = node.getAttribute("name");
    if (!selector && name) selector = `${node.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (!selector) {
      const parent = node.parentElement;
      const siblings = parent ? [...parent.children].filter((item) => item.tagName === node.tagName) : [];
      selector = `${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`;
    }
    return { selector, tagName: node.tagName.toLowerCase(), editable, sensitive, label: String(label).trim().slice(0, 80) };
  });
}

function isObviousAdUrl(value: string) {
  const lower = value.toLowerCase();
  return /doubleclick|googlesyndication|googleadservices|adservice|adnxs|popads|popcash|propellerads|onclickads|trafficjunky|exoclick|taboola|outbrain/.test(lower);
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
    for (const [id, session] of sessions) {
      if (Date.parse(session.touchedAt) < cutoff) void closeLiveBrowser(id);
    }
  }, 60_000);
  cleanupTimer.unref();
}

function touch(session: Session) { session.touchedAt = new Date().toISOString(); }
function validateUrl(value: string) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dozwolone są tylko adresy HTTP i HTTPS."); return url.toString(); }
function safeHost(value: string) { try { return new URL(value).host.toLowerCase(); } catch { return ""; } }
function clamp(value: number, min: number, max: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : min; }
function short(value: string) { return value.length > 110 ? `${value.slice(0, 109)}…` : value; }
function normalizeKey(value: string): KeyInput { const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Space"] as KeyInput[]; return allowed.includes(value as KeyInput) ? value as KeyInput : "Enter"; }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function settle(page: Page, ms: number) { await delay(ms); await page.waitForNetworkIdle({ idleTime: 300, timeout: 2200 }).catch(() => undefined); }
