import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { registerAuthRoutes, requireAdminAuth } from "./auth/auth-routes.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { getCachedLibraryItems, saveLibraryItems } from "./libraries/library-cache.js";
import { getLibraryForCatalog } from "./libraries/library-registry.js";
import { getEffectivePublicBaseUrl } from "./settings/app-settings.js";
import { getAddonManifest } from "./stremio/manifest.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";
import { getSelectedOriginal } from "./streams/original-store.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { fetchTmdbCatalog } from "./tmdb/tmdb-client.js";
import { registerTranscodeRoutes } from "./transcoding/transcode-routes.js";
import { registerTranscodeVodRoutes } from "./transcoding/transcode-vod-routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");

runMigrations(getDatabase());

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  }
});

await app.register(cors, { origin: true });
app.get("/app.js", async (_, reply) => {
  const [mainScript, addonDeleteHelper] = await Promise.all([
    readFile(join(publicDir, "app.js"), "utf-8"),
    readFile(join(publicDir, "addon-delete-helper.js"), "utf-8").catch(() => "")
  ]);
  reply.type("application/javascript; charset=utf-8");
  return `${mainScript}\n\n${addonDeleteHelper}`;
});
await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
await app.register(registerAuthRoutes);
await app.register(async (adminApp) => {
  adminApp.addHook("preHandler", requireAdminAuth);
  await registerAdminRoutes(adminApp);
});
await app.register(registerTranscodeRoutes);
await app.register(registerTranscodeVodRoutes);

app.get("/health", async () => ({ status: "ok" }));

app.get("/manifest.json", async () => getAddonManifest());

app.get<{
  Params: { type: "movie" | "series"; id: string; extra?: string };
}>(["/catalog/:type/:id.json", "/catalog/:type/:id/:extra.json"], async (request, reply) => {
  const params = z.object({
    type: z.enum(["movie", "series"]),
    id: z.string().min(1),
    extra: z.string().optional()
  }).safeParse(request.params);

  if (!params.success) {
    reply.code(400);
    return { metas: [] };
  }

  const library = getLibraryForCatalog(params.data.type, params.data.id);
  if (!library) {
    return { metas: [] };
  }

  const page = parseCatalogPage(params.data.extra);
  const cached = getCachedLibraryItems(library.id, page);
  if (cached) {
    return { metas: cached };
  }

  const metas = await fetchTmdbCatalog(library, page);
  saveLibraryItems(library.id, page, metas);
  return { metas };
});

app.get<{
  Params: { type: "movie" | "series"; id: string };
}>("/stream/:type/:id.json", async (request, reply) => {
  const params = z.object({
    type: z.enum(["movie", "series"]),
    id: z.string().min(1)
  }).safeParse(request.params);

  if (!params.success) {
    reply.code(400);
    return { streams: [] };
  }

  const bestOriginal = await findBestValidatedStream(params.data.type, params.data.id);
  const requestBaseUrl = getEffectivePublicBaseUrl() ?? `${request.protocol}://${request.hostname}`;

  return {
    streams: createVisibleStreamOptions(bestOriginal, requestBaseUrl)
  };
});

app.get<{ Params: { streamId: string } }>("/proxy/original/:streamId", async (request, reply) => {
  const original = getSelectedOriginal(request.params.streamId);
  if (!original?.originalUrl) {
    reply.code(404);
    return { error: "Selected original stream was not found or has expired." };
  }

  reply.redirect(original.originalUrl);
});

function parseCatalogPage(extra?: string): number {
  if (!extra) return 1;
  const match = extra.match(/(?:^|&)skip=(\d+)/);
  const skip = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  if (!Number.isFinite(skip) || skip <= 0) return 1;
  return Math.floor(skip / 30) + 1;
}

await app.listen({ host: env.HOST, port: env.PORT });
