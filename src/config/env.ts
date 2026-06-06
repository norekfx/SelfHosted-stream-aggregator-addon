import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(7000),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DATA_DIR: z.string().default("/data"),
  DATABASE_PATH: z.string().optional(),
  STREAM_VALIDATION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000)
});

export const env = envSchema.parse(process.env);

export function getDatabasePath(): string {
  return env.DATABASE_PATH ?? `${env.DATA_DIR.replace(/\/$/, "")}/db/aggregator.sqlite`;
}
