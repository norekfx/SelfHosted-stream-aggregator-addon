import type { FastifyInstance } from "fastify";
import { registerLiveBrowserRoutes } from "./live-browser-routes.js";
import { registerLiveTestRoutes } from "./live-test-routes.js";
import { registerCoreScrapingProgramRoutes } from "./scraping-program-routes-core.js";

export async function registerScrapingProgramRoutes(app: FastifyInstance): Promise<void> {
  await registerCoreScrapingProgramRoutes(app);
  await registerLiveBrowserRoutes(app);
  await registerLiveTestRoutes(app);
}
