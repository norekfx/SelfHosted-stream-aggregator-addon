import type { AggregatedStream, StreamType } from "./types.js";

/**
 * Temporary placeholder until addon registry + real aggregation is implemented.
 * Keeps the Stremio endpoint functional and testable without returning dead links.
 */
export async function findBestValidatedStream(_type: StreamType, _id: string): Promise<AggregatedStream | null> {
  return null;
}
