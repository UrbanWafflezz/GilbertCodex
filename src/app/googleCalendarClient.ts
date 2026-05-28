import { invoke } from "@tauri-apps/api/core";
import { getDefaultGoogleOAuthClientId } from "./gmailClient";
import {
  cloudConnectorApi,
  disconnectCloudConnector,
  getCloudConnectorAccount,
  isCloudConnectorEnabled,
  startCloudConnectorOAuth,
  waitForCloudConnectorOAuth,
} from "../services/cloudConnectorClient";
import { isTauriDesktopRuntime, openExternalUrl } from "./tauriClient";
import { GOOGLE_CALENDAR_CORE_OAUTH_SCOPES } from "../lib/googleOAuthScopes";
import type {
  CalendarAccountEmailRequest,
  CalendarActionResponse,
  CalendarConnectionState,
  CalendarCreateEventRequest,
  CalendarDeleteEventRequest,
  CalendarEventAttendee,
  CalendarEventDateTime,
  CalendarEventListResponse,
  CalendarEventSummary,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResponse,
  CalendarGetEventRequest,
  CalendarGoogleApiRequest,
  CalendarGoogleApiResponse,
  CalendarListCalendarsRequest,
  CalendarListEventsRequest,
  CalendarListResponse,
  CalendarSummary,
  CalendarUpdateEventRequest,
} from "../types/googleCalendar";

export { GOOGLE_CALENDAR_CORE_OAUTH_SCOPES };

const DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE = GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.join(" ");

export interface CalendarConnectOAuthRequest {
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export function googleCalendarDesktopAvailable() {
  return googleCloudAvailable() || isTauriDesktopRuntime();
}

export function googleCloudAvailable() {
  return isCloudConnectorEnabled("google");
}

export function getDefaultGoogleCalendarOAuthScope() {
  return DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE;
}

export async function getGoogleCalendarState(): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    return normalizeCloudCalendarConnection(await getCloudConnectorAccount<CalendarConnectionState>("google"));
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_get_state");
}

export async function installGoogleCalendarPlugin(): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    const state = await getGoogleCalendarState();
    return state.connected ? state : { ...state, pluginInstalled: true, pluginInstalledAt: Date.now() };
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_install_plugin");
}

export async function connectGoogleCalendarOAuth(request: CalendarConnectOAuthRequest): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    const session = await startCloudConnectorOAuth("google", {
      scope: request.scope || DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE,
    });
    await openExternalUrl(session.authorizationUrl);
    return normalizeCloudCalendarConnection(await waitForCloudConnectorOAuth<CalendarConnectionState>("google", session));
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_connect_oauth", {
    request: {
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      scope: request.scope || DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE,
    },
  });
}

export async function disconnectGoogleCalendar(): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    return normalizeCloudCalendarConnection(await disconnectCloudConnector<CalendarConnectionState>("google"));
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_disconnect");
}

export async function disconnectGoogleCalendarAccount(request: CalendarAccountEmailRequest): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    return disconnectGoogleCalendar();
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_disconnect_account", {
    request,
  });
}

export async function setActiveGoogleCalendarAccount(request: CalendarAccountEmailRequest): Promise<CalendarConnectionState> {
  if (googleCloudAvailable()) {
    const state = await getGoogleCalendarState();
    if (state.connected && state.activeAccountEmail !== request.email) {
      throw new Error("The hosted Google connector currently keeps one active Google account per Gilbert account.");
    }
    return state;
  }

  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_set_active_account", {
    request,
  });
}

export async function listGoogleCalendars(request: CalendarListCalendarsRequest = {}): Promise<CalendarListResponse> {
  if (googleCloudAvailable()) {
    const response = await googleCalendarApi<{ items?: Record<string, unknown>[]; nextPageToken?: string }>({
      method: "GET",
      path: "/users/me/calendarList",
      query: {
        maxResults: request.maxResults,
        minAccessRole: request.minAccessRole,
        pageToken: request.pageToken,
        showDeleted: request.showDeleted,
        showHidden: request.showHidden,
      },
      service: "calendar",
    });
    return {
      calendars: (response.data.items ?? []).map(normalizeCalendarSummary),
      nextPageToken: response.data.nextPageToken,
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarListResponse>("calendar_list_calendars", {
    request: withDefaultClientId(request),
  });
}

export async function listGoogleCalendarEvents(request: CalendarListEventsRequest = {}): Promise<CalendarEventListResponse> {
  if (googleCloudAvailable()) {
    const calendarId = request.calendarId || "primary";
    const response = await googleCalendarApi<Record<string, any>>({
      method: "GET",
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      query: {
        maxResults: request.maxResults,
        orderBy: request.orderBy,
        pageToken: request.pageToken,
        q: request.query,
        showDeleted: request.includeDeleted,
        singleEvents: request.singleEvents ?? true,
        timeMax: request.timeMax,
        timeMin: request.timeMin,
        timeZone: request.timeZone,
      },
      service: "calendar",
    });
    return {
      accountEmail: request.accountEmail,
      calendarId,
      events: Array.isArray(response.data.items) ? response.data.items.map((event) => normalizeCalendarEvent(event, calendarId, request.accountEmail)) : [],
      nextPageToken: response.data.nextPageToken,
      nextSyncToken: response.data.nextSyncToken,
      summary: response.data.summary,
      timeZone: response.data.timeZone,
      updated: response.data.updated,
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarEventListResponse>("calendar_list_events", {
    request: withDefaultClientId(request),
  });
}

export async function getGoogleCalendarEvent(request: CalendarGetEventRequest): Promise<CalendarEventSummary> {
  if (googleCloudAvailable()) {
    const calendarId = request.calendarId || "primary";
    const response = await googleCalendarApi<Record<string, unknown>>({
      method: "GET",
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.eventId)}`,
      service: "calendar",
    });
    return normalizeCalendarEvent(response.data, calendarId, request.accountEmail);
  }

  assertCalendarDesktop();
  return invoke<CalendarEventSummary>("calendar_get_event", {
    request: withDefaultClientId(request),
  });
}

export async function queryGoogleCalendarFreeBusy(request: CalendarFreeBusyRequest): Promise<CalendarFreeBusyResponse> {
  if (googleCloudAvailable()) {
    const response = await googleCalendarApi<Record<string, any>>({
      body: {
        items: (request.calendarIds && request.calendarIds.length > 0 ? request.calendarIds : ["primary"]).map((id) => ({ id })),
        timeMax: request.timeMax,
        timeMin: request.timeMin,
        timeZone: request.timeZone,
      },
      method: "POST",
      path: "/freeBusy",
      service: "calendar",
    });
    return {
      accountEmail: request.accountEmail,
      calendars: Object.entries(response.data.calendars ?? {}).map(([id, value]) => ({
        busy: Array.isArray((value as any).busy) ? (value as any).busy : [],
        errors: Array.isArray((value as any).errors) ? (value as any).errors.map((error: any) => String(error.reason || error.message || error)) : [],
        id,
      })),
      groups: response.data.groups ?? {},
      timeMax: response.data.timeMax || request.timeMax,
      timeMin: response.data.timeMin || request.timeMin,
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarFreeBusyResponse>("calendar_free_busy", {
    request: withDefaultClientId(request),
  });
}

export async function createGoogleCalendarEvent(request: CalendarCreateEventRequest): Promise<CalendarActionResponse> {
  if (googleCloudAvailable()) {
    const calendarId = request.calendarId || "primary";
    const response = await googleCalendarApi<Record<string, unknown>>({
      body: createCalendarEventBody(request),
      method: "POST",
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      query: {
        conferenceDataVersion: request.createMeet ? 1 : undefined,
        sendUpdates: request.sendUpdates,
      },
      service: "calendar",
    });
    return {
      accountEmail: request.accountEmail,
      calendarId,
      event: normalizeCalendarEvent(response.data, calendarId, request.accountEmail),
      message: "Google Calendar event created.",
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_create_event", {
    request: withDefaultClientId(request),
  });
}

export async function updateGoogleCalendarEvent(request: CalendarUpdateEventRequest): Promise<CalendarActionResponse> {
  if (googleCloudAvailable()) {
    const calendarId = request.calendarId || "primary";
    const response = await googleCalendarApi<Record<string, unknown>>({
      body: createCalendarEventBody(request),
      method: "PATCH",
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.eventId)}`,
      query: {
        conferenceDataVersion: request.createMeet ? 1 : undefined,
        sendUpdates: request.sendUpdates,
      },
      service: "calendar",
    });
    return {
      accountEmail: request.accountEmail,
      calendarId,
      event: normalizeCalendarEvent(response.data, calendarId, request.accountEmail),
      message: "Google Calendar event updated.",
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_update_event", {
    request: withDefaultClientId(request),
  });
}

export async function deleteGoogleCalendarEvent(request: CalendarDeleteEventRequest): Promise<CalendarActionResponse> {
  if (googleCloudAvailable()) {
    const calendarId = request.calendarId || "primary";
    await googleCalendarApi<unknown>({
      method: "DELETE",
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.eventId)}`,
      query: {
        sendUpdates: request.sendUpdates,
      },
      service: "calendar",
    });
    return {
      accountEmail: request.accountEmail,
      calendarId,
      message: "Google Calendar event deleted.",
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_delete_event", {
    request: withDefaultClientId(request),
  });
}

export async function requestGoogleCalendarApi(request: CalendarGoogleApiRequest): Promise<CalendarGoogleApiResponse> {
  if (googleCloudAvailable()) {
    const response = await googleCalendarApi<unknown>({
      body: request.body,
      method: request.method,
      path: request.path,
      query: request.query,
      service: request.service,
    });
    return {
      accountEmail: request.accountEmail,
      data: response.data,
      message: response.message,
      method: response.method as CalendarGoogleApiRequest["method"],
      path: response.path,
      service: response.service as CalendarGoogleApiRequest["service"],
    };
  }

  assertCalendarDesktop();
  return invoke<CalendarGoogleApiResponse>("calendar_google_api", {
    request: withDefaultClientId(request),
  });
}

function assertCalendarDesktop() {
  if (!googleCalendarDesktopAvailable()) {
    throw new Error("Google Calendar integration is available in the desktop app or the hosted Google connector.");
  }
}

function withDefaultClientId<TRequest extends { clientId?: string }>(request: TRequest): TRequest {
  return {
    ...request,
    clientId: request.clientId || getDefaultGoogleOAuthClientId() || undefined,
  };
}

async function googleCalendarApi<TData>(request: {
  body?: unknown;
  method: CalendarGoogleApiRequest["method"];
  path: string;
  query?: Record<string, unknown>;
  service: CalendarGoogleApiRequest["service"];
}) {
  return cloudConnectorApi<TData>("google", request);
}

function normalizeCloudCalendarConnection(account: CalendarConnectionState): CalendarConnectionState {
  const accounts = Array.isArray(account.accounts) ? account.accounts : [];
  return {
    accounts,
    activeAccountEmail: account.activeAccountEmail || accounts.find((entry) => entry.active)?.email || accounts[0]?.email,
    connected: account.connected === true || accounts.length > 0,
    connectedAt: normalizeNumber(account.connectedAt),
    expiresAt: normalizeNumber(account.expiresAt),
    lastConnectionError: account.lastConnectionError,
    maxAccounts: Math.max(1, Number(account.maxAccounts || 1)),
    pluginInstalled: account.pluginInstalled === true || account.connected === true || accounts.length > 0,
    pluginInstalledAt: normalizeNumber(account.pluginInstalledAt),
    scopes: Array.isArray(account.scopes) ? account.scopes : accounts[0]?.scopes ?? [],
    user: account.user ?? accounts[0]?.user,
  };
}

function normalizeCalendarSummary(value: Record<string, unknown>): CalendarSummary {
  return {
    accessRole: optionalString(value.accessRole),
    backgroundColor: optionalString(value.backgroundColor),
    description: optionalString(value.description),
    foregroundColor: optionalString(value.foregroundColor),
    id: stringField(value.id),
    primary: value.primary === true,
    selected: value.selected === true,
    summary: optionalString(value.summary),
    timeZone: optionalString(value.timeZone),
  };
}

function normalizeCalendarEvent(value: Record<string, unknown>, calendarId: string, accountEmail?: string): CalendarEventSummary {
  const event = value as Record<string, any>;
  return {
    accountEmail,
    attendees: Array.isArray(event.attendees) ? event.attendees.map(normalizeCalendarAttendee) : [],
    calendarId,
    conferenceLink: optionalString(event.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === "video")?.uri),
    created: optionalString(event.created),
    description: optionalString(event.description),
    end: normalizeCalendarDateTime(event.end),
    hangoutLink: optionalString(event.hangoutLink),
    htmlLink: optionalString(event.htmlLink),
    iCalUid: optionalString(event.iCalUID),
    id: stringField(event.id),
    location: optionalString(event.location),
    start: normalizeCalendarDateTime(event.start),
    status: optionalString(event.status),
    summary: optionalString(event.summary),
    updated: optionalString(event.updated),
  };
}

function normalizeCalendarAttendee(value: any): CalendarEventAttendee {
  return {
    displayName: optionalString(value?.displayName),
    email: optionalString(value?.email),
    optional: value?.optional === true,
    organizer: value?.organizer === true,
    responseStatus: optionalString(value?.responseStatus),
    selfAttendee: value?.self === true,
  };
}

function normalizeCalendarDateTime(value: any): CalendarEventDateTime | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return {
    date: optionalString(value.date),
    dateTime: optionalString(value.dateTime),
    timeZone: optionalString(value.timeZone),
  };
}

function createCalendarEventBody(request: CalendarCreateEventRequest | CalendarUpdateEventRequest) {
  return {
    ...request.extra,
    attendees: request.attendees,
    conferenceData: request.createMeet
      ? {
          createRequest: {
            conferenceSolutionKey: { type: "hangoutsMeet" },
            requestId: `gilbert-${Date.now()}`,
          },
        }
      : undefined,
    description: request.description,
    end: request.end,
    location: request.location,
    start: request.start,
    status: "status" in request ? request.status : undefined,
    summary: request.summary,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
