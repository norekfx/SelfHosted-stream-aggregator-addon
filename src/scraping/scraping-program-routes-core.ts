import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDatabase } from "../db/database.js";
import { writeSystemLog } from "../system/system-log.js";
import { getScrapingResults, runScraping, type ScrapingProgramAction } from "./scraping-engine.js";

const actionTypes = ["goto", "click", "type", "select", "press", "wait", "waitFor", "scroll", "hover", "script", "extract"] as const;

const actionSchema = z.object({
  id: z.string().optional(),
  actionType: z.enum(actionTypes),
  selector: z.string().max(2000).nullable().optional(),
  value: z.string().max(200000).nullable().optional(),
  x: z.coerce.number().int().min(-100000).max(100000).nullable().optional(),
  y: z.coerce.number().int().min(-100000).max(100000).nullable().optional(),
  waitMs: z.coerce.number().int().min(0).max(120000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional()
});

const programSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url(),
  cloudflare: z.boolean().default(false),
  headless: z.boolean().default(true),
  userAgent: z.string().max(2000).optional().default(""),
  viewportWidth: z.coerce.number().int().min(320).max(7680).default(1440),
  viewportHeight: z.coerce.number().int().min(240).max(4320).default(900),
  initialWaitMs: z.coerce.number().int().min(0).max(120000).default(1500),
  headers: z.record(z.string()).default({}),
  actions: z.array(actionSchema).max(200).default([])
});

type ConfigRow = {
  id: string;
  name: string;
  url: string;
  cloudflare: number;
  headless: number;
  user_agent: string | null;
  viewport_width: number;
  viewport_height: number;
  initial_wait_ms: number;
  headers_json: string;
  created_at: string;
  updated_at: string;
};

type ActionRow = {
  id: string;
  config_id: string;
  action_type: ScrapingProgramAction["actionType"];
  selector: string | null;
  x: number | null;
  y: number | null;
  value: string | null;
  wait_ms: number | null;
  sort_order: number;
  created_at: string;
};

export async function registerCoreScrapingProgramRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/scraping/programs", async () => ({ programs: listPrograms() }));

  app.get<{ Params: { id: string } }>("/admin/scraping/programs/:id", async (request, reply) => {
    const program = getProgram(request.params.id);
    if (!program) {
      reply.code(404);
      return { error: "Scraping program not found." };
    }
    return { program, results: getScrapingResults(request.params.id) };
  });

  app.post("/admin/scraping/programs", async (request, reply) => {
    const parsed = programSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid scraping program.", details: parsed.error.flatten() };
    }
    const id = crypto.randomUUID();
    saveProgram(id, parsed.data, true);
    const program = getProgram(id);
    writeSystemLog("info", "scraping", "Chromium scraping program created.", {
      id,
      name: parsed.data.name,
      actions: parsed.data.actions.length
    });
    reply.code(201);
    return { program };
  });

  app.put<{ Params: { id: string } }>("/admin/scraping/programs/:id", async (request, reply) => {
    const existing = getProgram(request.params.id);
    if (!existing) {
      reply.code(404);
      return { error: "Scraping program not found." };
    }
    const parsed = programSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid scraping program.", details: parsed.error.flatten() };
    }
    saveProgram(request.params.id, parsed.data, false);
    writeSystemLog("info", "scraping", "Chromium scraping program updated.", {
      id: request.params.id,
      name: parsed.data.name,
      actions: parsed.data.actions.length
    });
    return { program: getProgram(request.params.id) };
  });

  app.delete<{ Params: { id: string } }>("/admin/scraping/programs/:id", async (request, reply) => {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM scraping_configs WHERE id = ?").run(request.params.id);
    if (!result.changes) {
      reply.code(404);
      return { error: "Scraping program not found." };
    }
    writeSystemLog("info", "scraping", "Chromium scraping program deleted.", { id: request.params.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/admin/scraping/programs/:id/run", async (request, reply) => {
    const db = getDatabase();
    const config = db.prepare("SELECT * FROM scraping_configs WHERE id = ?").get(request.params.id) as ConfigRow | undefined;
    if (!config) {
      reply.code(404);
      return { error: "Scraping program not found." };
    }
    try {
      const result = await runScraping(config);
      return { result, savedResults: getScrapingResults(request.params.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500);
      return { error: message };
    }
  });
}

function listPrograms() {
  const rows = getDatabase().prepare("SELECT * FROM scraping_configs ORDER BY updated_at DESC, created_at DESC").all() as ConfigRow[];
  return rows.map((row) => mapProgram(row, listActions(row.id)));
}

function getProgram(id: string) {
  const row = getDatabase().prepare("SELECT * FROM scraping_configs WHERE id = ?").get(id) as ConfigRow | undefined;
  return row ? mapProgram(row, listActions(id)) : null;
}

function listActions(configId: string): ScrapingProgramAction[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM scraping_actions WHERE config_id = ? ORDER BY sort_order ASC, created_at ASC")
    .all(configId) as ActionRow[];
  return rows.map((row) => ({
    id: row.id,
    actionType: row.action_type,
    selector: row.selector,
    value: row.value,
    x: row.x,
    y: row.y,
    waitMs: row.wait_ms,
    sortOrder: row.sort_order
  }));
}

function saveProgram(id: string, data: z.infer<typeof programSchema>, create: boolean): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.transaction(() => {
    if (create) {
      db.prepare(
        "INSERT INTO scraping_configs (id, name, url, cloudflare, headless, user_agent, viewport_width, viewport_height, initial_wait_ms, headers_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, data.name, data.url, data.cloudflare ? 1 : 0, data.headless ? 1 : 0, data.userAgent || null, data.viewportWidth, data.viewportHeight, data.initialWaitMs, JSON.stringify(data.headers), now, now);
    } else {
      db.prepare(
        "UPDATE scraping_configs SET name = ?, url = ?, cloudflare = ?, headless = ?, user_agent = ?, viewport_width = ?, viewport_height = ?, initial_wait_ms = ?, headers_json = ?, updated_at = ? WHERE id = ?"
      ).run(data.name, data.url, data.cloudflare ? 1 : 0, data.headless ? 1 : 0, data.userAgent || null, data.viewportWidth, data.viewportHeight, data.initialWaitMs, JSON.stringify(data.headers), now, id);
    }

    db.prepare("DELETE FROM scraping_actions WHERE config_id = ?").run(id);
    const insert = db.prepare(
      "INSERT INTO scraping_actions (id, config_id, action_type, selector, x, y, value, wait_ms, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    data.actions.forEach((action, index) => {
      insert.run(action.id || crypto.randomUUID(), id, action.actionType, action.selector || null, action.x ?? null, action.y ?? null, action.value ?? null, action.waitMs ?? 0, action.sortOrder ?? index, now);
    });
  })();
}

function mapProgram(row: ConfigRow, actions: ScrapingProgramAction[]) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    cloudflare: Boolean(row.cloudflare),
    headless: Boolean(row.headless),
    userAgent: row.user_agent ?? "",
    viewportWidth: row.viewport_width ?? 1440,
    viewportHeight: row.viewport_height ?? 900,
    initialWaitMs: row.initial_wait_ms ?? 1500,
    headers: safeObject(row.headers_json),
    actions,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeObject(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}
