import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { activateLiveBrowserTab, closeLiveBrowserTab, createLiveBrowserTab } from "./live-browser-session.js";

const newTabSchema = z.object({ url: z.string().url().optional() });

export async function registerLiveBrowserTabRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/tabs", async (request, reply) => {
    const parsed = newTabSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Niepoprawny adres nowej karty." };
    }
    try {
      return { session: await createLiveBrowserTab(request.params.id, parsed.data.url) };
    } catch (error) {
      reply.code(500);
      return { error: message(error) };
    }
  });

  app.post<{ Params: { id: string; tabId: string } }>("/admin/scraping/live/:id/tabs/:tabId/activate", async (request, reply) => {
    try {
      return { session: await activateLiveBrowserTab(request.params.id, request.params.tabId) };
    } catch (error) {
      reply.code(404);
      return { error: message(error) };
    }
  });

  app.delete<{ Params: { id: string; tabId: string } }>("/admin/scraping/live/:id/tabs/:tabId", async (request, reply) => {
    try {
      return { session: await closeLiveBrowserTab(request.params.id, request.params.tabId) };
    } catch (error) {
      reply.code(409);
      return { error: message(error) };
    }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
