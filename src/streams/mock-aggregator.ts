import { aggregateStreams } from "./aggregation.js";
import type { AggregatedStream, StreamType } from "./types.js";

/**
 * Runs real aggregation but still refuses to expose streams to Stremio until
 * validation, ranking and transcoding readiness checks are implemented.
 */
export async function findBestValidatedStream(type: StreamType, id: string): Promise<AggregatedStream | null> {
  await aggregateStreams(type, id);
  return null;
}
