import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { addonManifest } from "./stremio/manifest.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";
import { getSelectedOriginal } from "./streams/original-store.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { registerTranscodeRoutes } from "./transcoding/transcode-routes.js";

runMigrations(getDatabase());

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  }
});

await app.register(cors, { origin: true });
await app.register(registerAdminRoutes);
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
  const requestBaseUrl = env.PUBLIC_BASE_URL ?? `${request.protocol}://${request.hostname}`;

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
