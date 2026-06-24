import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearLiveBrowserSteps,
  clickLiveBrowser,
  closeLiveBrowser,
  commandLiveBrowser,
  createLiveBrowser,
  getLiveBrowserScreenshot,
  getLiveBrowserState,
  keyLiveBrowser,
  markLiveBrowserAd,
  markLiveSearchField,
  navigateLiveBrowser,
  scrollLiveBrowser,
  setLiveBrowserAds,
  setLiveBrowserRecording,
  typeLiveBrowser,
  undoLiveBrowserStep
} from "./live-browser-session.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url(),
  mobile: z.boolean().optional(),
  recording: z.boolean().optional(),
  autoAds: z.boolean().optional()
});
const clickSchema = z.object({ x: z.coerce.number(), y: z.coerce.number() });
const typeSchema = z.object({ text: z.string().max(20_000), replace: z.boolean().optional() });
const keySchema = z.object({ key: z.string().min(1).max(40) });
const scrollSchema = z.object({ deltaY: z.coerce.number().min(-5000).max(5000) });
const navigateSchema = z.object({ url: z.string().url() });
const commandSchema = z.object({ command: z.enum(["back", "forward", "reload"]) });
const toggleSchema = z.object({ enabled: z.boolean() });

export async function registerLiveBrowserRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/scraping/live", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawne ustawienia sesji Chromium.", details: parsed.error.flatten() }; }
    try { return { session: await createLiveBrowser(parsed.data) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.get<{ Params: { id: string } }>("/admin/scraping/live/:id", async (request, reply) => {
    try { return { session: getLiveBrowserState(request.params.id) }; }
    catch (error) { reply.code(404); return { error: message(error) }; }
  });

  app.get<{ Params: { id: string } }>("/admin/scraping/live/:id/screenshot", async (request, reply) => {
    try {
      const image = await getLiveBrowserScreenshot(request.params.id);
      reply.header("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      reply.type("image/jpeg");
      return reply.send(image);
    } catch (error) { reply.code(404); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/click", async (request, reply) => {
    const parsed = clickSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawne współrzędne." }; }
    try { return await clickLiveBrowser(request.params.id, parsed.data.x, parsed.data.y); }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/type", async (request, reply) => {
    const parsed = typeSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny tekst." }; }
    try { return { session: await typeLiveBrowser(request.params.id, parsed.data.text, parsed.data.replace) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/key", async (request, reply) => {
    const parsed = keySchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny klawisz." }; }
    try { return { session: await keyLiveBrowser(request.params.id, parsed.data.key) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/scroll", async (request, reply) => {
    const parsed = scrollSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny gest przewijania." }; }
    try { return { session: await scrollLiveBrowser(request.params.id, parsed.data.deltaY) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/navigate", async (request, reply) => {
    const parsed = navigateSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny URL." }; }
    try { return { session: await navigateLiveBrowser(request.params.id, parsed.data.url) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/command", async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawna komenda." }; }
    try { return { session: await commandLiveBrowser(request.params.id, parsed.data.command) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/recording", async (request, reply) => toggle(request, reply, setLiveBrowserRecording));
  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/ad-protection", async (request, reply) => toggle(request, reply, setLiveBrowserAds));

  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/mark-ad", async (request, reply) => run(request.params.id, reply, markLiveBrowserAd));
  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/mark-search", async (request, reply) => run(request.params.id, reply, markLiveSearchField));
  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/undo", async (request, reply) => runSync(request.params.id, reply, undoLiveBrowserStep));
  app.post<{ Params: { id: string } }>("/admin/scraping/live/:id/clear", async (request, reply) => runSync(request.params.id, reply, clearLiveBrowserSteps));

  app.delete<{ Params: { id: string } }>("/admin/scraping/live/:id", async (request) => {
    await closeLiveBrowser(request.params.id);
    return { ok: true };
  });
}

async function toggle(
  request: { params: { id: string }; body: unknown },
  reply: { code: (status: number) => unknown },
  action: (id: string, enabled: boolean) => unknown
) {
  const parsed = toggleSchema.safeParse(request.body);
  if (!parsed.success) { reply.code(400); return { error: "Niepoprawna wartość." }; }
  try { return { session: action(request.params.id, parsed.data.enabled) }; }
  catch (error) { reply.code(500); return { error: message(error) }; }
}

async function run(id: string, reply: { code: (status: number) => unknown }, action: (id: string) => Promise<unknown>) {
  try { return { session: await action(id) }; }
  catch (error) { reply.code(500); return { error: message(error) }; }
}

function runSync(id: string, reply: { code: (status: number) => unknown }, action: (id: string) => unknown) {
  try { return { session: action(id) }; }
  catch (error) { reply.code(500); return { error: message(error) }; }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
