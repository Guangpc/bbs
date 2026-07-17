export interface ShareInboxItemV1 {
  schemaVersion: 1;
  ingestId: string;
  receivedAt: number;
  rawText: string | null;
  urls: string[];
  sourceBundleId: string | null;
}

export function validateInboxItem(value: unknown): ShareInboxItemV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Inbox item must be an object");
  }

  const item = value as Record<string, unknown>;

  if (item.schemaVersion !== 1) {
    throw new Error("Unsupported schemaVersion");
  }

  if (typeof item.ingestId !== "string" || item.ingestId.length === 0) {
    throw new Error("ingestId is required");
  }

  if (typeof item.receivedAt !== "number" || !Number.isFinite(item.receivedAt)) {
    throw new Error("receivedAt must be a number");
  }

  // Swift JSONSerialization omits nil keys; treat missing as null.
  const rawText =
    item.rawText === undefined || item.rawText === null
      ? null
      : typeof item.rawText === "string"
        ? item.rawText
        : (() => {
            throw new Error("rawText must be a string or null");
          })();

  const urls = item.urls === undefined ? [] : item.urls;
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) {
    throw new Error("urls must be a string array");
  }

  const sourceBundleId =
    item.sourceBundleId === undefined || item.sourceBundleId === null
      ? null
      : typeof item.sourceBundleId === "string"
        ? item.sourceBundleId
        : (() => {
            throw new Error("sourceBundleId must be a string or null");
          })();

  return {
    schemaVersion: 1,
    ingestId: item.ingestId,
    receivedAt: item.receivedAt,
    rawText,
    urls,
    sourceBundleId,
  };
}
