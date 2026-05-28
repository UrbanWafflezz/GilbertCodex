# Gilbert 9Router Gateway

This Cloud Run service is the first cloud replacement for the local desktop 9Router process.

What it does:

- Verifies every app request with Firebase Admin.
- Uses the decoded Firebase `uid` as the tenant key.
- Starts an internal 9Router process per tenant.
- Gives each tenant its own `DATA_DIR`.
- Proxies `/v1/*` model traffic and `/api/*` subscription setup traffic to that tenant runtime.
- Exposes `/auth/callback` so Codex/xAI fixed-port OAuth callbacks can complete through the cloud gateway.

The public Cloud Run service can be unauthenticated at Google IAM level because this gateway performs Firebase Auth itself. Do not remove the Firebase token check.

## Local Checks

```bash
npm --prefix cloud/nine-router-gateway run check
```

## Build

```bash
docker build cloud/nine-router-gateway -t gilbert-nine-router-gateway
```

The Dockerfile clones and builds upstream `decolua/9router` into the image.

## Deploy

```bash
gcloud run deploy gilbert-nine-router-gateway \
  --source cloud/nine-router-gateway \
  --region us-central1 \
  --project gilbertcodex-40428 \
  --allow-unauthenticated \
  --min-instances=1 \
  --concurrency=10 \
  --timeout=3600 \
  --set-env-vars FIREBASE_PROJECT_ID=gilbertcodex-40428,GILBERT_PUBLIC_BASE_URL=https://YOUR-SERVICE-URL
```

After deploy, set the private app build to:

```bash
VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL=https://YOUR-SERVICE-URL
VITE_GILBERT_NINE_ROUTER_BASE_URL=https://YOUR-SERVICE-URL/v1
```

## Persistent Tenant Data

Tenant data is stored under `GILBERT_NINE_ROUTER_TENANT_DATA_ROOT`, defaulting to `/data/tenants`.

For production, mount durable Cloud Run storage at `/data` before allowing paid users to rely on this. Without a durable mount, Cloud Run instance restarts can remove OAuth tokens and usage data.

## Current Limits

- Codex and xAI OAuth use fixed callback ports inside upstream 9Router. This gateway maps public `/auth/callback` back to the active tenant session, but heavy concurrent sign-in should be tested before launch.
- The 9Router dashboard UI is not exposed by default because browser navigation will not carry the app's Firebase ID token. The app uses authenticated API calls instead.
- This is a tenant-isolated runtime gateway, not a fork of upstream 9Router's storage layer. A future production hardening pass should move provider credentials into a first-party encrypted store.
