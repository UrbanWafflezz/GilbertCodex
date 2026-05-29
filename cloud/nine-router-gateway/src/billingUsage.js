import { readJsonBody } from "./freeAutoRouting.js";

export function isBillableImageRequest(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  return normalizedMethod === "POST" && pathname === "/v1/images/generations";
}

export function estimateImageGenerations(body) {
  const payload = readJsonBody(body);
  const value = payload?.n ?? payload?.count ?? payload?.imageCount;
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && /^[-+]?\d+$/.test(value.trim())
      ? Number(value.trim())
      : 1;

  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 1;
}

export function normalizeUsageAmount(value) {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}
