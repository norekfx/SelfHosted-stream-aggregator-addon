import type { Page } from "puppeteer";
import type { ScrapingProgramAction } from "./scraping-engine.js";

const CLICK_META_PREFIX = "__ssa_click_meta__:";

export type ClickStepMetadata = {
  sourceUrl?: string;
  sourceTabId?: string;
  expectAdPopup?: boolean;
};

export function encodeClickMetadata(metadata: ClickStepMetadata): string {
  return `${CLICK_META_PREFIX}${JSON.stringify(metadata)}`;
}

export function decodeClickMetadata(value?: string | null): ClickStepMetadata {
  if (!value?.startsWith(CLICK_META_PREFIX)) return {};
  try {
    const parsed = JSON.parse(value.slice(CLICK_META_PREFIX.length)) as ClickStepMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function markActionAsExpectedAd(action: ScrapingProgramAction, fallbackSourceUrl: string, sourceTabId?: string): void {
  const current = decodeClickMetadata(action.value);
  action.value = encodeClickMetadata({
    sourceUrl: current.sourceUrl || fallbackSourceUrl,
    sourceTabId: current.sourceTabId || sourceTabId,
    expectAdPopup: true
  });
}

export function isExpectedAdClick(action: ScrapingProgramAction): boolean {
  return action.actionType === "click" && decodeClickMetadata(action.value).expectAdPopup === true;
}

export function isObviousAdUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return /doubleclick|googlesyndication|googleadservices|adservice|adnxs|popads|popcash|propellerads|onclickads|trafficjunky|exoclick|taboola|outbrain|adsterra|clickadu|hilltopads/.test(lower);
}

export function scoreUrlSimilarity(candidate: string, reference: string): number {
  if (!candidate || !reference) return -1;
  if (candidate === reference) return 10_000;
  try {
    const left = new URL(candidate);
    const right = new URL(reference);
    let score = 0;
    if (left.origin === right.origin) score += 4_000;
    else if (left.hostname === right.hostname) score += 3_000;
    else if (sameParentDomain(left.hostname, right.hostname)) score += 1_200;
    if (left.pathname === right.pathname) score += 2_000;
    const leftParts = left.pathname.split("/").filter(Boolean);
    const rightParts = right.pathname.split("/").filter(Boolean);
    let shared = 0;
    while (shared < leftParts.length && shared < rightParts.length && leftParts[shared] === rightParts[shared]) shared += 1;
    score += shared * 250;
    score += commonPrefixLength(left.href, right.href);
    if (left.search === right.search) score += 200;
    if (isObviousAdUrl(candidate)) score -= 8_000;
    return score;
  } catch {
    return commonPrefixLength(candidate, reference);
  }
}

export function chooseMostSimilarPage(pages: Page[], referenceUrl: string, preferred?: Page): Page | null {
  const available = pages.filter((page) => !page.isClosed());
  if (preferred && available.includes(preferred) && !isObviousAdUrl(preferred.url())) return preferred;
  return available
    .map((page) => ({ page, score: scoreUrlSimilarity(page.url(), referenceUrl) }))
    .sort((a, b) => b.score - a.score)[0]?.page ?? null;
}

export function tabLabel(url: string, index: number): string {
  if (!url || url === "about:blank") return `Nowa karta ${index + 1}`;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    return path ? `${parsed.hostname}/${path}` : parsed.hostname;
  } catch {
    return `Karta ${index + 1}`;
  }
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length, 500);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function sameParentDomain(left: string, right: string): boolean {
  const leftParts = left.split(".").slice(-2).join(".");
  const rightParts = right.split(".").slice(-2).join(".");
  return Boolean(leftParts && leftParts === rightParts);
}
