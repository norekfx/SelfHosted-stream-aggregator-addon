import type { ScrapingRunResult } from "./scraping-engine.js";
import { closeLiveTest, createLiveTestSession, getLiveTestState } from "./live-test-session-v2.js";

type ScrapingConfig = { id: string; name: string; url: string };

export async function runScraping(config: ScrapingConfig): Promise<ScrapingRunResult> {
  const initial = await createLiveTestSession(config.id);
  const id = initial.id;
  const deadline = Date.now() + 5 * 60_000;

  try {
    let state = initial;
    while (!["completed", "completed_with_errors", "failed", "stopped"].includes(state.status)) {
      if (state.status === "paused_captcha") {
        throw new Error("Proces wymaga ręcznej weryfikacji. Uruchom test wizualny i dokończ ją w oknie Chromium.");
      }
      if (Date.now() > deadline) throw new Error("Przekroczono limit czasu procesu.");
      await delay(400);
      state = getLiveTestState(id);
    }

    if (state.status === "failed" || state.successfulSteps === 0) {
      throw new Error("Żaden krok procesu nie został wykonany poprawnie.");
    }

    return {
      videoUrls: state.videoUrls,
      actions: state.steps.map((step) => ({
        type: step.actionType,
        ...(step.selector ? { selector: step.selector } : {}),
        status: step.status === "ok" ? "ok" : "error",
        ...(step.message ? { message: step.message } : {}),
        timestamp: step.finishedAt || step.startedAt || state.createdAt
      })),
      finalUrl: state.url,
      title: state.programName
    };
  } finally {
    await closeLiveTest(id);
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
