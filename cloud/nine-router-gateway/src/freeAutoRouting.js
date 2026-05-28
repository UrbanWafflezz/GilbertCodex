import { NINE_ROUTER_CLI_TOKEN_HEADER } from "./headers.js";

export const NINE_ROUTER_ALWAYS_FREE_MODEL = "gilbert-always-free";
export const NINE_ROUTER_SMART_SAVER_MODEL = "gilbert-smart-saver";
const LEGACY_FREE_AUTO_MODELS = new Set(["free-combo", NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_SMART_SAVER_MODEL]);
const OPEN_CODE_FREE_MODELS = [
  "oc/deepseek-v4-flash-free",
  "oc/minimax-m2.5-free",
  "oc/qwen3.6-plus-free",
  "oc/mimo-v2.5-free",
  "oc/nemotron-3-super-free",
  "oc/big-pickle",
];
const OPEN_CODE_FREE_MODEL_SET = new Set(OPEN_CODE_FREE_MODELS);

export function readJsonBody(body) {
  if (!body) {
    return null;
  }

  try {
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    const payload = JSON.parse(text);
    return typeof payload === "object" && payload ? payload : null;
  } catch {
    return null;
  }
}

export function readRequestModel(body) {
  const payload = readJsonBody(body);
  const model = payload && typeof payload.model === "string" ? payload.model.trim() : "";

  return model || NINE_ROUTER_ALWAYS_FREE_MODEL;
}

export function isFreeAutoModel(model) {
  return LEGACY_FREE_AUTO_MODELS.has(String(model || "").trim().toLowerCase());
}

export function isFreeTierNineRouterModel(model) {
  const normalizedModel = String(model || "").trim().toLowerCase();

  return (
    isFreeAutoModel(normalizedModel) ||
    isOpenCodeFreeModel(normalizedModel) ||
    normalizedModel.startsWith("free/") ||
    normalizedModel.startsWith("freetheai/")
  );
}

export function isAllowedFreeTierComboMutation(method, pathname, body) {
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (!["POST", "PUT", "PATCH"].includes(normalizedMethod) || !/^\/api\/combos(?:\/|$)/.test(pathname)) {
    return false;
  }

  const payload = readJsonBody(body);
  if (!payload || !isManagedFreeAutoComboName(payload.name)) {
    return false;
  }

  const kind = typeof payload.kind === "string" ? payload.kind.trim().toLowerCase() : "fallback";
  const models = readComboModels(payload);

  return kind === "fallback" && models.length > 0 && models.length <= OPEN_CODE_FREE_MODELS.length && models.every(isSupportedOpenCodeFreeModel);
}

export function shouldEnsureManagedFreeAutoRoute(tier, method, pathname, body) {
  const normalizedMethod = String(method || "GET").toUpperCase();

  return tier === "free" &&
    normalizedMethod === "POST" &&
    (pathname === "/v1/chat/completions" || pathname === "/v1/completions" || pathname === "/v1/responses") &&
    isFreeAutoModel(readRequestModel(body));
}

export async function ensureManagedFreeAutoRoute(runtime) {
  const combos = await fetchRuntimeJson(runtime, "/api/combos", { method: "GET" });
  const existing = findManagedFreeAutoCombo(normalizeCombosPayload(combos));
  const installedModels = readComboModels(existing);

  if (installedModels.length > 0 && installedModels.every(isSupportedOpenCodeFreeModel)) {
    return { changed: false, models: installedModels };
  }

  const path = existing?.id ? `/api/combos/${encodeURIComponent(existing.id)}` : "/api/combos";
  const method = existing?.id ? "PUT" : "POST";
  const updated = await fetchRuntimeJson(runtime, path, {
    body: JSON.stringify({
      kind: "fallback",
      models: OPEN_CODE_FREE_MODELS,
      name: NINE_ROUTER_ALWAYS_FREE_MODEL,
    }),
    headers: {
      "content-type": "application/json",
    },
    method,
  });

  return { changed: true, combo: updated, models: OPEN_CODE_FREE_MODELS };
}

function normalizeCombosPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isComboLike);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const combos = Array.isArray(payload.combos) ? payload.combos : Array.isArray(payload.data) ? payload.data : [];
  return combos.filter(isComboLike);
}

function findManagedFreeAutoCombo(combos) {
  return combos.find((combo) => isManagedFreeAutoComboName(combo.name) || isManagedFreeAutoComboName(combo.id)) ?? null;
}

function isComboLike(value) {
  return typeof value === "object" && value !== null && (typeof value.name === "string" || typeof value.id === "string");
}

function readComboModels(combo) {
  if (!combo || typeof combo !== "object") {
    return [];
  }

  const models = Array.isArray(combo.models) ? combo.models : Array.isArray(combo.modelIds) ? combo.modelIds : [];
  const seen = new Set();

  return models.flatMap((model) => {
    if (typeof model !== "string") {
      return [];
    }

    const normalizedModel = model.trim().toLowerCase();
    if (!normalizedModel || seen.has(normalizedModel)) {
      return [];
    }

    seen.add(normalizedModel);
    return [normalizedModel];
  });
}

async function fetchRuntimeJson(runtime, path, init) {
  const headers = new Headers(init.headers || {});
  headers.set(NINE_ROUTER_CLI_TOKEN_HEADER, runtime.cliToken);

  const response = await fetch(`${runtime.baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = parseJsonText(text);

  if (!response.ok) {
    const error = new Error(readErrorMessage(payload) || `9Router Free Auto repair failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function parseJsonText(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function readErrorMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (payload.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  return "";
}

function isManagedFreeAutoComboName(value) {
  return String(value || "").trim().toLowerCase() === NINE_ROUTER_ALWAYS_FREE_MODEL;
}

function isOpenCodeFreeModel(model) {
  return String(model || "").trim().toLowerCase().startsWith("oc/");
}

function isSupportedOpenCodeFreeModel(model) {
  return OPEN_CODE_FREE_MODEL_SET.has(String(model || "").trim().toLowerCase());
}
