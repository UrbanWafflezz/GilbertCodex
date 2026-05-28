import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredNineRouterBaseUrl,
  getConfiguredNineRouterDashboardUrl,
  isConfiguredNineRouterCloudEnabled,
  isNineRouterCloudRequired,
  isNineRouterNativeBridgeUrl,
  NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER,
  normalizeNineRouterBaseUrl,
  normalizeNineRouterDashboardUrl,
  withNineRouterCloudAuthHeaders,
} from "./nineRouterCloud";

vi.mock("../firebase", () => ({
  getGilbertFirebaseAuth: () => ({
    currentUser: {
      getIdToken: vi.fn(async () => "firebase-id-token"),
    },
  }),
}));

beforeEach(() => {
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_BASE_URL", "");
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL", "");
  vi.stubEnv("VITE_GILBERT_NINE_ROUTER_MODE", "");
  vi.stubEnv("VITE_GILBERT_REQUIRE_CLOUD_SUBSCRIPTIONS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("nineRouterCloud", () => {
  it("normalizes dashboard and OpenAI-compatible base URLs", () => {
    expect(normalizeNineRouterBaseUrl("https://router.example.com/subscriptions/")).toBe("https://router.example.com/subscriptions/v1");
    expect(normalizeNineRouterBaseUrl("https://router.example.com/subscriptions/v1/")).toBe("https://router.example.com/subscriptions/v1");
    expect(normalizeNineRouterDashboardUrl("https://router.example.com/subscriptions/v1/")).toBe("https://router.example.com/subscriptions");
    expect(normalizeNineRouterDashboardUrl("ftp://router.example.com")).toBe("http://127.0.0.1:20128");
  });

  it("reads cloud endpoint configuration from Vite env", () => {
    vi.stubEnv("VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL", "https://router.example.com/gilbert/");

    expect(getConfiguredNineRouterDashboardUrl()).toBe("https://router.example.com/gilbert");
    expect(getConfiguredNineRouterBaseUrl()).toBe("https://router.example.com/gilbert/v1");
    expect(isConfiguredNineRouterCloudEnabled()).toBe(true);
  });

  it("allows official builds to require cloud subscription routing", () => {
    expect(isNineRouterCloudRequired()).toBe(false);

    vi.stubEnv("VITE_GILBERT_NINE_ROUTER_MODE", "cloud");
    expect(isNineRouterCloudRequired()).toBe(true);

    vi.unstubAllEnvs();
    vi.stubEnv("VITE_GILBERT_REQUIRE_CLOUD_SUBSCRIPTIONS", "true");
    expect(isNineRouterCloudRequired()).toBe(true);
  });

  it("only uses the native bridge for local or private 9Router ports", () => {
    expect(isNineRouterNativeBridgeUrl("http://127.0.0.1:20128/v1/chat/completions")).toBe(true);
    expect(isNineRouterNativeBridgeUrl("http://localhost:20128/api/settings")).toBe(true);
    expect(isNineRouterNativeBridgeUrl("http://192.168.1.20:20128/v1")).toBe(true);
    expect(isNineRouterNativeBridgeUrl("https://router.example.com/v1")).toBe(false);
    expect(isNineRouterNativeBridgeUrl("http://203.0.113.5:20128/v1")).toBe(false);
    expect(isNineRouterNativeBridgeUrl("http://127.0.0.1:8080/v1")).toBe(false);
  });

  it("adds Firebase identity only for cloud router calls", async () => {
    const cloudInit = await withNineRouterCloudAuthHeaders("https://router.example.com/v1/models", {
      headers: {
        Authorization: "Bearer local-api-token",
      },
      method: "GET",
    });
    const localInit = await withNineRouterCloudAuthHeaders("http://127.0.0.1:20128/v1/models", {
      method: "GET",
    });

    expect(new Headers(cloudInit.headers).get(NINE_ROUTER_FIREBASE_ID_TOKEN_HEADER)).toBe("firebase-id-token");
    expect(new Headers(cloudInit.headers).get("Authorization")).toBe("Bearer local-api-token");
    expect(localInit.headers).toBeUndefined();
  });
});
