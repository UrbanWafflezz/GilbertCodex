import { getGilbertFirebaseAuth } from "../firebase";
import { normalizeBillingPlanSettings } from "../lib/subscriptionTiers";
import type { BillingPlanSettings, BillingTierId } from "../types/settings";

const BILLING_API_URL_ENV_KEY = "VITE_GILBERT_BILLING_API_URL";
const FIREBASE_ID_TOKEN_HEADER = "X-Gilbert-Firebase-ID-Token";

export interface BillingGatewayStatus {
  billingCustomer: {
    latestSubscription?: unknown;
    stripeCustomerId?: string;
  } | null;
  billingPlan: BillingPlanSettings;
  prices: {
    plus: string;
    pro: string;
  };
}

export interface BillingGatewaySession {
  id: string;
  trialDays?: number;
  url: string;
}

export function getConfiguredBillingApiUrl() {
  return normalizeHttpUrl(readViteEnv(BILLING_API_URL_ENV_KEY));
}

export function isBillingGatewayConfigured() {
  return Boolean(getConfiguredBillingApiUrl());
}

export async function getBillingStatus(): Promise<BillingGatewayStatus> {
  const payload = await requestBillingJson<BillingGatewayStatus>("/api/billing/status", {
    method: "GET",
  });

  return {
    ...payload,
    billingPlan: normalizeBillingPlanSettings(payload.billingPlan),
  };
}

export async function createBillingCheckoutSession(tier: Exclude<BillingTierId, "free" | "teams">): Promise<BillingGatewaySession> {
  return requestBillingJson<BillingGatewaySession>("/api/billing/checkout", {
    body: JSON.stringify({ tier }),
    method: "POST",
  });
}

export async function createBillingPortalSession(): Promise<BillingGatewaySession> {
  return requestBillingJson<BillingGatewaySession>("/api/billing/portal", {
    method: "POST",
  });
}

async function requestBillingJson<T>(path: string, init: RequestInit): Promise<T> {
  const baseUrl = getConfiguredBillingApiUrl();
  if (!baseUrl) {
    throw new Error("Billing is not configured for this build.");
  }

  const token = await getFirebaseIdToken();
  const headers = new Headers(init.headers);
  headers.set(FIREBASE_ID_TOKEN_HEADER, token);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };

  if (!response.ok) {
    throw new Error(formatBillingGatewayError(payload.error, response.status));
  }

  return payload as T;
}

async function getFirebaseIdToken() {
  const user = getGilbertFirebaseAuth().currentUser;
  if (!user) {
    throw new Error("Sign in to manage billing.");
  }

  const token = await user.getIdToken().catch(() => "");
  if (!token) {
    throw new Error("Could not verify your signed-in account.");
  }

  return token;
}

function normalizeHttpUrl(value: string | undefined) {
  const rawValue = value?.trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
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

function formatBillingGatewayError(error: string | undefined, status: number) {
  const message = error?.trim();
  if (message?.includes("STRIPE_CONTEXT") || message?.includes("live Stripe account ID")) {
    return "Billing is waiting for the live Stripe account ID. Add the matching acct_... account to the billing gateway, then try again.";
  }

  return message || `Billing request failed with HTTP ${status}.`;
}
