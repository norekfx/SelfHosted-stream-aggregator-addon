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
import { applyPersistedDocchiMappingsToMeta, listDocchiEpisodeMappingsForSeries } from "./docchi/docchi-episode-mapping-store.js";
import { findDocchiEpisodeFix } from "./docchi/docchi-public-mapper.js";
import { getCachedLibraryItems, getCachedMeta, saveLibraryItems, saveMeta, shouldBypassMetadataCache } from "./libraries/library-cache.js";
import { getLibraryForCatalog } from "./libraries/library-registry.js";
import { getEffectivePublicBaseUrl } from "./settings/app-settings.js";
import { getAddonManifest } from "./stremio/manifest.js";
import { toStremioSubtitleResponse, getSubtitleCache } from "./subtitles/subtitle-cache.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";
import { getSelectedOriginal } from "./streams/original-store.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { fetchTmdbCatalog, fetchTmdbMeta } from "./tmdb/tmdb-client.js";
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
  const [mainScript, addonDeleteHelper, libraryEpisodeIdHelper, docchiPublicMappingHelper, docchiDebugExportHelper] = await Promise.all([
    readFile(join(publicDir, "app.js"), "utf-8"),
    readFile(join(publicDir, "addon-delete-helper.js"), "utf-8").catch(() => ""),
    readFile(join(publicDir, "library-episode-id-helper.js"), "utf-8").catch(() => ""),
    readFile(join(publicDir, "docchi-public-mapping-helper.js"), "utf-8").catch(() => ""),
    readFile(join(publicDir, "docchi-debug-export-helper.js"), "utf-8").catch(() => "")
  ]);
  reply.header("cache-control", "no-store, max-age=0");
  reply.type("application/javascript; charset=utf-8");
  return `${mainScript}\n\n${addonDeleteHelper}\n\n${libraryEpisodeIdHelper}\n\n${docchiPublicMappingHelper}\n\n${docchiDebugExportHelper}`;
});
await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
await app.register(registerAuthRoutes);
await app.register(async (adminApp) => {
  adminApp.addHook("preHandler", requireAdminAuth);
  await registerAdminRoutes(adminApp);
  adminApp.get<{ Params: { id: string } }>("/admin/docchi/episode/:id", async (request, reply) => {
    const params = z.object({ id: z.string().regex(/^tt\d+:\d+:\d+$/i) }).safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid episode id." };
    }
    return { fix: await findDocchiEpisodeFix(params.data.id) };
  });
  adminApp.get<{ Params: { id: string } }>("/admin/docchi/series/:id/status", async (request, reply) => {
    const params = z.object({ id: z.string().regex(/^tt\d+$/i) }).safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid series id." };
    }
    const mappings = listDocchiEpisodeMappingsForSeries(params.data.id);
    const mappedSeasons = Array.from(new Set(mappings.map((mapping) => mapping.mappedSeason))).sort((a, b) => a - b);
    const latestUpdatedAt = mappings.map((mapping) => mapping.updatedAt).sort().at(-1);
    return { seriesId: params.data.id, fixed: mappings.length > 0, mappedCount: mappings.length, mappedSeasons, latestUpdatedAt };
  });
});
await app.register(registerTranscodeRoutes);
await app.register(registerTranscodeVodRoutes);

app.get("/health", async () => ({ status: "ok" }));
app.get("/manifest.json", async () => getAddonManifest());

app.get<{ Params: { type: "movie" | "series"; id: string } }>("/catalog/:type/:id.json", async (request, reply) => handleCatalogRequest(request.params, reply));
app.get<{ Params: { type: "movie" | "series"; id: string; extra: string } }>("/catalog/:type/:id/:extra.json", async (request, reply) => handleCatalogRequest(request.params, reply));

app.get<{ Params: { type: "movie" | "series"; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
  const params = z.object({ type: z.enum(["movie", "series"]), id: z.string().regex(/^tt\d+/i) }).safeParse(request.params);
  if (!params.success) { reply.code(400); return { meta: null }; }
  if (!shouldBypassMetadataCache()) {
    const cached = getCachedMeta(params.data.type, params.data.id);
    if (cached) return { meta: cached };
  }
  const meta = await fetchTmdbMeta(params.data.type, params.data.id);
  if (!meta) return { meta: null };
  const mappedMeta = applyPersistedDocchiMappingsToMeta(meta);
  if (!shouldBypassMetadataCache()) saveMeta(params.data.type, params.data.id, mappedMeta);
  return { meta: mappedMeta };
});

app.get<{ Params: { type: "movie" | "series"; id: string } }>("/subtitles/:type/:id.json", async (request, reply) => {
  const params = z.object({ type: z.enum(["movie", "series"]), id: z.string().min(1) }).safeParse(request.params);
  if (!params.success) { reply.code(400); return { subtitles: [] }; }
  return toStremioSubtitleResponse(getSubtitleCache(params.data.type, params.data.id));
});

app.get<{ Params: { type: "movie" | "series"; id: string } }>("/stream/:type/:id.json", async (request, reply) => {
  const params = z.object({ type: z.enum(["movie", "series"]), id: z.string().min(1) }).safeParse(request.params);
  if (!params.success) { reply.code(400); return { streams: [] }; }
  const bestOriginal = await findBestValidatedStream(params.data.type, params.data.id);
  const requestBaseUrl = getEffectivePublicBaseUrl() ?? `${request.protocol}://${request.hostname}`;
  return { streams: createVisibleStreamOptions(bestOriginal, requestBaseUrl) };
});

app.get<{ Params: { streamId: string } }>("/proxy/original/:streamId", async (request, reply) => {
  const original = getSelectedOriginal(request.params.streamId);
  if (!original?.originalUrl) { reply.code(404); return { error: "Selected original stream was not found or has expired." }; }
  reply.redirect(original.originalUrl);
});

async function handleCatalogRequest(rawParams: unknown, reply: { code: (statusCode: number) => unknown }) {
  const params = z.object({ type: z.enum(["movie", "series"]), id: z.string().min(1), extra: z.string().optional() }).safeParse(rawParams);
  if (!params.success) { reply.code(400); return { metas: [] }; }
  const library = getLibraryForCatalog(params.data.type, params.data.id);
  if (!library) return { metas: [] };
  const page = parseCatalogPage(params.data.extra);
  const cached = shouldBypassMetadataCache() ? undefined : getCachedLibraryItems(library.id, page);
  if (cached) return { metas: cached };
  const metas = await fetchTmdbCatalog(library, page);
  if (!shouldBypassMetadataCache()) saveLibraryItems(library.id, page, metas);
  return { metas };
}

function parseCatalogPage(extra?: string): number {
  if (!extra) return 1;
  const match = extra.match(/(?:^|&)skip=(\d+)/);
  const skip = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  if (!Number.isFinite(skip) || skip <= 0) return 1;
  return Math.floor(skip / 30) + 1;
}

await app.listen({ host: env.HOST, port: env.PORT });
