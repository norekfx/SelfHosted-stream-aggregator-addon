import type { Page } from "puppeteer";

export type ActiveChallenge = { detected: boolean; kind: string };

export async function detectActiveChallenge(page: Page): Promise<ActiveChallenge> {
  try {
    return await page.evaluate(() => {
      const visible = (element: Element | null, width = 80, height = 35) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0.05
          && rect.width >= width
          && rect.height >= height
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < innerHeight
          && rect.left < innerWidth;
      };

      for (const frame of document.querySelectorAll("iframe")) {
        if (!visible(frame, 120, 45)) continue;
        const identity = `${frame.getAttribute("src") || ""} ${frame.getAttribute("title") || ""}`.toLowerCase();
        if (/captcha|turnstile|human.verification|challenge/.test(identity)) {
          return { detected: true, kind: identity.includes("turnstile") ? "Turnstile" : "Weryfikacja użytkownika" };
        }
      }

      for (const widget of document.querySelectorAll("[data-sitekey],#challenge-stage,#challenge-running")) {
        if (!visible(widget, 120, 45)) continue;
        const control = widget.querySelector("iframe,input[type='checkbox'],[role='checkbox'],textarea,button,canvas");
        if (control && visible(control, 20, 20)) return { detected: true, kind: "Weryfikacja użytkownika" };
      }

      const text = (document.body?.innerText || "").toLowerCase().replace(/\s+/g, " ").slice(0, 100000);
      const blockingText = /verify you are human|potwierdź, że jesteś człowiekiem|i'?m not a robot|nie jestem robotem|checking your browser/.test(text);
      const blockingControl = [...document.querySelectorAll("input[type='checkbox'],[role='checkbox'],button,canvas")]
        .find((element) => visible(element, 20, 20));
      const blockingContainer = [...document.querySelectorAll("#challenge-stage,#challenge-running,[data-sitekey]")]
        .find((element) => visible(element, 120, 45));

      return blockingText && blockingControl && blockingContainer
        ? { detected: true, kind: "Weryfikacja użytkownika" }
        : { detected: false, kind: "" };
    });
  } catch {
    return { detected: false, kind: "" };
  }
}
