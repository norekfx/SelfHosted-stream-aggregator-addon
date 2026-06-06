import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { env } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { addonManifest } from "./stremio/manifest.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";

runMigrations(getDatabase());

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  }
});

await app.register(cors, { origin: true });
await app.register(registerAdminRoutes);

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

app.get("/proxy/original/:streamId", async (_request, reply) => {
  reply.code(501);
  return { error: "Original stream proxy is not implemented yet." };
});

app.get("/transcode/:streamId/:quality/master.m3u8", async (_request, reply) => {
  reply.code(501);
  return { error: "Transcoding is not implemented yet." };
});

await app.listen({ host: env.HOST, port: env.PORT });
