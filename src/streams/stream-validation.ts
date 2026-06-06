export type StreamValidationStatus = "pending" | "working" | "failed" | "unsupported";

export type StreamValidationMethod = "HEAD" | "RANGE_GET" | "SKIPPED";

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
  reason?: string;
};

export type StreamValidationInput = {
  url?: string;
  externalUrl?: string;
  infoHash?: string;
};
