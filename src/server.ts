import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { registerAuthRoutes, requireAdminAuth } from "./auth/auth-routes.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { getEffectivePublicBaseUrl } from "./settings/app-settings.js";
import { addonManifest } from "./stremio/manifest.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";
import { getSelectedOriginal } from "./streams/original-store.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { registerTranscodeRoutes } from "./transcoding/transcode-routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");

runMigrations(getDatabase());

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  }
});

await app.register(cors, { origin: true });
await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
await app.register(registerAuthRoutes);
await app.register(registerAdminRoutes, { prefix: "", preHandler: requireAdminAuth });
await app.register(registerTranscodeRoutes);

app.get("/health", async () => ({ status: "ok" }));

app.get("/manifest.json", async () => addonManifest);

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

await app.listen({ host: env.HOST, port: env.PORT });
