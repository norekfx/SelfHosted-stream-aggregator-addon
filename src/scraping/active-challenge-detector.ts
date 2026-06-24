import type { Page } from "puppeteer";

export type ActiveChallenge = { detected: boolean; kind: string };

export async function detectActiveChallenge(page: Page): Promise<ActiveChallenge> {
  try {
    return await page.evaluate(() => {
      const visibleRect = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || Number(style.opacity || "1") <= 0.05
          || rect.width < 20
          || rect.height < 20
          || rect.bottom <= 0
          || rect.right <= 0
          || rect.top >= innerHeight
          || rect.left >= innerWidth
        ) return null;
        return rect;
      };

      const text = (document.body?.innerText || "").toLowerCase().replace(/\s+/g, " ").slice(0, 120000);
      const title = document.title.toLowerCase();
      const verificationText = /verify you are human|potwierdź, że jesteś człowiekiem|i'?m not a robot|nie jestem robotem|complete the challenge|checking your browser|security verification/.test(text);
      const blockingTitle = /just a moment|security check|human verification|weryfikacja użytkownika/.test(title);

      for (const frame of document.querySelectorAll("iframe")) {
        const rect = visibleRect(frame);
        if (!rect) continue;
        const identity = `${frame.getAttribute("src") || ""} ${frame.getAttribute("title") || ""}`.toLowerCase();
        if (!/recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com/.test(identity)) continue;

        const largeChallenge = rect.width >= 320 && rect.height >= 150;
        if (!largeChallenge && !verificationText && !blockingTitle) continue;

        const kind = /hcaptcha/.test(identity) ? "hCaptcha"
          : /turnstile|cloudflare/.test(identity) ? "Cloudflare Turnstile"
          : "reCAPTCHA";
        return { detected: true, kind };
      }

      const challengeContainers = [
        ...document.querySelectorAll("#challenge-stage,#challenge-running,.challenge-container,.cf-turnstile")
      ];
      for (const container of challengeContainers) {
        const rect = visibleRect(container);
        if (!rect) continue;
        const areaRatio = (rect.width * rect.height) / Math.max(1, innerWidth * innerHeight);
        const control = container.querySelector("iframe,input[type='checkbox'],[role='checkbox'],textarea,button,canvas");
        if (areaRatio >= 0.18 && control && visibleRect(control) && (verificationText || blockingTitle)) {
          return { detected: true, kind: "Weryfikacja użytkownika" };
        }
      }

      return { detected: false, kind: "" };
    });
  } catch {
    return { detected: false, kind: "" };
  }
}
