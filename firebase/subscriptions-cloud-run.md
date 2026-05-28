# Cloud Subscription Router

Gilbert can point at a cloud-hosted subscription router by setting:

```bash
VITE_GILBERT_NINE_ROUTER_DASHBOARD_URL=https://your-router-service.run.app
VITE_GILBERT_NINE_ROUTER_BASE_URL=https://your-router-service.run.app/v1
```

When those values are present, the desktop app skips the local 9Router bootstrap, calls the HTTPS router directly, and includes the signed-in Firebase user token in `X-Gilbert-Firebase-ID-Token` on cloud router requests.

## Recommended Runtime

Use Cloud Run for the router service. 9Router is a long-running Next/container service with streaming model requests, OAuth callback flows, and persistent state. That shape fits Cloud Run better than Firebase Functions. Official references:

- Cloud Run can run containerized services and supports streaming/WebSocket-style long-lived requests: https://cloud.google.com/run/docs
- Cloud Run minimum instances keep services warm for paid users: https://cloud.google.com/run/docs/configuring/min-instances
- Firebase Hosting can rewrite HTTPS traffic to Cloud Run if we want a Firebase-hosted domain in front: https://firebase.google.com/docs/hosting/cloud-run
- A custom backend should verify Firebase ID tokens and use the decoded `uid` as the tenant key: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Firebase Functions are useful for serverless jobs, but HTTP functions still have function-timeout limits and are not the right home for a full router process: https://firebase.google.com/docs/functions/version-comparison

Firebase stays responsible for:

- Auth accounts and Firebase ID tokens.
- Firestore user profile, app storage, billing plan, and per-account settings.
- Storage rules for user-owned files.

Cloud Run stays responsible for:

- Running the router container.
- Validating `X-Gilbert-Firebase-ID-Token` with Firebase Admin before touching subscription accounts.
- Routing every request through a tenant boundary keyed by `uid`.

## Production Boundary

Do not expose one shared upstream 9Router database as the production paid-router backend. Upstream 9Router is local/single-tenant by design, so a shared public instance would mix users unless we add a Firebase-aware gateway or fork.

For the first private product build, use one of these modes:

- Admin-only proof of concept: one Cloud Run 9Router instance, locked down to a single internal account.
- Production path: a Gilbert router gateway/fork that verifies Firebase ID tokens, maps every request to `uid`, and stores provider credentials in a tenant-scoped encrypted store.

## First Deployment Shape

1. Build or deploy `cloud/nine-router-gateway` to Cloud Run.
2. Set Cloud Run minimum instances to keep the gateway warm for paid users.
3. Mount durable storage at `/data` before relying on saved provider OAuth tokens in production.
4. Keep the Cloud Run service public at IAM level, but require Firebase ID tokens inside the gateway.
5. The gateway rejects requests without a valid Firebase ID token.
6. The gateway hashes the Firebase `uid`, starts a separate internal 9Router runtime, and assigns that runtime its own `DATA_DIR`.
7. Add the Cloud Run dashboard/base URLs to the private app build environment.

Useful commands:

```bash
npm run cloud:9router:check
npm run cloud:9router:build
npm run cloud:9router:deploy
```

## Local Fallback

If the cloud router env vars are absent, Gilbert keeps the existing local routing path:

- Desktop starts `127.0.0.1:20128`.
- Native bridge is used only for local/private `http://*:20128` URLs.
- Local 9Router data remains account-scoped by the signed-in Firebase UID.
