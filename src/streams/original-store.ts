import type { AggregatedStream } from "./types.js";

const originals = new Map<string, AggregatedStream>();

export function saveSelectedOriginal(stream: AggregatedStream): void {
  originals.set(stream.id, stream);
}

export function getSelectedOriginal(streamId: string): AggregatedStream | undefined {
  return originals.get(streamId);
}
