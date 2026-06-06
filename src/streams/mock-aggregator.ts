import { getBestOriginalWithCache } from "../search/cached-selection.js";
import type { AggregatedStream, StreamType } from "./types.js";

/**
 * Returns the best validated Original.
 * If a previous working result exists in SQLite, it is returned immediately
 * and refreshed in the background. If no cache exists, this waits for a full refresh.
 */
export async function findBestValidatedStream(type: StreamType, id: string): Promise<AggregatedStream | null> {
  return getBestOriginalWithCache(type, id);
}
