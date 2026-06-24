import type { Browser, KeyInput, Page, Target } from "puppeteer";
import {
  chooseMostSimilarPage,
  decodeClickMetadata,
  encodeClickMetadata,
  isObviousAdUrl,
  markActionAsExpectedAd,
  tabLabel
} from "./browser-tab-strategy.js";
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
  userAgent: string;
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
  tabs: Map<string, Page>;
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
    userAgent: identity.userAgent,
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
    tabs: new Map<string, Page>(),
    createdAt: now,
    touchedAt: now,
    closing: false
  };
  sessions.set(session.id, session);
  attachBrowserListeners(session);
  attachPageListeners(session, page);
  addEvent(session, "info", `Uruchomiono Chromium ${identity.version} z trwałym profilem cookies i obsługą wielu kart.`, url);

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

export async function createLiveBrowserTab(id: string, url?: string) {
  const session = requireSession(id);
  touch(session);
  const page = await session.browser.newPage();
  await configurePage(page, session.userAgent, session.mobile, session.width, session.height);
  attachPageListeners(session, page);
  session.page = page;
  await page.bringToFront().catch(() => undefined);
  if (url) await page.goto(validateUrl(url), { waitUntil: "domcontentloaded", timeout: 60_000 });
  addEvent(session, "popup", "Utworzono nową kartę.", page.url());
  return publicState(session);
}

export async function activateLiveBrowserTab(id: string, tabId: string) {
  const session = requireSession(id);
  touch(session);
  const page = session.tabs.get(tabId);
  if (!page || page.isClosed()) throw new Error("Wybrana karta już nie istnieje.");
  session.page = page;
  await page.bringToFront().catch(() => undefined);
  addEvent(session, "popup", "Przełączono aktywną kartę.", page.url());
  return publicState(session);
}

export async function closeLiveBrowserTab(id: string, tabId: string) {
  const session = requireSession(id);
  touch(session);
  const page = session.tabs.get(tabId);
  if (!page || page.isClosed()) throw new Error("Wybrana karta już nie istnieje.");
  const openTabs = [...session.tabs.values()].filter((item) => !item.isClosed());
  if (openTabs.length <= 1) throw new Error("Nie można zamknąć ostatniej karty.");
  const wasActive = page === session.page;
  const referenceUrl = page.url() || session.startUrl;
  session.tabs.delete(tabId);
  await page.close().catch(() => undefined);
  if (wasActive) {
    const remaining = [...session.tabs.values()].filter((item) => !item.isClosed());
    session.page = chooseMostSimilarPage(remaining, referenceUrl) || remaining[0]!;
    await session.page.bringToFront().catch(() => undefined);
  }
  addEvent(session, "popup", "Zamknięto kartę.", referenceUrl);
  return publicState(session);
}

export async function clickLiveBrowser(id: string, xInput: number, yInput: number) {
  const session = requireSession(id);
  touch(session);
  const page = await ensureActivePage(session);
  const sourceUrl = page.url();
  const sourceTabId = getTabId(session, page);
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
      value: encodeClickMetadata({ sourceUrl, sourceTabId }),
      x,
      y,
      waitMs: 450,
      label: element ? `Kliknij ${element.label}` : `Kliknij (${x}, ${y})`
    });
  }
  await settle(page, 220);
  await refreshKnownTabs(session);
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
  await refreshKnownTabs(session);
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
  touch(session);
  const currentPage = await ensureActivePage(session);
  const lastClick = [...session.steps].reverse().find((step) => step.actionType === "click");
  if (!lastClick) throw new Error("Najpierw wykonaj kliknięcie, które może otwierać reklamę.");

  const currentTabId = getTabId(session, currentPage);
  const existingMeta = decodeClickMetadata(lastClick.value);
  const sourceUrl = existingMeta.sourceUrl || session.safeUrls.at(-1) || session.startUrl;
  markActionAsExpectedAd(lastClick, sourceUrl, existingMeta.sourceTabId || currentTabId);
  if (!lastClick.label.includes("możliwa reklama")) lastClick.label = `${lastClick.label} — możliwa reklama`;

  const currentUrl = currentPage.url();
  const currentHost = safeHost(currentUrl);
  if (currentHost) session.adHosts.add(currentHost);
  await refreshKnownTabs(session);

  const sourcePage = existingMeta.sourceTabId ? session.tabs.get(existingMeta.sourceTabId) : undefined;
  const otherPages = [...session.tabs.values()].filter((page) => !page.isClosed() && page !== currentPage);
  const target = chooseMostSimilarPage(otherPages, sourceUrl, sourcePage && sourcePage !== currentPage ? sourcePage : undefined);

  if (target) {
    const adTabId = getTabId(session, currentPage);
    session.tabs.delete(adTabId);
    await currentPage.close().catch(() => undefined);
    session.page = target;
    await target.bringToFront().catch(() => undefined);
    addEvent(session, "ad", `Oznaczono ostatnie kliknięcie jako mogące otworzyć reklamę. Zamknięto kartę i wrócono do najbardziej podobnego adresu.`, target.url());
  } else {
    await currentPage.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
    if (scoreAgainst(currentPage.url(), sourceUrl) < 1_000) {
      await currentPage.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    }
    session.page = currentPage;
    addEvent(session, "ad", "Oznaczono ostatnie kliknięcie jako mogące otworzyć reklamę i przywrócono stronę źródłową.", currentPage.url());
  }
  rememberSafe(session);
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
  registerTab(session, page);
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
    const tabId = getTabId(session, page);
    session.tabs.delete(tabId);
    if (page === session.page && !session.closing) void selectBestPage(session);
  });
}

async function handlePopup(session: Session, target: Target) {
  if (session.closing || target.type() !== "page" || target === session.page.target()) return;
  const popup = await target.page().catch(() => null);
  if (!popup) return;
  await configurePage(popup, session.userAgent, session.mobile, session.width, session.height).catch(() => undefined);
  attachPageListeners(session, popup);
  await delay(600);
  if (popup.isClosed()) return;

  const popupUrl = popup.url();
  const popupHost = safeHost(popupUrl);
  const currentHost = safeHost(session.page.url());
  const markedAd = popupHost && session.adHosts.has(popupHost);

  if (session.autoAds && (markedAd || isObviousAdUrl(popupUrl))) {
    if (popupHost) session.adHosts.add(popupHost);
    const tabId = getTabId(session, popup);
    session.tabs.delete(tabId);
    addEvent(session, "ad", `Zamknięto rozpoznaną kartę reklamową: ${popupHost || popupUrl}.`, popupUrl);
    await popup.close().catch(() => undefined);
    await session.page.bringToFront().catch(() => undefined);
    return;
  }

  session.page = popup;
  await popup.bringToFront().catch(() => undefined);
  addEvent(
    session,
    "popup",
    currentHost === popupHost ? "Przełączono na nową kartę serwisu." : "Otworzono nową kartę. Możesz przełączać ją na pasku kart.",
    popupUrl
  );
  rememberSafe(session);
}

async function refreshKnownTabs(session: Session) {
  const pages = await session.browser.pages();
  for (const page of pages) {
    if (page.isClosed()) continue;
    attachPageListeners(session, page);
  }
  for (const [tabId, page] of session.tabs) {
    if (page.isClosed()) session.tabs.delete(tabId);
  }
}

async function selectBestPage(session: Session) {
  await refreshKnownTabs(session);
  const pages = [...session.tabs.values()].filter((page) => !page.isClosed());
  if (!pages.length) throw new Error("Chromium nie ma aktywnej karty.");
  const candidates = pages.filter((page) => page.url() !== "about:blank" && !session.adHosts.has(safeHost(page.url())));
  const next = chooseMostSimilarPage(candidates.length ? candidates : pages, session.safeUrls.at(-1) || session.startUrl) || pages[0]!;
  if (session.page !== next) {
    session.page = next;
    addEvent(session, "popup", "Automatycznie przełączono na najbardziej podobną aktywną kartę.", next.url());
  }
  await next.bringToFront().catch(() => undefined);
  return next;
}

async function ensureActivePage(session: Session) {
  await refreshKnownTabs(session);
  if (session.page.isClosed()) return selectBestPage(session);
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
  const tabs = [...session.tabs.entries()]
    .filter(([, page]) => !page.isClosed())
    .map(([id, page], index) => ({ id, url: page.url(), label: tabLabel(page.url(), index), active: page === session.page }));
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
    tabs,
    steps: session.steps,
    events: session.events,
    createdAt: session.createdAt,
    touchedAt: session.touchedAt
  };
}

function registerTab(session: Session, page: Page) {
  for (const [id, existing] of session.tabs) if (existing === page) return id;
  const id = crypto.randomUUID();
  session.tabs.set(id, page);
  return id;
}

function getTabId(session: Session, page: Page) {
  return registerTab(session, page);
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

function scoreAgainst(candidate: string, reference: string) {
  try {
    const left = new URL(candidate);
    const right = new URL(reference);
    if (left.href === right.href) return 10_000;
    if (left.origin === right.origin) return 4_000;
    if (left.hostname === right.hostname) return 3_000;
    return 0;
  } catch {
    return 0;
  }
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
