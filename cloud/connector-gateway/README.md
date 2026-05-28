# Cloud Connectors

This gateway runs GitHub, Google, and Discord as hosted Cloud Run connectors for Gilbert Codex.

Deploy the same image as three separate Cloud Run services:

- `gilbert-github-connector` with `GILBERT_CONNECTOR_SERVICE=github`
- `gilbert-google-connector` with `GILBERT_CONNECTOR_SERVICE=google`
- `gilbert-discord-connector` with `GILBERT_CONNECTOR_SERVICE=discord`

Each service verifies the signed-in Firebase user with `X-Gilbert-Firebase-ID-Token`, stores OAuth tokens in server-only Firestore collections, and exposes only account state/API calls through the gateway. Tokens are not stored under `users/{uid}` where client Firestore rules allow reads.

Health check:

```bash
curl https://your-connector.run.app/__gilbert/health
```

GitHub can run with only `GITHUB_CLIENT_ID`; in that mode the hosted service starts GitHub's device flow from the cloud. Add `GITHUB_CLIENT_SECRET` to the deploy secrets later to switch to full web OAuth callback sign-in.

Discord needs `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, and `DISCORD_BOT_TOKEN` for the full hosted experience: per-user Discord sign-in, the signed interactions endpoint, slash-command registration, and channel posting without local ngrok. Without `DISCORD_CLIENT_SECRET`, the receiver can stay online, but users cannot sign in with Discord from the app.

## Scripts

```bash
npm run cloud:connectors:check
npm run cloud:connectors:build
npm run cloud:github:deploy
npm run cloud:google:deploy
npm run cloud:discord:deploy
```

Set these Vite URLs in product builds:

```bash
VITE_GILBERT_GITHUB_CONNECTOR_URL=https://your-github-connector.run.app
VITE_GILBERT_GOOGLE_CONNECTOR_URL=https://your-google-connector.run.app
VITE_GILBERT_DISCORD_CONNECTOR_URL=https://your-discord-connector.run.app
```

OAuth client secrets, Discord bot tokens, and Discord public keys belong in Secret Manager, not Vite env.
