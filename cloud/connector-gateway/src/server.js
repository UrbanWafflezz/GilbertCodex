import crypto from "node:crypto";
import http from "node:http";

import { FieldValue, getFirebaseDb, verifyFirebaseRequest } from "./firebase.js";
import { readHeader, readJsonBody, sendCorsPreflight, sendHtml, sendJson, writeCorsHeaders } from "./http.js";

const port = Number(process.env.PORT || 8080);
const service = readConnectorService();

const OAUTH_STATE_COLLECTION = "connectorOAuthStates";
const ACCOUNT_COLLECTION = "connectorAccounts";
const SECRET_COLLECTION = "connectorSecrets";
const DISCORD_INSTALL_COLLECTION = "discordConnectorInstalls";
const DISCORD_USER_COLLECTION = "discordConnectorUsers";
const DISCORD_EVENT_COLLECTION = "discordConnectorEvents";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DISCORD_EVENT_TTL_MS = 15 * 60 * 1000;
const GOOGLE_TOKEN_REFRESH_SKEW_MS = 90 * 1000;

const DEFAULT_GITHUB_SCOPES = "repo workflow delete_repo admin:repo_hook admin:org admin:public_key admin:org_hook gist notifications user project write:packages read:packages delete:packages admin:gpg_key codespace read:audit_log security_events";
const DEFAULT_GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.settings.sharing",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/tasks",
].join(" ");
const DEFAULT_DISCORD_SCOPES = "identify applications.commands";

const server = http.createServer(async (req, res) => {
  try {
    writeCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      sendCorsPreflight(req, res);
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/__gilbert/health") {
      sendJson(res, 200, { ok: true, service });
      return;
    }

    if (requestUrl.pathname === "/oauth/callback") {
      await handleOAuthCallback(res, requestUrl);
      return;
    }

    if (service === "discord" && requestUrl.pathname === "/discord/interactions") {
      await handleDiscordInteraction(req, res);
      return;
    }

    const decodedToken = await verifyFirebaseRequest(req);

    if (requestUrl.pathname === "/oauth/start" && req.method === "POST") {
      await handleOAuthStart(req, res, decodedToken);
      return;
    }

    if (requestUrl.pathname === "/oauth/status" && req.method === "GET") {
      await handleOAuthStatus(res, decodedToken, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/account" && req.method === "GET") {
      await handleAccount(res, decodedToken);
      return;
    }

    if (requestUrl.pathname === "/disconnect" && req.method === "POST") {
      await handleDisconnect(res, decodedToken);
      return;
    }

    if (requestUrl.pathname === "/api" && req.method === "POST") {
      await handleApiProxy(req, res, decodedToken);
      return;
    }

    if (service === "discord" && requestUrl.pathname === "/discord/events/poll" && req.method === "GET") {
      await handleDiscordEventPoll(res, decodedToken);
      return;
    }

    if (service === "discord" && requestUrl.pathname === "/discord/interactions/respond" && req.method === "POST") {
      await handleDiscordInteractionResponse(req, res, decodedToken);
      return;
    }

    if (service === "discord" && requestUrl.pathname === "/discord/channel-message" && req.method === "POST") {
      await handleDiscordChannelMessage(req, res, decodedToken);
      return;
    }

    if (service === "discord" && requestUrl.pathname === "/discord/register-command" && req.method === "POST") {
      await handleDiscordRegisterCommand(req, res, decodedToken);
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Gilbert ${service} connector gateway listening on ${port}`);
});

async function handleOAuthStart(req, res, decodedToken) {
  const body = await readJsonBody(req);
  const state = randomToken(32);
  const now = Date.now();
  const expiresAt = now + OAUTH_STATE_TTL_MS;

  if (service === "github" && !hasOAuthClientSecret("github")) {
    await handleGithubDeviceOAuthStart(res, decodedToken, body, state, now, expiresAt);
    return;
  }

  const authorizationUrl = createAuthorizationUrl(service, state, body);

  await oauthStateDoc(state).set({
    createdAt: now,
    expiresAt,
    service,
    status: "pending",
    uid: decodedToken.uid,
  });

  sendJson(res, 200, {
    authorizationUrl,
    expiresAt,
    interval: 2,
    service,
    state,
  });
}

async function handleOAuthStatus(res, decodedToken, requestUrl) {
  const state = normalizeState(requestUrl.searchParams.get("state"));
  const snapshot = await oauthStateDoc(state).get();

  if (!snapshot.exists) {
    sendJson(res, 404, { error: "OAuth session was not found or expired.", status: "expired" });
    return;
  }

  const data = snapshot.data();
  if (data.uid !== decodedToken.uid || data.service !== service) {
    sendJson(res, 403, { error: "OAuth session does not belong to this account.", status: "error" });
    return;
  }

  if (isExpired(data.expiresAt)) {
    await snapshot.ref.delete().catch(() => undefined);
    sendJson(res, 410, { error: "OAuth session expired. Start sign-in again.", status: "expired" });
    return;
  }

  if (data.status === "complete") {
    sendJson(res, 200, {
      account: await readPublicAccount(decodedToken.uid),
      status: "authorized",
    });
    return;
  }

  if (data.status === "error") {
    sendJson(res, 200, {
      error: data.error || "OAuth sign-in failed.",
      status: "error",
    });
    return;
  }

  if (data.flow === "github_device") {
    await handleGithubDeviceOAuthStatus(res, decodedToken, snapshot, data);
    return;
  }

  sendJson(res, 200, {
    message: "Waiting for browser authorization.",
    status: "pending",
  });
}

async function handleOAuthCallback(res, requestUrl) {
  const state = normalizeState(requestUrl.searchParams.get("state"));
  const snapshot = await oauthStateDoc(state).get();

  if (!snapshot.exists) {
    sendHtml(res, 404, renderOAuthResult("Sign-in session not found", "Go back to Gilbert and start sign-in again."));
    return;
  }

  const stateData = snapshot.data();
  if (stateData.service !== service || isExpired(stateData.expiresAt)) {
    await snapshot.ref.delete().catch(() => undefined);
    sendHtml(res, 410, renderOAuthResult("Sign-in expired", "Go back to Gilbert and start sign-in again."));
    return;
  }

  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    await snapshot.ref.set({
      error: requestUrl.searchParams.get("error_description") || oauthError,
      status: "error",
      updatedAt: Date.now(),
    }, { merge: true });
    sendHtml(res, 400, renderOAuthResult("Sign-in was not completed", "You can close this tab and try again from Gilbert."));
    return;
  }

  const code = requestUrl.searchParams.get("code")?.trim();
  if (!code) {
    await snapshot.ref.set({
      error: "Provider did not return an authorization code.",
      status: "error",
      updatedAt: Date.now(),
    }, { merge: true });
    sendHtml(res, 400, renderOAuthResult("Missing authorization code", "You can close this tab and try again from Gilbert."));
    return;
  }

  try {
    const account = await exchangeAndSaveOAuthAccount(service, stateData.uid, code, requestUrl);
    await snapshot.ref.set({
      completedAt: Date.now(),
      status: "complete",
      updatedAt: Date.now(),
    }, { merge: true });
    sendHtml(res, 200, renderOAuthResult(`${account.label} connected`, "You can close this tab and return to Gilbert."));
  } catch (error) {
    await snapshot.ref.set({
      error: error instanceof Error ? error.message : "OAuth token exchange failed.",
      status: "error",
      updatedAt: Date.now(),
    }, { merge: true });
    throw error;
  }
}

async function handleAccount(res, decodedToken) {
  sendJson(res, 200, await readPublicAccount(decodedToken.uid));
}

async function handleDisconnect(res, decodedToken) {
  const uid = decodedToken.uid;

  await Promise.all([
    publicAccountDoc(uid, service).delete().catch(() => undefined),
    secretAccountDoc(uid, service).delete().catch(() => undefined),
    cleanupDiscordMappings(uid),
  ]);

  sendJson(res, 200, createDisconnectedAccount());
}

async function handleApiProxy(req, res, decodedToken) {
  if (service === "discord") {
    sendJson(res, 404, { error: "Discord uses dedicated cloud endpoints." });
    return;
  }

  const request = await readJsonBody(req, 2 * 1024 * 1024);
  const secret = await requireSecret(decodedToken.uid, service);
  const accessToken = service === "google" ? await getFreshGoogleAccessToken(decodedToken.uid, secret) : secret.accessToken;
  const upstream = service === "github"
    ? await requestGithubApi(accessToken, request)
    : await requestGoogleApi(accessToken, request);

  sendJson(res, upstream.status, upstream.payload);
}

async function exchangeAndSaveOAuthAccount(connectorService, uid, code, callbackUrl) {
  if (connectorService === "github") {
    return exchangeAndSaveGithubAccount(uid, code);
  }

  if (connectorService === "google") {
    return exchangeAndSaveGoogleAccount(uid, code);
  }

  if (connectorService === "discord") {
    return exchangeAndSaveDiscordAccount(uid, code, callbackUrl);
  }

  throw new Error(`Unsupported connector service: ${connectorService}`);
}

async function exchangeAndSaveGithubAccount(uid, code) {
  const config = requireOAuthConfig("github");
  const tokenPayload = await postFormJson("https://github.com/login/oauth/access_token", {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri(),
  });

  if (tokenPayload.error) {
    throw new Error(tokenPayload.error_description || tokenPayload.error);
  }

  return saveGithubTokenAccount(uid, tokenPayload);
}

async function saveGithubTokenAccount(uid, tokenPayload) {
  const accessToken = requiredString(tokenPayload.access_token, "GitHub did not return an access token.");
  const scopes = parseScopeList(tokenPayload.scope);
  const user = await fetchJson("https://api.github.com/user", {
    headers: githubHeaders(accessToken),
  });
  const account = {
    connected: true,
    connectedAt: Date.now(),
    label: user.login || "GitHub",
    pluginInstalled: true,
    pluginInstalledAt: Date.now(),
    scopes,
    service: "github",
    updatedAt: Date.now(),
    user: {
      avatarUrl: user.avatar_url || undefined,
      htmlUrl: user.html_url || "",
      id: Number(user.id || 0),
      login: user.login || "",
      name: user.name || undefined,
    },
  };

  await saveAccount(uid, "github", account, {
    accessToken,
    scopes,
    tokenType: tokenPayload.token_type || "bearer",
  });

  return account;
}

async function handleGithubDeviceOAuthStart(res, decodedToken, body, state, now, fallbackExpiresAt) {
  const config = requireOAuthConfig("github", { requireSecret: false });
  const scope = configuredScopes("github", body.scope);
  const devicePayload = await postFormJson("https://github.com/login/device/code", {
    client_id: config.clientId,
    scope,
  });

  if (devicePayload.error) {
    throw new Error(devicePayload.error_description || devicePayload.error);
  }

  const deviceCode = requiredString(devicePayload.device_code, "GitHub did not return a device code.");
  const userCode = requiredString(devicePayload.user_code, "GitHub did not return a user code.");
  const verificationUri = requiredString(devicePayload.verification_uri, "GitHub did not return a verification URL.");
  const interval = Math.max(2, Number(devicePayload.interval || 5));
  const expiresAt = now + Math.max(1, Number(devicePayload.expires_in || 900)) * 1000;

  await oauthStateDoc(state).set({
    createdAt: now,
    deviceCode,
    expiresAt: Math.min(expiresAt, fallbackExpiresAt),
    flow: "github_device",
    interval,
    scope,
    service: "github",
    status: "pending",
    uid: decodedToken.uid,
    userCode,
    verificationUri,
  });

  sendJson(res, 200, {
    authorizationUrl: verificationUri,
    expiresAt: Math.min(expiresAt, fallbackExpiresAt),
    interval,
    mode: "device",
    service: "github",
    state,
    userCode,
    verificationUri,
  });
}

async function handleGithubDeviceOAuthStatus(res, decodedToken, snapshot, data) {
  const config = requireOAuthConfig("github", { requireSecret: false });
  const tokenPayload = await postFormJson("https://github.com/login/oauth/access_token", {
    client_id: config.clientId,
    device_code: data.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  if (tokenPayload.error === "authorization_pending") {
    sendJson(res, 200, {
      message: "Waiting for GitHub authorization.",
      status: "pending",
    });
    return;
  }

  if (tokenPayload.error === "slow_down") {
    const nextInterval = Math.max(Number(data.interval || 5) + 5, 10);
    await snapshot.ref.set({ interval: nextInterval, updatedAt: Date.now() }, { merge: true });
    sendJson(res, 200, {
      interval: nextInterval,
      message: "GitHub asked us to slow down polling.",
      status: "pending",
    });
    return;
  }

  if (tokenPayload.error) {
    const expired = tokenPayload.error === "expired_token";
    await snapshot.ref.set({
      error: tokenPayload.error_description || tokenPayload.error,
      status: expired ? "expired" : "error",
      updatedAt: Date.now(),
    }, { merge: true });
    sendJson(res, expired ? 410 : 200, {
      error: tokenPayload.error_description || tokenPayload.error,
      status: expired ? "expired" : "error",
    });
    return;
  }

  const account = await saveGithubTokenAccount(decodedToken.uid, tokenPayload);
  await snapshot.ref.set({
    completedAt: Date.now(),
    status: "complete",
    updatedAt: Date.now(),
  }, { merge: true });
  sendJson(res, 200, {
    account,
    status: "authorized",
  });
}

async function exchangeAndSaveGoogleAccount(uid, code) {
  const config = requireOAuthConfig("google");
  const existing = await readSecret(uid, "google");
  const tokenPayload = await postFormJson("https://oauth2.googleapis.com/token", {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });

  if (tokenPayload.error) {
    throw new Error(tokenPayload.error_description || tokenPayload.error);
  }

  const accessToken = requiredString(tokenPayload.access_token, "Google did not return an access token.");
  const refreshToken = tokenPayload.refresh_token || existing?.refreshToken;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Revoke the old Gilbert grant in your Google Account, then connect again.");
  }

  const expiresIn = Number(tokenPayload.expires_in || 3600);
  const expiresAt = Date.now() + Math.max(1, expiresIn) * 1000;
  const scopes = parseScopeList(tokenPayload.scope || configuredScopes("google"));
  const user = await fetchJson("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const account = {
    accounts: [{
      active: true,
      connectedAt: Date.now(),
      email: user.email || "",
      expiresAt,
      scopes,
      user: normalizeGoogleUser(user),
    }],
    activeAccountEmail: user.email || "",
    connected: true,
    connectedAt: Date.now(),
    expiresAt,
    label: user.email || user.name || "Google",
    maxAccounts: 1,
    pluginInstalled: true,
    pluginInstalledAt: Date.now(),
    scopes,
    service: "google",
    updatedAt: Date.now(),
    user: normalizeGoogleUser(user),
  };

  await saveAccount(uid, "google", account, {
    accessToken,
    expiresAt,
    refreshToken,
    scopes,
    tokenType: tokenPayload.token_type || "Bearer",
  });

  return account;
}

async function exchangeAndSaveDiscordAccount(uid, code, callbackUrl) {
  const config = requireOAuthConfig("discord");
  const tokenPayload = await postFormJson("https://discord.com/api/v10/oauth2/token", {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });

  if (tokenPayload.error) {
    throw new Error(tokenPayload.error_description || tokenPayload.error);
  }

  const accessToken = requiredString(tokenPayload.access_token, "Discord did not return an access token.");
  const expiresIn = Number(tokenPayload.expires_in || 604800);
  const expiresAt = Date.now() + Math.max(1, expiresIn) * 1000;
  const scopes = parseScopeList(tokenPayload.scope || configuredScopes("discord"));
  const user = await fetchJson("https://discord.com/api/v10/users/@me", {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const guildId = callbackUrl.searchParams.get("guild_id")?.trim() || "";
  const account = {
    connected: true,
    connectedAt: Date.now(),
    expiresAt,
    guildId: guildId || undefined,
    interactionsEndpointUrl: `${publicBaseUrl().replace(/\/+$/, "")}/discord/interactions`,
    label: user.global_name || user.username || "Discord",
    pluginInstalled: true,
    pluginInstalledAt: Date.now(),
    scopes,
    service: "discord",
    updatedAt: Date.now(),
    user: {
      avatar: user.avatar || undefined,
      discriminator: user.discriminator || undefined,
      globalName: user.global_name || undefined,
      id: user.id || "",
      username: user.username || "",
    },
  };

  await saveAccount(uid, "discord", account, {
    accessToken,
    expiresAt,
    guildId: guildId || "",
    refreshToken: tokenPayload.refresh_token || "",
    scopes,
    tokenType: tokenPayload.token_type || "Bearer",
  });
  await saveDiscordMappings(uid, account);

  return account;
}

async function requestGithubApi(accessToken, request) {
  const method = normalizeMethod(request.method);
  const path = normalizeApiPath(request.path, "GitHub");
  const url = new URL(path, "https://api.github.com");
  appendQuery(url, request.query);

  const response = await fetch(url, {
    body: createJsonBody(method, request.body),
    headers: {
      ...githubHeaders(accessToken),
      ...(request.body === undefined || method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
    },
    method,
  });
  const data = await readUpstreamPayload(response);

  return {
    payload: {
      data,
      message: `GitHub API ${method} ${path} returned HTTP ${response.status}.`,
      method,
      path,
      status: response.status,
    },
    status: response.ok ? 200 : response.status,
  };
}

async function requestGoogleApi(accessToken, request) {
  const method = normalizeMethod(request.method);
  const path = normalizeApiPath(request.path, "Google");
  const serviceName = normalizeGoogleApiService(request.service);
  const url = new URL(path, googleApiBaseUrl(serviceName));
  appendQuery(url, request.query);

  const response = await fetch(url, {
    body: createJsonBody(method, request.body),
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(request.body === undefined || method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
    },
    method,
  });
  const data = await readUpstreamPayload(response);

  return {
    payload: {
      data,
      message: `Google ${serviceName} API ${method} ${path} returned HTTP ${response.status}.`,
      method,
      path,
      service: serviceName,
      status: response.status,
    },
    status: response.ok ? 200 : response.status,
  };
}

async function handleDiscordInteraction(req, res) {
  const rawBody = await readRawBody(req, 256 * 1024);

  if (!verifyDiscordSignature(req, rawBody)) {
    sendJson(res, 401, { error: "Invalid Discord request signature." });
    return;
  }

  const payload = JSON.parse(rawBody.toString("utf8"));
  if (payload.type === 1) {
    sendJson(res, 200, { type: 1 });
    return;
  }

  const prompt = readDiscordPrompt(payload);
  const uid = await resolveDiscordUid(payload);
  if (!uid) {
    sendJson(res, 200, {
      data: {
        content: "Connect Discord to Gilbert first, then try this command again.",
        flags: 64,
      },
      type: 4,
    });
    return;
  }

  await queueDiscordEvent(uid, payload, prompt);
  sendJson(res, 200, { type: 5 });
}

async function handleDiscordEventPoll(res, decodedToken) {
  const now = Date.now();
  const eventsRef = getFirebaseDb().collection(DISCORD_EVENT_COLLECTION).doc(decodedToken.uid).collection("events");
  const snapshot = await eventsRef.orderBy("createdAt", "asc").limit(5).get();
  const events = [];
  const batch = getFirebaseDb().batch();

  snapshot.forEach((document) => {
    const event = document.data();
    if (event.expiresAt && event.expiresAt < now) {
      batch.delete(document.ref);
      return;
    }

    events.push({
      applicationId: event.applicationId,
      channelId: event.channelId || null,
      commandName: event.commandName || null,
      guildId: event.guildId || null,
      id: event.id,
      prompt: event.prompt,
      receivedAt: event.receivedAt,
      token: event.token,
      userId: event.userId || null,
      username: event.username || null,
    });
    batch.delete(document.ref);
  });

  await batch.commit();
  sendJson(res, 200, { events });
}

async function handleDiscordInteractionResponse(req, res, decodedToken) {
  await requireSecret(decodedToken.uid, "discord");
  const request = await readJsonBody(req);
  const applicationId = requiredString(request.applicationId, "Discord application ID is required.");
  const token = requiredString(request.token, "Discord interaction token is required.");
  const content = String(request.content || "").trim() || "Gilbert finished, but there was no visible response text.";

  await sendDiscordInteractionWebhook(applicationId, token, content);
  sendJson(res, 200, { ok: true });
}

async function handleDiscordChannelMessage(req, res, decodedToken) {
  await requireSecret(decodedToken.uid, "discord");
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    sendJson(res, 501, { error: "Discord channel messages need DISCORD_BOT_TOKEN on the cloud service." });
    return;
  }

  const request = await readJsonBody(req);
  const channelId = requiredString(request.channelId, "Discord channel ID is required.");
  const content = String(request.content || "").trim();
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      content: limitDiscordMessage(content),
    }),
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const data = await readUpstreamPayload(response);
  if (!response.ok) {
    sendJson(res, response.status, { error: readProviderError(data, "Discord channel message failed."), data });
    return;
  }

  sendJson(res, 200, { ok: true });
}

async function handleDiscordRegisterCommand(req, res, decodedToken) {
  const account = await requireSecret(decodedToken.uid, "discord");
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim() || process.env.DISCORD_CLIENT_ID?.trim() || "";
  if (!botToken || !applicationId) {
    sendJson(res, 501, { error: "Discord command registration needs DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID on the cloud service." });
    return;
  }

  const request = await readJsonBody(req);
  const commandName = normalizeDiscordCommandName(request.commandName || "gilbert");
  const guildId = String(request.guildId || account.guildId || "").trim();
  const url = guildId
    ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${applicationId}/commands`;
  const response = await fetch(url, {
    body: JSON.stringify({
      description: commandName === "gilbertnewchat" ? "Start a new Gilbert Codex chat" : "Continue your Gilbert Codex chat",
      name: commandName,
      options: [{
        description: "What should Gilbert do?",
        name: "prompt",
        required: true,
        type: 3,
      }],
      type: 1,
    }),
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const data = await readUpstreamPayload(response);

  if (!response.ok) {
    sendJson(res, response.status, { error: readProviderError(data, "Discord command registration failed."), data });
    return;
  }

  if (guildId) {
    const accountPatch = createDiscordServiceAccount({ guildId });
    await Promise.all([
      publicAccountDoc(decodedToken.uid, "discord").set(accountPatch, { merge: true }),
      getFirebaseDb().collection(DISCORD_INSTALL_COLLECTION).doc(guildId).set({
        guildId,
        uid: decodedToken.uid,
        updatedAt: Date.now(),
      }, { merge: true }),
    ]);
  }

  sendJson(res, 200, {
    commandId: data.id || "",
    commandName: data.name || commandName,
    guildId: guildId || null,
    message: guildId
      ? `/${data.name || commandName} was registered for server ${guildId}.`
      : `/${data.name || commandName} was registered globally.`,
    scope: guildId ? "guild" : "global",
  });
}

async function getFreshGoogleAccessToken(uid, secret) {
  if (secret.accessToken && Number(secret.expiresAt || 0) > Date.now() + GOOGLE_TOKEN_REFRESH_SKEW_MS) {
    return secret.accessToken;
  }

  const config = requireOAuthConfig("google");
  const refreshToken = requiredString(secret.refreshToken, "Google account needs to be reconnected.");
  const tokenPayload = await postFormJson("https://oauth2.googleapis.com/token", {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (tokenPayload.error) {
    throw new Error(tokenPayload.error_description || tokenPayload.error);
  }

  const accessToken = requiredString(tokenPayload.access_token, "Google did not return a refreshed access token.");
  const expiresAt = Date.now() + Math.max(1, Number(tokenPayload.expires_in || 3600)) * 1000;
  await secretAccountDoc(uid, "google").set({
    accessToken,
    expiresAt,
    updatedAt: Date.now(),
  }, { merge: true });
  await publicAccountDoc(uid, "google").set({
    expiresAt,
    updatedAt: Date.now(),
  }, { merge: true });

  return accessToken;
}

async function saveAccount(uid, connectorService, account, secret) {
  await Promise.all([
    publicAccountDoc(uid, connectorService).set({
      ...account,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    secretAccountDoc(uid, connectorService).set({
      ...secret,
      service: connectorService,
      uid,
      updatedAt: Date.now(),
      serverUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

async function readPublicAccount(uid) {
  const snapshot = await publicAccountDoc(uid, service).get();
  if (!snapshot.exists) {
    if (service === "discord" && isDiscordServiceConfigured()) {
      return createDiscordServiceAccount();
    }
    return createDisconnectedAccount();
  }

  const data = snapshot.data();
  return {
    ...createDisconnectedAccount(),
    ...data,
    connected: data.connected === true,
    pluginInstalled: data.pluginInstalled !== false,
  };
}

async function readSecret(uid, connectorService) {
  const snapshot = await secretAccountDoc(uid, connectorService).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function requireSecret(uid, connectorService) {
  const secret = await readSecret(uid, connectorService);
  if (!secret) {
    if (connectorService === "discord" && isDiscordServiceConfigured()) {
      return {
        guildId: "",
        service: "discord",
        uid,
      };
    }
    const error = new Error(`Connect ${connectorService} before using this cloud connector.`);
    error.statusCode = 401;
    throw error;
  }
  return secret;
}

function createDisconnectedAccount() {
  if (service === "google") {
    return {
      accounts: [],
      connected: false,
      maxAccounts: 1,
      pluginInstalled: false,
      scopes: [],
      service,
    };
  }

  return {
    connected: false,
    pluginInstalled: false,
    scopes: [],
    service,
  };
}

function createDiscordServiceAccount(patch = {}) {
  return {
    connected: true,
    connectedAt: Date.now(),
    interactionsEndpointUrl: `${publicBaseUrl().replace(/\/+$/, "")}/discord/interactions`,
    label: "Hosted Discord",
    pluginInstalled: true,
    pluginInstalledAt: Date.now(),
    scopes: parseScopeList(configuredScopes("discord")),
    service: "discord",
    updatedAt: Date.now(),
    ...patch,
  };
}

function createAuthorizationUrl(connectorService, state, body) {
  if (connectorService === "github") {
    const config = requireOAuthConfig("github");
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", configuredScopes("github", body.scope));
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "true");
    return url.toString();
  }

  if (connectorService === "google") {
    const config = requireOAuthConfig("google");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", process.env.GOOGLE_OAUTH_PROMPT || "consent");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", configuredScopes("google", body.scope));
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (connectorService === "discord") {
    const config = requireOAuthConfig("discord");
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", configuredScopes("discord", body.scope));
    url.searchParams.set("state", state);
    const permissions = process.env.DISCORD_BOT_PERMISSIONS?.trim();
    if (permissions) {
      url.searchParams.set("permissions", permissions);
    }
    return url.toString();
  }

  throw new Error(`Unsupported connector service: ${connectorService}`);
}

function requireOAuthConfig(connectorService, options = {}) {
  return readOAuthConfig(connectorService, { requireSecret: options.requireSecret !== false });
}

function readOAuthConfig(connectorService, options = {}) {
  const prefix = connectorService.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim() || process.env[`${prefix}_OAUTH_CLIENT_ID`]?.trim() || "";
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim() || process.env[`${prefix}_OAUTH_CLIENT_SECRET`]?.trim() || "";
  const requireSecret = options.requireSecret !== false;

  if (!clientId || (requireSecret && !clientSecret)) {
    const error = new Error(`${connectorService} cloud connector is missing its OAuth client ID or client secret.`);
    error.statusCode = 503;
    throw error;
  }

  return { clientId, clientSecret };
}

function hasOAuthClientSecret(connectorService) {
  try {
    return Boolean(readOAuthConfig(connectorService, { requireSecret: false }).clientSecret);
  } catch {
    return false;
  }
}

function isDiscordServiceConfigured() {
  return Boolean(
    (process.env.DISCORD_APPLICATION_ID?.trim() || process.env.DISCORD_CLIENT_ID?.trim())
    && process.env.DISCORD_PUBLIC_KEY?.trim()
    && process.env.DISCORD_BOT_TOKEN?.trim(),
  );
}

function configuredScopes(connectorService, requestedScope) {
  const envScope = process.env[`${connectorService.toUpperCase()}_OAUTH_SCOPES`]?.trim();
  const scope = String(requestedScope || envScope || defaultScopes(connectorService)).trim();
  return scope.split(/\s+/).filter(Boolean).join(" ");
}

function defaultScopes(connectorService) {
  if (connectorService === "github") {
    return DEFAULT_GITHUB_SCOPES;
  }
  if (connectorService === "google") {
    return DEFAULT_GOOGLE_SCOPES;
  }
  if (connectorService === "discord") {
    return DEFAULT_DISCORD_SCOPES;
  }
  return "";
}

function redirectUri() {
  return `${publicBaseUrl().replace(/\/+$/, "")}/oauth/callback`;
}

function publicBaseUrl() {
  const value = process.env.GILBERT_PUBLIC_BASE_URL?.trim();
  if (!value) {
    const error = new Error("Cloud connector is missing GILBERT_PUBLIC_BASE_URL.");
    error.statusCode = 503;
    throw error;
  }
  return value;
}

async function postFormJson(url, form) {
  const response = await fetch(url, {
    body: new URLSearchParams(form),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = await readUpstreamPayload(response);
  if (!response.ok) {
    throw new Error(readProviderError(payload, `${url} returned HTTP ${response.status}.`));
  }
  return payload;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await readUpstreamPayload(response);
  if (!response.ok) {
    throw new Error(readProviderError(payload, `${url} returned HTTP ${response.status}.`));
  }
  return payload;
}

async function readUpstreamPayload(response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function githubHeaders(accessToken) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": "GilbertCodex cloud connector",
    "x-github-api-version": process.env.GITHUB_API_VERSION || "2022-11-28",
  };
}

function normalizeGoogleUser(user) {
  return {
    email: user.email || "",
    emailVerified: user.verified_email === true || user.email_verified === true,
    name: user.name || undefined,
    picture: user.picture || undefined,
    sub: user.id || user.sub || undefined,
  };
}

function normalizeMethod(method) {
  const normalized = String(method || "GET").trim().toUpperCase();
  if (!["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"].includes(normalized)) {
    throw new Error("API method must be DELETE, GET, HEAD, PATCH, POST, or PUT.");
  }
  return normalized;
}

function normalizeApiPath(path, label) {
  const normalized = String(path || "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("://") || normalized.includes("\0")) {
    throw new Error(`${label} API path must be a relative path such as /user.`);
  }
  if (normalized.length > 1400) {
    throw new Error(`${label} API path is too long.`);
  }
  return normalized;
}

function normalizeGoogleApiService(value) {
  const normalized = String(value || "gmail").trim().toLowerCase();
  if (["calendar", "gmail", "tasks"].includes(normalized)) {
    return normalized;
  }
  throw new Error("Google API service must be gmail, calendar, or tasks.");
}

function googleApiBaseUrl(serviceName) {
  if (serviceName === "calendar") {
    return "https://www.googleapis.com/calendar/v3";
  }
  if (serviceName === "tasks") {
    return "https://tasks.googleapis.com/tasks/v1";
  }
  return "https://gmail.googleapis.com/gmail/v1";
}

function appendQuery(url, query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function createJsonBody(method, body) {
  if (body === undefined || method === "GET" || method === "HEAD") {
    return undefined;
  }
  return JSON.stringify(body);
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

function verifyDiscordSignature(req, rawBody) {
  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKeyHex) {
    return false;
  }

  const signatureHex = readHeader(req, "x-signature-ed25519");
  const timestamp = readHeader(req, "x-signature-timestamp");
  if (!signatureHex || !timestamp) {
    return false;
  }

  try {
    const publicKey = crypto.createPublicKey({
      format: "der",
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKeyHex, "hex"),
      ]),
      type: "spki",
    });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

function readDiscordPrompt(payload) {
  const options = payload?.data?.options;
  if (!Array.isArray(options)) {
    return "";
  }

  const prompt = options.find((option) => option?.name === "prompt")?.value;
  return typeof prompt === "string" ? prompt.trim() : "";
}

async function resolveDiscordUid(payload) {
  const guildId = payload?.guild_id ? String(payload.guild_id) : "";
  if (guildId) {
    const install = await getFirebaseDb().collection(DISCORD_INSTALL_COLLECTION).doc(guildId).get();
    if (install.exists && install.data()?.uid) {
      return install.data().uid;
    }
  }

  const userId = payload?.member?.user?.id || payload?.user?.id || "";
  if (userId) {
    const user = await getFirebaseDb().collection(DISCORD_USER_COLLECTION).doc(String(userId)).get();
    if (user.exists && user.data()?.uid) {
      return user.data().uid;
    }
  }

  return "";
}

async function queueDiscordEvent(uid, payload, prompt) {
  const now = Date.now();
  const user = payload.member?.user || payload.user || {};
  const commandName = payload.data?.name || "";
  await getFirebaseDb()
    .collection(DISCORD_EVENT_COLLECTION)
    .doc(uid)
    .collection("events")
    .doc(String(payload.id))
    .set({
      applicationId: String(payload.application_id || ""),
      channelId: payload.channel_id ? String(payload.channel_id) : "",
      commandName: commandName ? String(commandName) : "",
      createdAt: now,
      expiresAt: now + DISCORD_EVENT_TTL_MS,
      guildId: payload.guild_id ? String(payload.guild_id) : "",
      id: String(payload.id || randomToken(12)),
      prompt,
      receivedAt: now,
      token: String(payload.token || ""),
      userId: user.id ? String(user.id) : "",
      username: user.global_name || user.username || "",
    });
}

async function sendDiscordInteractionWebhook(applicationId, token, content) {
  const body = {
    allowed_mentions: { parse: [] },
    content: limitDiscordMessage(content),
  };
  const editUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const editResponse = await fetch(editUrl, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (editResponse.ok) {
    return;
  }

  const followupUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;
  const followupResponse = await fetch(followupUrl, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (followupResponse.ok) {
    return;
  }

  throw new Error(`Discord rejected the interaction response. Edit status: ${editResponse.status}. Follow-up status: ${followupResponse.status}.`);
}

async function saveDiscordMappings(uid, account) {
  const writes = [];
  if (account.guildId) {
    writes.push(getFirebaseDb().collection(DISCORD_INSTALL_COLLECTION).doc(account.guildId).set({
      guildId: account.guildId,
      uid,
      updatedAt: Date.now(),
    }, { merge: true }));
  }
  if (account.user?.id) {
    writes.push(getFirebaseDb().collection(DISCORD_USER_COLLECTION).doc(account.user.id).set({
      discordUserId: account.user.id,
      uid,
      updatedAt: Date.now(),
    }, { merge: true }));
  }
  await Promise.all(writes);
}

async function cleanupDiscordMappings(uid) {
  if (service !== "discord") {
    return;
  }

  const [installs, users] = await Promise.all([
    getFirebaseDb().collection(DISCORD_INSTALL_COLLECTION).where("uid", "==", uid).limit(50).get(),
    getFirebaseDb().collection(DISCORD_USER_COLLECTION).where("uid", "==", uid).limit(50).get(),
  ]);
  const batch = getFirebaseDb().batch();
  installs.forEach((doc) => batch.delete(doc.ref));
  users.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

function limitDiscordMessage(content) {
  const normalized = String(content || "").trim();
  if (normalized.length <= 1900) {
    return normalized;
  }
  return `${normalized.slice(0, 1868).trim()}\n\n[Truncated in Discord.]`;
}

function normalizeDiscordCommandName(value) {
  const name = String(value || "gilbert").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
    throw new Error("Discord command names can only use lowercase letters, numbers, hyphens, and underscores.");
  }
  return name;
}

function parseScopeList(scope) {
  return String(scope || "").split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}

function requiredString(value, message) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function normalizeState(state) {
  const normalized = String(state || "").trim();
  if (!/^[A-Za-z0-9_-]{24,160}$/.test(normalized)) {
    throw new Error("OAuth state is invalid.");
  }
  return normalized;
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function isExpired(expiresAt) {
  return Number(expiresAt || 0) <= Date.now();
}

function readProviderError(payload, fallback) {
  if (payload && typeof payload === "object") {
    return payload.error_description || payload.error || payload.message || payload.text || fallback;
  }
  return fallback;
}

function oauthStateDoc(state) {
  return getFirebaseDb().collection(OAUTH_STATE_COLLECTION).doc(state);
}

function publicAccountDoc(uid, connectorService) {
  return getFirebaseDb().collection(ACCOUNT_COLLECTION).doc(uid).collection("providers").doc(connectorService);
}

function secretAccountDoc(uid, connectorService) {
  return getFirebaseDb().collection(SECRET_COLLECTION).doc(uid).collection("providers").doc(connectorService);
}

function readConnectorService() {
  const normalized = (process.env.GILBERT_CONNECTOR_SERVICE || "").trim().toLowerCase();
  if (["discord", "github", "google"].includes(normalized)) {
    return normalized;
  }
  throw new Error("Set GILBERT_CONNECTOR_SERVICE to github, google, or discord.");
}

function renderOAuthResult(title, detail) {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
    <style>
      body{align-items:center;background:#0f1115;color:#f4f7fb;display:flex;font-family:Inter,ui-sans-serif,system-ui,sans-serif;justify-content:center;margin:0;min-height:100vh}
      main{max-width:560px;padding:32px;text-align:center}
      h1{font-size:28px;line-height:1.15;margin:0 0 12px}
      p{color:#b8c1d1;font-size:16px;line-height:1.5;margin:0}
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDetail}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handleError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const message = error instanceof Error ? error.message : "Cloud connector request failed.";
  console.error(message, error?.cause || error);
  sendJson(res, statusCode, { error: message });
}
