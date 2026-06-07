export type StreamValidationStatus = "pending" | "working" | "failed" | "unsupported";

export type StreamValidationMethod = "HEAD" | "RANGE_GET" | "FFPROBE" | "SKIPPED" | "NOT_CHECKED";

export type StreamValidationResult = {
  status: StreamValidationStatus;
  method: StreamValidationMethod;
  checkedAt: string;
  responseTimeMs?: number;
  httpStatus?: number;
  contentType?: string;
  contentLength?: number;
  acceptsRanges?: boolean;
  finalUrl?: string;
  durationSeconds?: number;
  reason?: string;
};

export type StreamValidationInput = {
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  rawText?: string;
  declaredSize?: string;
  isDebrid?: boolean;
};

export function notChecked(reason = "Link validation skipped by current validation mode."): StreamValidationResult {
  return {
    status: "pending",
    method: "NOT_CHECKED",
    checkedAt: new Date().toISOString(),
    reason
  };
}
