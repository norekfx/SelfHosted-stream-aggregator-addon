import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { addonManifest } from "./stremio/manifest.js";
import { createVisibleStreamOptions } from "./streams/quality-options.js";
import { findBestValidatedStream } from "./streams/mock-aggregator.js";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(7000),
  PUBLIC_BASE_URL: z.string().url().optional()
});

const env = envSchema.parse(process.env);
const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" }
  }
});

await app.register(cors, { origin: true });

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
