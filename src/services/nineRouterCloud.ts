import { getGilbertFirebaseAuth } from "../firebase";

const LOCAL_NINE_ROUTER_DASHBOARD_URL = "http://127.0.0.1:20128";
const LOCAL_NINE_ROUTER_BASE_URL = `${LOCAL_NINE_ROUTER_DASHBOARD_URL}/v1`;

const NINE_ROUTER_BASE_URL_ENV_KEY = "VITE_GILBERT_NINE_ROUTER_BASE_URL";
const NINE_ROUTER_DASHBOARD_URL_ENV_KEY = "VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL";
const NINE_ROUTER_MODE_ENV_KEY = "VITE_GILBERT_NINE_ROUTER_MODE";
const NINE_ROUTER_REQUIRE_CLOUD_ENV_KEY = "VITE_GILBERT_REQUIRE_CLOUD_SUBSCRIPTIONS";
export const NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER = "X-Gilbert-Firebase-ID-Token";

export function getConfiguredNineRouterBaseUrl(fallback = LOCAL_NINE_ROUTER_BASE_URL) {
  const configuredBaseUrl = readViteEnv(NINE_ROUTER_BASE_URL_ENV_KEY);
  const configuredDashboardUrl = readViteEnv(NINE_ROUTER_DASHBOARD_URL_ENV_KEY);

  return normalizeNineRouterBaseUrl(configuredBaseUrl || configuredDashboardUrl, fallback);
}

export function getConfiguredNineRouterDashboardUrl(fallback = LOCAL_NINE_ROUTER_DASHBOARD_URL) {
  const configuredDashboardUrl = readViteEnv(NINE_ROUTER_DASHBOARD_URL_ENV_KEY);
  const configuredBaseUrl = readViteEnv(NINE_ROUTER_BASE_URL_ENV_KEY);

  return normalizeNineRouterDashboardUrl(configuredDashboardUrl || configuredBaseUrl, fallback);
}

export function isConfiguredNineRouterCloudEnabled() {
  return !isNineRouterNativeBridgeUrl(getConfiguredNineRouterDashboardUrl());
}

export function isNineRouterCloudRequired() {
  const mode = readViteEnv(NINE_ROUTER_MODE_ENV_KEY).toLowerCase();
  const required = readViteEnv(NINE_ROUTER_REQUIRE_CLOUD_ENV_KEY).toLowerCase();

  return mode === "cloud" || required === "true" || required === "1" || required === "yes";
}

export async function withNineRouterCloudAuthHeaders(rawUrl: string, init: RequestInit) {
  if (isNineRouterNativeBridgeUrl(rawUrl)) {
    return init;
  }

  const user = getGilbertFirebaseAuth().currentUser;
  const token = user ? await user.getIdToken().catch(() => "") : "";
  if (!token) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set(NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER, token);

  return {
    ...init,
    headers,
  };
}

export function isNineRouterNativeBridgeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" || url.port !== "20128") {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || isPrivateIpv4(host);
  } catch {
    return false;
  }
}

export function normalizeNineRouterBaseUrl(value: string | undefined, fallback = LOCAL_NINE_ROUTER_BASE_URL) {
  const normalizedUrl = normalizeHttpUrl(value);

  if (!normalizedUrl) {
    return fallback;
  }

  return normalizedUrl.endsWith("/v1") ? normalizedUrl : `${normalizedUrl}/v1`;
}

export function normalizeNineRouterDashboardUrl(value: string | undefined, fallback = LOCAL_NINE_ROUTER_DASHBOARD_URL) {
  const normalizedUrl = normalizeHttpUrl(value);

  if (!normalizedUrl) {
    return fallback;
  }

  return normalizedUrl.endsWith("/v1") ? normalizedUrl.slice(0, -3) : normalizedUrl;
}

function normalizeHttpUrl(value: string | undefined) {
  const rawValue = value?.trim();

  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");

    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readViteEnv(key: string) {
  return (import.meta.env as Record<string, string | undefined>)[key]?.trim() ?? "";
}

function isPrivateIpv4(host: string) {
  const parts = host.split(".");

  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}
