import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clickLiveTest,
  closeLiveTest,
  commandLiveTest,
  createLiveTestSession,
  getLiveTestScreenshot,
  getLiveTestState,
  keyLiveTest,
  resumeLiveTest,
  scrollLiveTest,
  skipCurrentLiveTestStep,
  stopLiveTest,
  typeLiveTest
} from "./live-test-session.js";

const clickSchema = z.object({ x: z.coerce.number(), y: z.coerce.number() });
const typeSchema = z.object({ text: z.string().max(20_000), replace: z.boolean().optional() });
const keySchema = z.object({ key: z.string().min(1).max(40) });
const scrollSchema = z.object({ deltaY: z.coerce.number().min(-5000).max(5000) });
const commandSchema = z.object({ command: z.enum(["back", "forward", "reload"]) });
const resumeSchema = z.object({ force: z.boolean().optional() });

export async function registerLiveTestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { programId: string } }>("/admin/scraping/live-test/program/:programId", async (request, reply) => {
    try { return { test: await createLiveTestSession(request.params.programId) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.get<{ Params: { id: string } }>("/admin/scraping/live-test/:id", async (request, reply) => {
    try { return { test: getLiveTestState(request.params.id) }; }
    catch (error) { reply.code(404); return { error: message(error) }; }
  });

  app.get<{ Params: { id: string } }>("/admin/scraping/live-test/:id/screenshot", async (request, reply) => {
    try {
      const image = await getLiveTestScreenshot(request.params.id);
      reply.header("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      reply.type("image/jpeg");
      return reply.send(image);
    } catch (error) { reply.code(404); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/click", async (request, reply) => {
    const parsed = clickSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawne współrzędne." }; }
    try { return { test: await clickLiveTest(request.params.id, parsed.data.x, parsed.data.y) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/type", async (request, reply) => {
    const parsed = typeSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny tekst." }; }
    try { return { test: await typeLiveTest(request.params.id, parsed.data.text, parsed.data.replace) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/key", async (request, reply) => {
    const parsed = keySchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny klawisz." }; }
    try { return { test: await keyLiveTest(request.params.id, parsed.data.key) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/scroll", async (request, reply) => {
    const parsed = scrollSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawny gest przewijania." }; }
    try { return { test: await scrollLiveTest(request.params.id, parsed.data.deltaY) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/command", async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawna komenda." }; }
    try { return { test: await commandLiveTest(request.params.id, parsed.data.command) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/resume", async (request, reply) => {
    const parsed = resumeSchema.safeParse(request.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "Niepoprawna wartość wznowienia." }; }
    try { return { test: await resumeLiveTest(request.params.id, Boolean(parsed.data.force)) }; }
    catch (error) { reply.code(409); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/skip", async (request, reply) => {
    try { return { test: await skipCurrentLiveTestStep(request.params.id) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/live-test/:id/stop", async (request, reply) => {
    try { return { test: await stopLiveTest(request.params.id) }; }
    catch (error) { reply.code(500); return { error: message(error) }; }
  });

  app.delete<{ Params: { id: string } }>("/admin/scraping/live-test/:id", async (request) => {
    await closeLiveTest(request.params.id);
    return { ok: true };
  });
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
