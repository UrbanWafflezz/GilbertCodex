import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  getGoogleCalendarState,
  listGoogleCalendarEvents,
  listGoogleCalendars,
  queryGoogleCalendarFreeBusy,
  requestGoogleCalendarApi,
  updateGoogleCalendarEvent,
} from "../../../app/googleCalendarClient";
import type {
  CalendarActionResponse,
  CalendarConnectionState,
  CalendarCreateEventRequest,
  CalendarEventDateTimeInput,
  CalendarEventListResponse,
  CalendarEventSummary,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResponse,
  CalendarGoogleApiRequest,
  CalendarGoogleApiResponse,
  CalendarListEventsRequest,
  CalendarListResponse,
  CalendarUpdateEventRequest,
} from "../../../types/googleCalendar";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";

export interface GoogleCalendarToolBackend {
  account: () => Promise<CalendarConnectionState>;
  apiRequest: (request: CalendarGoogleApiRequest) => Promise<CalendarGoogleApiResponse>;
  createEvent: (request: CalendarCreateEventRequest) => Promise<CalendarActionResponse>;
  deleteEvent: (request: { accountEmail?: string; calendarId?: string; eventId: string; sendUpdates?: CalendarCreateEventRequest["sendUpdates"] }) => Promise<CalendarActionResponse>;
  freeBusy: (request: CalendarFreeBusyRequest) => Promise<CalendarFreeBusyResponse>;
  getEvent: (request: { accountEmail?: string; calendarId?: string; eventId: string }) => Promise<CalendarEventSummary>;
  listCalendars: (accountEmail?: string) => Promise<CalendarListResponse>;
  listEvents: (request: CalendarListEventsRequest) => Promise<CalendarEventListResponse>;
  updateEvent: (request: CalendarUpdateEventRequest) => Promise<CalendarActionResponse>;
}

export const defaultGoogleCalendarToolBackend: GoogleCalendarToolBackend = {
  account: () => getGoogleCalendarState(),
  apiRequest: (request) => requestGoogleCalendarApi(request),
  createEvent: (request) => createGoogleCalendarEvent(request),
  deleteEvent: (request) => deleteGoogleCalendarEvent(request),
  freeBusy: (request) => queryGoogleCalendarFreeBusy(request),
  getEvent: (request) => getGoogleCalendarEvent(request),
  listCalendars: (accountEmail) => listGoogleCalendars({ accountEmail }),
  listEvents: (request) => listGoogleCalendarEvents(request),
  updateEvent: (request) => updateGoogleCalendarEvent(request),
};

export function createGoogleCalendarTools(backend: GoogleCalendarToolBackend = defaultGoogleCalendarToolBackend): ToolDefinition[] {
  return [
    createCalendarAccountTool(backend),
    createCalendarListCalendarsTool(backend),
    createCalendarSearchEventsTool(backend),
    createCalendarGetEventTool(backend),
    createCalendarFreeBusyTool(backend),
    createCalendarCreateEventTool(backend),
    createCalendarUpdateEventTool(backend),
    createCalendarDeleteEventTool(backend),
    createCalendarCreateCalendarTool(backend),
    createCalendarUpdateCalendarTool(backend),
    createCalendarDeleteCalendarTool(backend),
    createCalendarApiReadTool(backend),
    createCalendarApiWriteTool(backend),
    createCalendarApiDeleteTool(backend),
    createCalendarListTaskListsTool(backend),
    createCalendarListTasksTool(backend),
    createCalendarGetTaskTool(backend),
    createCalendarCreateTaskListTool(backend),
    createCalendarUpdateTaskListTool(backend),
    createCalendarDeleteTaskListTool(backend),
    createCalendarCreateTaskTool(backend),
    createCalendarUpdateTaskTool(backend),
    createCalendarMoveTaskTool(backend),
    createCalendarClearCompletedTasksTool(backend),
    createCalendarDeleteTaskTool(backend),
  ];
}

export const googleCalendarTools: ToolDefinition[] = createGoogleCalendarTools();

function createCalendarAccountTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "Inspect whether Google Calendar is installed and connected without exposing tokens.",
    execute: async () => {
      try {
        const state = await backend.account();
        return {
          content: formatCalendarAccountState(state),
          data: state as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Google Calendar account state."));
      }
    },
    id: "calendar_account",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    title: "Check Google Calendar account",
  });
}

function createCalendarListCalendarsTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "List visible Google calendars for the connected account. Use this before targeting a non-primary calendar.",
    execute: async (args) => {
      try {
        const response = await backend.listCalendars(optionalStringArg(args.accountEmail));
        return {
          content: formatCalendarList(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list Google calendars."));
      }
    },
    id: "calendar_list_calendars",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
      },
      type: "object",
    },
    title: "List Google calendars",
  });
}

function createCalendarSearchEventsTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description:
      "Search or list Google Calendar events. Use for agendas, meeting lookups, date ranges, attendee/topic/location queries, and schedule review.",
    execute: async (args) => {
      try {
        const response = await backend.listEvents({
          accountEmail: optionalStringArg(args.accountEmail),
          calendarId: optionalStringArg(args.calendarId),
          includeDeleted: booleanArg(args.includeDeleted),
          maxResults: integerArg(args.maxResults, 10, 1, 50),
          orderBy: orderByArg(args.orderBy),
          pageToken: optionalStringArg(args.pageToken),
          query: optionalStringArg(args.query),
          singleEvents: args.singleEvents === false ? false : true,
          timeMax: optionalStringArg(args.timeMax),
          timeMin: optionalStringArg(args.timeMin),
          timeZone: optionalStringArg(args.timeZone),
        });

        return {
          content: formatEventList(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not search Google Calendar events."));
      }
    },
    id: "calendar_search_events",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarId: calendarIdSchema(),
        includeDeleted: { description: "Include deleted/cancelled events.", type: "boolean" },
        maxResults: { maximum: 50, minimum: 1, type: "integer" },
        orderBy: { enum: ["startTime", "updated"], type: "string" },
        pageToken: { minLength: 1, type: "string" },
        query: { description: "Text query matched by Google Calendar, such as a meeting title, person, location, or topic.", minLength: 1, type: "string" },
        singleEvents: { description: "Expand recurring events into instances.", type: "boolean" },
        timeMax: { description: "Exclusive upper bound as an RFC3339 timestamp.", minLength: 1, type: "string" },
        timeMin: { description: "Inclusive lower bound as an RFC3339 timestamp.", minLength: 1, type: "string" },
        timeZone: { description: "IANA timezone for returned event times.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "Search Google Calendar events",
  });
}

function createCalendarGetEventTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "Read one Google Calendar event by event id. Use before detailed event reasoning or any update/delete.",
    execute: async (args) => {
      const eventId = stringArg(args.eventId);
      if (!eventId) {
        return createErrorResult("calendar_get_event requires an eventId.");
      }

      try {
        const event = await backend.getEvent({
          accountEmail: optionalStringArg(args.accountEmail),
          calendarId: optionalStringArg(args.calendarId),
          eventId,
        });
        return {
          content: formatEventDetail(event),
          data: event as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read Google Calendar event."));
      }
    },
    id: "calendar_get_event",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarId: calendarIdSchema(),
        eventId: { minLength: 1, type: "string" },
      },
      required: ["eventId"],
      type: "object",
    },
    title: "Read Google Calendar event",
  });
}

function createCalendarFreeBusyTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description:
      "Check free/busy blocks for Google Calendar without reading event titles. Use when the user asks about availability, open slots, or scheduling windows.",
    execute: async (args) => {
      const timeMin = stringArg(args.timeMin);
      const timeMax = stringArg(args.timeMax);
      if (!timeMin || !timeMax) {
        return createErrorResult("calendar_free_busy requires timeMin and timeMax RFC3339 timestamps.");
      }

      try {
        const response = await backend.freeBusy({
          accountEmail: optionalStringArg(args.accountEmail),
          calendarIds: stringArrayArg(args.calendarIds),
          timeMax,
          timeMin,
          timeZone: optionalStringArg(args.timeZone),
        });
        return {
          content: formatFreeBusy(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not check Google Calendar free/busy."));
      }
    },
    id: "calendar_free_busy",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarIds: { description: "Calendar ids to check. Omit to check primary.", items: { type: "string" }, type: "array" },
        timeMax: { description: "Exclusive upper bound as an RFC3339 timestamp.", minLength: 1, type: "string" },
        timeMin: { description: "Inclusive lower bound as an RFC3339 timestamp.", minLength: 1, type: "string" },
        timeZone: { description: "IANA timezone for the request.", minLength: 1, type: "string" },
      },
      required: ["timeMin", "timeMax"],
      type: "object",
    },
    title: "Check Google Calendar free/busy",
  });
}

function createCalendarCreateEventTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description:
      "Create a Google Calendar event. Supports title, time, attendees, Meet links, and advanced Event resource fields through extra.",
    execute: async (args) => {
      const summary = stringArg(args.summary);
      const start = eventDateTimeArg(args.start);
      const end = eventDateTimeArg(args.end);
      if (!summary || !start || !end) {
        return createErrorResult("calendar_create_event requires summary, start, and end.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Create Google Calendar event",
          `Calendar: ${optionalStringArg(args.calendarId) || "primary"}`,
          `Title: ${summary}`,
          `Start: ${formatInputTime(start)}`,
          `End: ${formatInputTime(end)}`,
          optionalStringArg(args.location) ? `Location: ${optionalStringArg(args.location)}` : undefined,
          formatAttendeePreview(attendeesArg(args.attendees)),
          args.createMeet === true ? "Google Meet: create link" : undefined,
          objectArg(args.extra) ? "Advanced event fields: provided" : undefined,
        ]);
      }

      try {
        const response = await backend.createEvent({
          accountEmail: optionalStringArg(args.accountEmail),
          attendees: attendeesArg(args.attendees),
          calendarId: optionalStringArg(args.calendarId),
          createMeet: booleanArg(args.createMeet),
          description: optionalStringArg(args.description),
          end,
          extra: objectArg(args.extra),
          location: optionalStringArg(args.location),
          sendUpdates: sendUpdatesArg(args.sendUpdates),
          start,
          summary,
        });

        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create Google Calendar event."));
      }
    },
    id: "calendar_create_event",
    inputSchema: createEventSchema(),
    scheduler: { mode: "exclusive" },
    title: "Create Google Calendar event",
  });
}

function createCalendarUpdateEventTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description:
      "Update a Google Calendar event by event id. Supports core fields and advanced Event resource fields through extra.",
    execute: async (args) => {
      const eventId = stringArg(args.eventId);
      if (!eventId) {
        return createErrorResult("calendar_update_event requires an eventId.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Update Google Calendar event",
          `Calendar: ${optionalStringArg(args.calendarId) || "primary"}`,
          `Event id: ${eventId}`,
          optionalStringArg(args.summary) ? `Title: ${optionalStringArg(args.summary)}` : undefined,
          eventDateTimeArg(args.start) ? `Start: ${formatInputTime(eventDateTimeArg(args.start)!)}` : undefined,
          eventDateTimeArg(args.end) ? `End: ${formatInputTime(eventDateTimeArg(args.end)!)}` : undefined,
          optionalStringArg(args.location) ? `Location: ${optionalStringArg(args.location)}` : undefined,
          formatAttendeePreview(attendeesArg(args.attendees)),
          args.createMeet === true ? "Google Meet: create link" : undefined,
          objectArg(args.extra) ? "Advanced event fields: provided" : undefined,
        ]);
      }

      try {
        const request: CalendarUpdateEventRequest = {
          accountEmail: optionalStringArg(args.accountEmail),
          attendees: attendeesArg(args.attendees),
          calendarId: optionalStringArg(args.calendarId),
          createMeet: booleanArg(args.createMeet),
          description: optionalStringArg(args.description),
          end: eventDateTimeArg(args.end),
          eventId,
          extra: objectArg(args.extra),
          location: optionalStringArg(args.location),
          sendUpdates: sendUpdatesArg(args.sendUpdates),
          start: eventDateTimeArg(args.start),
          status: eventStatusArg(args.status),
          summary: optionalStringArg(args.summary),
        };
        const response = await backend.updateEvent(request);

        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not update Google Calendar event."));
      }
    },
    id: "calendar_update_event",
    inputSchema: updateEventSchema(),
    scheduler: { mode: "exclusive" },
    title: "Update Google Calendar event",
  });
}

function createCalendarDeleteEventTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description: "Delete a Google Calendar event by event id. This must only run after visible user confirmation.",
    execute: async (args) => {
      const eventId = stringArg(args.eventId);
      if (!eventId) {
        return createErrorResult("calendar_delete_event requires an eventId.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Delete Google Calendar event",
          `Calendar: ${optionalStringArg(args.calendarId) || "primary"}`,
          `Event id: ${eventId}`,
          "This removes the event from the selected calendar.",
        ]);
      }

      try {
        const response = await backend.deleteEvent({
          accountEmail: optionalStringArg(args.accountEmail),
          calendarId: optionalStringArg(args.calendarId),
          eventId,
          sendUpdates: sendUpdatesArg(args.sendUpdates),
        });
        return {
          content: formatActionResponse(response),
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not delete Google Calendar event."));
      }
    },
    id: "calendar_delete_event",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarId: calendarIdSchema(),
        eventId: { minLength: 1, type: "string" },
        sendUpdates: { enum: ["all", "externalOnly", "none"], type: "string" },
      },
      required: ["eventId"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Delete Google Calendar event",
  });
}

function createCalendarCreateCalendarTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Create a secondary Google Calendar. Use when the user asks for a new calendar, not just a new event.",
    execute: async (args) => {
      const summary = stringArg(args.summary);
      if (!summary) {
        return createErrorResult("calendar_create_calendar requires summary.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Create Google Calendar",
          `Name: ${summary}`,
          optionalStringArg(args.timeZone) ? `Timezone: ${optionalStringArg(args.timeZone)}` : undefined,
          optionalStringArg(args.description) ? `Description: ${optionalStringArg(args.description)}` : undefined,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: pickDefined({
            description: optionalStringArg(args.description),
            location: optionalStringArg(args.location),
            summary,
            timeZone: optionalStringArg(args.timeZone),
          }),
          method: "POST",
          path: "calendars",
          service: "calendar",
        }),
        "Could not create Google Calendar.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_create_calendar",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        description: { minLength: 1, type: "string" },
        dryRun: { type: "boolean" },
        location: { minLength: 1, type: "string" },
        summary: { minLength: 1, type: "string" },
        timeZone: { minLength: 1, type: "string" },
      },
      required: ["summary"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Create Google Calendar",
  });
}

function createCalendarUpdateCalendarTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Update Google Calendar metadata such as name, description, location, or timezone.",
    execute: async (args) => {
      const calendarId = stringArg(args.calendarId);
      const body = pickDefined({
        description: optionalStringArg(args.description),
        location: optionalStringArg(args.location),
        summary: optionalStringArg(args.summary),
        timeZone: optionalStringArg(args.timeZone),
      });
      if (!calendarId) {
        return createErrorResult("calendar_update_calendar requires calendarId.");
      }
      if (Object.keys(body).length === 0) {
        return createErrorResult("calendar_update_calendar requires at least one calendar field to update.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Update Google Calendar",
          `Calendar: ${calendarId}`,
          optionalStringArg(args.summary) ? `Name: ${optionalStringArg(args.summary)}` : undefined,
          optionalStringArg(args.timeZone) ? `Timezone: ${optionalStringArg(args.timeZone)}` : undefined,
          optionalStringArg(args.description) ? `Description: ${optionalStringArg(args.description)}` : undefined,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body,
          method: "PATCH",
          path: `calendars/${encodePathSegment(calendarId)}`,
          service: "calendar",
        }),
        "Could not update Google Calendar.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_update_calendar",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarId: calendarIdSchema(),
        description: { minLength: 1, type: "string" },
        dryRun: { type: "boolean" },
        location: { minLength: 1, type: "string" },
        summary: { minLength: 1, type: "string" },
        timeZone: { minLength: 1, type: "string" },
      },
      required: ["calendarId"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Update Google Calendar",
  });
}

function createCalendarDeleteCalendarTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description: "Delete a secondary Google Calendar by id. This cannot delete the user's primary calendar.",
    execute: async (args) => {
      const calendarId = stringArg(args.calendarId);
      if (!calendarId) {
        return createErrorResult("calendar_delete_calendar requires calendarId.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Delete Google Calendar",
          `Calendar: ${calendarId}`,
          "This deletes the secondary calendar. Primary calendars must be cleared through Google's clear endpoint, not deleted.",
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "DELETE",
          path: `calendars/${encodePathSegment(calendarId)}`,
          service: "calendar",
        }),
        "Could not delete Google Calendar.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_delete_calendar",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        calendarId: calendarIdSchema(),
        dryRun: { type: "boolean" },
      },
      required: ["calendarId"],
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Delete Google Calendar",
  });
}

function createCalendarApiReadTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description:
      "Call any Google Calendar or Google Tasks GET endpoint not covered by a higher-level tool, such as colors, settings, ACL reads, event instances, or raw task resources. Use relative API paths only.",
    execute: async (args) => {
      const service = calendarApiServiceArg(args.service);
      const path = stringArg(args.path);
      if (!service || !path) {
        return createErrorResult("calendar_api_read requires service and path.");
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "GET",
          path,
          query: objectArg(args.query),
          service,
        }),
        "Could not read Google Calendar/Tasks API.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_api_read",
    inputSchema: googleApiSchema(["GET"]),
    title: "Read Google Calendar or Tasks API",
  });
}

function createCalendarApiWriteTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description:
      "Call any Google Calendar or Google Tasks POST, PATCH, or PUT endpoint not covered by a higher-level tool, including ACL sharing, CalendarList updates, event import/move/quickAdd, task list updates, or advanced event properties.",
    execute: async (args) => {
      const service = calendarApiServiceArg(args.service);
      const method = calendarApiWriteMethodArg(args.method);
      const path = stringArg(args.path);
      if (!service || !method || !path) {
        return createErrorResult("calendar_api_write requires service, method, and path.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Call Google Calendar/Tasks write API",
          `Service: ${service}`,
          `Method: ${method}`,
          `Path: ${path}`,
          objectArg(args.body) ? "Body: provided" : undefined,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: args.body,
          method,
          path,
          query: objectArg(args.query),
          service,
        }),
        "Could not write Google Calendar/Tasks API.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_api_write",
    inputSchema: googleApiSchema(["POST", "PATCH", "PUT"]),
    scheduler: { mode: "exclusive" },
    title: "Write Google Calendar or Tasks API",
  });
}

function createCalendarApiDeleteTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description:
      "Call any Google Calendar or Google Tasks DELETE endpoint not covered by a higher-level tool. Use only when the user explicitly asked to delete/remove something.",
    execute: async (args) => {
      const service = calendarApiServiceArg(args.service);
      const path = stringArg(args.path);
      if (!service || !path) {
        return createErrorResult("calendar_api_delete requires service and path.");
      }

      if (isDryRun(args)) {
        return createApprovalPreview([
          "Delete through Google Calendar/Tasks API",
          `Service: ${service}`,
          `Path: ${path}`,
        ]);
      }

      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "DELETE",
          path,
          query: objectArg(args.query),
          service,
        }),
        "Could not delete through Google Calendar/Tasks API.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_api_delete",
    inputSchema: googleApiSchema(["DELETE"]),
    scheduler: { mode: "exclusive" },
    title: "Delete via Google Calendar or Tasks API",
  });
}

function createCalendarListTaskListsTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "List Google Tasks task lists for the connected account.",
    execute: async (args) => executeApiTool(
      () => backend.apiRequest({
        accountEmail: optionalStringArg(args.accountEmail),
        method: "GET",
        path: "tasks/v1/users/@me/lists",
        query: pickDefined({
          maxResults: integerOrUndefinedArg(args.maxResults, 1, 100),
          pageToken: optionalStringArg(args.pageToken),
        }),
        service: "tasks",
      }),
      "Could not list Google Tasks lists.",
      formatTaskListsResponse,
    ),
    id: "calendar_list_task_lists",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        maxResults: { maximum: 100, minimum: 1, type: "integer" },
        pageToken: { minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "List Google Tasks lists",
  });
}

function createCalendarListTasksTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "List Google Tasks tasks from a task list. Omit taskListId to use @default.",
    execute: async (args) => {
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "GET",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks`,
          query: pickDefined({
            dueMax: optionalStringArg(args.dueMax),
            dueMin: optionalStringArg(args.dueMin),
            maxResults: integerOrUndefinedArg(args.maxResults, 1, 100),
            pageToken: optionalStringArg(args.pageToken),
            showCompleted: booleanArg(args.showCompleted),
            showDeleted: booleanArg(args.showDeleted),
            showHidden: booleanArg(args.showHidden),
            updatedMin: optionalStringArg(args.updatedMin),
          }),
          service: "tasks",
        }),
        "Could not list Google Tasks.",
        formatTasksResponse,
      );
    },
    id: "calendar_list_tasks",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        dueMax: { minLength: 1, type: "string" },
        dueMin: { minLength: 1, type: "string" },
        maxResults: { maximum: 100, minimum: 1, type: "integer" },
        pageToken: { minLength: 1, type: "string" },
        showCompleted: { type: "boolean" },
        showDeleted: { type: "boolean" },
        showHidden: { type: "boolean" },
        taskListId: taskListIdSchema(),
        updatedMin: { minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "List Google Tasks",
  });
}

function createCalendarGetTaskTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarReadTool({
    description: "Read one Google Tasks task by task list id and task id.",
    execute: async (args) => {
      const taskId = stringArg(args.taskId);
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      if (!taskId) {
        return createErrorResult("calendar_get_task requires taskId.");
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "GET",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks/${encodePathSegment(taskId)}`,
          service: "tasks",
        }),
        "Could not read Google Task.",
        formatTaskResponse,
      );
    },
    id: "calendar_get_task",
    inputSchema: taskIdInputSchema(),
    title: "Read Google Task",
  });
}

function createCalendarCreateTaskListTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Create a Google Tasks task list.",
    execute: async (args) => {
      const title = stringArg(args.title);
      if (!title) {
        return createErrorResult("calendar_create_task_list requires title.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview(["Create Google Tasks list", `Title: ${title}`]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: { title },
          method: "POST",
          path: "tasks/v1/users/@me/lists",
          service: "tasks",
        }),
        "Could not create Google Tasks list.",
        formatTaskListResponse,
      );
    },
    id: "calendar_create_task_list",
    inputSchema: titleInputSchema(),
    scheduler: { mode: "exclusive" },
    title: "Create Google Tasks list",
  });
}

function createCalendarUpdateTaskListTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Rename or update a Google Tasks task list.",
    execute: async (args) => {
      const taskListId = stringArg(args.taskListId);
      const title = stringArg(args.title);
      if (!taskListId || !title) {
        return createErrorResult("calendar_update_task_list requires taskListId and title.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview(["Update Google Tasks list", `Task list: ${taskListId}`, `Title: ${title}`]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: { title },
          method: "PATCH",
          path: `tasks/v1/users/@me/lists/${encodePathSegment(taskListId)}`,
          service: "tasks",
        }),
        "Could not update Google Tasks list.",
        formatTaskListResponse,
      );
    },
    id: "calendar_update_task_list",
    inputSchema: taskListTitleInputSchema(),
    scheduler: { mode: "exclusive" },
    title: "Update Google Tasks list",
  });
}

function createCalendarDeleteTaskListTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description: "Delete a Google Tasks task list.",
    execute: async (args) => {
      const taskListId = stringArg(args.taskListId);
      if (!taskListId) {
        return createErrorResult("calendar_delete_task_list requires taskListId.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview(["Delete Google Tasks list", `Task list: ${taskListId}`]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "DELETE",
          path: `tasks/v1/users/@me/lists/${encodePathSegment(taskListId)}`,
          service: "tasks",
        }),
        "Could not delete Google Tasks list.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_delete_task_list",
    inputSchema: taskListInputSchema(),
    scheduler: { mode: "exclusive" },
    title: "Delete Google Tasks list",
  });
}

function createCalendarCreateTaskTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Create a Google Tasks task. Omit taskListId to use @default.",
    execute: async (args) => {
      const title = stringArg(args.title);
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      if (!title) {
        return createErrorResult("calendar_create_task requires title.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview([
          "Create Google Task",
          `Task list: ${taskListId}`,
          `Title: ${title}`,
          optionalStringArg(args.due) ? `Due: ${optionalStringArg(args.due)}` : undefined,
          optionalStringArg(args.notes) ? `Notes: ${optionalStringArg(args.notes)}` : undefined,
        ]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body: pickDefined({
            due: optionalStringArg(args.due),
            notes: optionalStringArg(args.notes),
            status: taskStatusArg(args.status),
            title,
          }),
          method: "POST",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks`,
          query: pickDefined({
            parent: optionalStringArg(args.parent),
            previous: optionalStringArg(args.previous),
          }),
          service: "tasks",
        }),
        "Could not create Google Task.",
        formatTaskResponse,
      );
    },
    id: "calendar_create_task",
    inputSchema: taskWriteSchema(["title"]),
    scheduler: { mode: "exclusive" },
    title: "Create Google Task",
  });
}

function createCalendarUpdateTaskTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Update a Google Tasks task title, notes, due date, or completion status.",
    execute: async (args) => {
      const taskId = stringArg(args.taskId);
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      const body = pickDefined({
        completed: optionalStringArg(args.completed),
        deleted: booleanArg(args.deleted),
        due: optionalStringArg(args.due),
        notes: optionalStringArg(args.notes),
        status: taskStatusArg(args.status),
        title: optionalStringArg(args.title),
      });
      if (!taskId) {
        return createErrorResult("calendar_update_task requires taskId.");
      }
      if (Object.keys(body).length === 0) {
        return createErrorResult("calendar_update_task requires at least one task field.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview([
          "Update Google Task",
          `Task list: ${taskListId}`,
          `Task: ${taskId}`,
          optionalStringArg(args.title) ? `Title: ${optionalStringArg(args.title)}` : undefined,
          optionalStringArg(args.due) ? `Due: ${optionalStringArg(args.due)}` : undefined,
          taskStatusArg(args.status) ? `Status: ${taskStatusArg(args.status)}` : undefined,
        ]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          body,
          method: "PATCH",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks/${encodePathSegment(taskId)}`,
          service: "tasks",
        }),
        "Could not update Google Task.",
        formatTaskResponse,
      );
    },
    id: "calendar_update_task",
    inputSchema: taskWriteSchema(["taskId"]),
    scheduler: { mode: "exclusive" },
    title: "Update Google Task",
  });
}

function createCalendarMoveTaskTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarMutatingTool({
    description: "Move a Google Tasks task under a parent task or after a sibling task.",
    execute: async (args) => {
      const taskId = stringArg(args.taskId);
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      if (!taskId) {
        return createErrorResult("calendar_move_task requires taskId.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview([
          "Move Google Task",
          `Task list: ${taskListId}`,
          `Task: ${taskId}`,
          optionalStringArg(args.parent) ? `Parent: ${optionalStringArg(args.parent)}` : undefined,
          optionalStringArg(args.previous) ? `After: ${optionalStringArg(args.previous)}` : undefined,
        ]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "POST",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks/${encodePathSegment(taskId)}/move`,
          query: pickDefined({
            parent: optionalStringArg(args.parent),
            previous: optionalStringArg(args.previous),
          }),
          service: "tasks",
        }),
        "Could not move Google Task.",
        formatTaskResponse,
      );
    },
    id: "calendar_move_task",
    inputSchema: {
      ...taskIdInputSchema(),
      properties: {
        ...taskIdInputSchema().properties,
        dryRun: { type: "boolean" },
        parent: { minLength: 1, type: "string" },
        previous: { minLength: 1, type: "string" },
      },
    },
    scheduler: { mode: "exclusive" },
    title: "Move Google Task",
  });
}

function createCalendarClearCompletedTasksTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description: "Clear all completed Google Tasks from a task list. Omit taskListId to use @default.",
    execute: async (args) => {
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      if (isDryRun(args)) {
        return createApprovalPreview(["Clear completed Google Tasks", `Task list: ${taskListId}`]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "POST",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/clear`,
          service: "tasks",
        }),
        "Could not clear completed Google Tasks.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_clear_completed_tasks",
    inputSchema: {
      additionalProperties: false,
      properties: {
        accountEmail: calendarAccountEmailSchema(),
        dryRun: { type: "boolean" },
        taskListId: taskListIdSchema(),
      },
      type: "object",
    },
    scheduler: { mode: "exclusive" },
    title: "Clear completed Google Tasks",
  });
}

function createCalendarDeleteTaskTool(backend: GoogleCalendarToolBackend): ToolDefinition {
  return calendarDestructiveTool({
    description: "Delete a Google Tasks task.",
    execute: async (args) => {
      const taskId = stringArg(args.taskId);
      const taskListId = optionalStringArg(args.taskListId) || "@default";
      if (!taskId) {
        return createErrorResult("calendar_delete_task requires taskId.");
      }
      if (isDryRun(args)) {
        return createApprovalPreview(["Delete Google Task", `Task list: ${taskListId}`, `Task: ${taskId}`]);
      }
      return executeApiTool(
        () => backend.apiRequest({
          accountEmail: optionalStringArg(args.accountEmail),
          method: "DELETE",
          path: `tasks/v1/lists/${encodePathSegment(taskListId)}/tasks/${encodePathSegment(taskId)}`,
          service: "tasks",
        }),
        "Could not delete Google Task.",
        formatGenericApiResponse,
      );
    },
    id: "calendar_delete_task",
    inputSchema: {
      ...taskIdInputSchema(),
      properties: {
        ...taskIdInputSchema().properties,
        dryRun: { type: "boolean" },
      },
    },
    scheduler: { mode: "exclusive" },
    title: "Delete Google Task",
  });
}

function calendarReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "calendar", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function calendarMutatingTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "calendar", version: 1 },
    permission: "mutating",
    risk: "mutating",
  };
}

function calendarDestructiveTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "calendar", version: 1 },
    permission: "destructive",
    risk: "destructive",
  };
}

function formatCalendarAccountState(state: CalendarConnectionState) {
  const accounts = state.accounts ?? [];

  if (accounts.length > 0) {
    return [
      `Google Calendar connected accounts: ${accounts.length}/${state.maxAccounts || 6}.`,
      state.activeAccountEmail ? `Active account: ${state.activeAccountEmail}` : undefined,
      "",
      accounts
        .map((account, index) => {
          const scopes = account.scopes.length ? account.scopes.join(", ") : "none reported";
          return `${index + 1}. ${account.email}${account.active ? " (active)" : ""} | Scopes: ${scopes}`;
        })
        .join("\n"),
      "",
      "Use accountEmail in Calendar tool calls to target a specific connected account; omit it to use the active account.",
    ].filter(Boolean).join("\n");
  }

  return state.pluginInstalled
    ? "Google Calendar plugin is installed, but Google account access is not connected."
    : "Google Calendar plugin is not installed.";
}

function formatCalendarList(response: CalendarListResponse) {
  if (response.calendars.length === 0) {
    return "No Google calendars returned.";
  }

  return response.calendars.map((calendar, index) => [
    `${index + 1}. ${calendar.summary || calendar.id} (${calendar.id})`,
    calendar.primary ? "Primary" : undefined,
    calendar.accessRole ? `Access: ${calendar.accessRole}` : undefined,
    calendar.timeZone ? `Timezone: ${calendar.timeZone}` : undefined,
  ].filter(Boolean).join(" | ")).join("\n");
}

function formatEventList(response: CalendarEventListResponse) {
  if (response.events.length === 0) {
    return `No Google Calendar events returned for ${response.calendarId}.`;
  }

  return [
    `Google Calendar events for ${response.calendarId}: ${response.events.length}`,
    response.summary ? `Calendar: ${response.summary}` : undefined,
    response.timeZone ? `Timezone: ${response.timeZone}` : undefined,
    "",
    response.events.map((event, index) => formatEventSummary(event, index + 1)).join("\n\n"),
    response.nextPageToken ? `\nNext page token: ${response.nextPageToken}` : "",
  ].filter(Boolean).join("\n");
}

function formatEventSummary(event: CalendarEventSummary, index?: number) {
  return [
    `${index ? `${index}. ` : ""}${event.summary || "(no title)"}`,
    event.accountEmail ? `Account: ${event.accountEmail}` : undefined,
    `Calendar: ${event.calendarId} | Event: ${event.id}`,
    event.status ? `Status: ${event.status}` : undefined,
    event.start ? `Start: ${formatEventTime(event.start)}` : undefined,
    event.end ? `End: ${formatEventTime(event.end)}` : undefined,
    event.location ? `Location: ${event.location}` : undefined,
    event.attendees.length ? `Attendees: ${event.attendees.map(formatAttendee).join(", ")}` : undefined,
    event.conferenceLink ? `Conference: ${event.conferenceLink}` : undefined,
    event.htmlLink ? `Open in Calendar: ${event.htmlLink}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatEventDetail(event: CalendarEventSummary) {
  return [
    formatEventSummary(event),
    event.description ? `Description:\n${event.description}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatFreeBusy(response: CalendarFreeBusyResponse) {
  return [
    `Google Calendar free/busy from ${response.timeMin} to ${response.timeMax}`,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    "",
    response.calendars.map((calendar, index) => {
      const busy = calendar.busy.length
        ? calendar.busy.map((block) => `${block.start} to ${block.end}`).join("; ")
        : "no busy blocks";
      const errors = calendar.errors.length ? ` Errors: ${calendar.errors.join(", ")}` : "";
      return `${index + 1}. ${calendar.id}: ${busy}${errors}`;
    }).join("\n"),
  ].filter(Boolean).join("\n");
}

function formatActionResponse(response: CalendarActionResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    `Calendar: ${response.calendarId}`,
    response.event ? formatEventSummary(response.event) : undefined,
  ].filter(Boolean).join("\n");
}

function formatEventTime(time: { date?: string; dateTime?: string; timeZone?: string }) {
  return [time.dateTime || time.date, time.timeZone].filter(Boolean).join(" ");
}

function formatInputTime(time: CalendarEventDateTimeInput) {
  return [time.dateTime || time.date, time.timeZone].filter(Boolean).join(" ");
}

function formatAttendee(attendee: { displayName?: string; email?: string; responseStatus?: string }) {
  return [
    attendee.displayName ? `${attendee.displayName}${attendee.email ? ` <${attendee.email}>` : ""}` : attendee.email,
    attendee.responseStatus ? `(${attendee.responseStatus})` : undefined,
  ].filter(Boolean).join(" ");
}

function formatAttendeePreview(attendees: CalendarCreateEventRequest["attendees"]) {
  return attendees?.length ? `Attendees: ${attendees.map((attendee) => attendee.email).join(", ")}` : undefined;
}

function createApprovalPreview(lines: Array<string | undefined>): ToolExecutionResult {
  return {
    content: lines.filter(Boolean).join("\n"),
    ok: true,
  };
}

async function executeApiTool(
  action: () => Promise<CalendarGoogleApiResponse>,
  fallback: string,
  formatter: (response: CalendarGoogleApiResponse) => string,
): Promise<ToolExecutionResult> {
  try {
    const response = await action();
    return {
      content: formatter(response),
      data: response as unknown as JsonValue,
      ok: true,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, fallback));
  }
}

function formatGenericApiResponse(response: CalendarGoogleApiResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    `Service: ${response.service} | ${response.method} ${response.path}`,
    formatApiDataPreview(response.data),
  ].filter(Boolean).join("\n");
}

function formatTaskListsResponse(response: CalendarGoogleApiResponse) {
  const items = arrayItems(response.data);
  if (items.length === 0) {
    return "No Google Tasks lists returned.";
  }

  return [
    `Google Tasks lists: ${items.length}`,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    "",
    items.map((item, index) => [
      `${index + 1}. ${jsonString(item, "title") || "(untitled list)"}`,
      jsonString(item, "id") ? `Id: ${jsonString(item, "id")}` : undefined,
      jsonString(item, "updated") ? `Updated: ${jsonString(item, "updated")}` : undefined,
    ].filter(Boolean).join(" | ")).join("\n"),
    nextPageToken(response.data),
  ].filter(Boolean).join("\n");
}

function formatTaskListResponse(response: CalendarGoogleApiResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    `Task list: ${jsonString(response.data, "title") || jsonString(response.data, "id") || "(unknown)"}`,
    jsonString(response.data, "id") ? `Id: ${jsonString(response.data, "id")}` : undefined,
    jsonString(response.data, "updated") ? `Updated: ${jsonString(response.data, "updated")}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatTasksResponse(response: CalendarGoogleApiResponse) {
  const items = arrayItems(response.data);
  if (items.length === 0) {
    return "No Google Tasks returned.";
  }

  return [
    `Google Tasks: ${items.length}`,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    "",
    items.map((task, index) => formatTask(task, index + 1)).join("\n\n"),
    nextPageToken(response.data),
  ].filter(Boolean).join("\n");
}

function formatTaskResponse(response: CalendarGoogleApiResponse) {
  return [
    response.message,
    response.accountEmail ? `Account: ${response.accountEmail}` : undefined,
    formatTask(response.data),
  ].filter(Boolean).join("\n");
}

function formatTask(task: unknown, index?: number) {
  return [
    `${index ? `${index}. ` : ""}${jsonString(task, "title") || "(untitled task)"}`,
    jsonString(task, "id") ? `Task id: ${jsonString(task, "id")}` : undefined,
    jsonString(task, "status") ? `Status: ${jsonString(task, "status")}` : undefined,
    jsonString(task, "due") ? `Due: ${jsonString(task, "due")}` : undefined,
    jsonString(task, "completed") ? `Completed: ${jsonString(task, "completed")}` : undefined,
    jsonString(task, "notes") ? `Notes: ${jsonString(task, "notes")}` : undefined,
    jsonString(task, "webViewLink") ? `Open in Tasks: ${jsonString(task, "webViewLink")}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatApiDataPreview(data: unknown) {
  if (data === null || data === undefined) {
    return "No response body.";
  }

  const text = JSON.stringify(data, null, 2);
  return text.length > 4_000 ? `${text.slice(0, 4_000)}\n...truncated` : text;
}

function arrayItems(data: unknown): unknown[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [];
  }

  const items = (data as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function jsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const next = (value as Record<string, unknown>)[key];
  return typeof next === "string" && next.trim() ? next.trim() : undefined;
}

function nextPageToken(data: unknown) {
  const token = jsonString(data, "nextPageToken");
  return token ? `Next page token: ${token}` : undefined;
}

function isDryRun(args: Record<string, unknown>) {
  return args.dryRun === true;
}

function calendarAccountEmailSchema() {
  return {
    description: "Connected Google account email to use. Omit this to use the active Calendar account.",
    minLength: 3,
    type: "string",
  };
}

function calendarIdSchema() {
  return {
    description: "Google Calendar id. Omit this to use primary.",
    minLength: 1,
    type: "string",
  };
}

function taskListIdSchema() {
  return {
    description: "Google Tasks task list id. Omit this on task tools to use @default.",
    minLength: 1,
    type: "string",
  };
}

function googleApiSchema(methods: string[]) {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      body: {
        description: "JSON request body for write methods.",
        type: "object",
      },
      dryRun: { type: "boolean" },
      method: { enum: methods, type: "string" },
      path: {
        description: "Relative Google API path, such as colors, users/me/settings, calendars/primary/acl, or tasks/v1/users/@me/lists.",
        minLength: 1,
        type: "string",
      },
      query: {
        additionalProperties: true,
        description: "Query parameters. Arrays repeat the same query key.",
        type: "object",
      },
      service: { enum: ["calendar", "tasks"], type: "string" },
    },
    required: methods.length === 1 && methods[0] === "GET" ? ["service", "path"] : ["service", "method", "path"],
    type: "object",
  };
}

function titleInputSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      dryRun: { type: "boolean" },
      title: { minLength: 1, type: "string" },
    },
    required: ["title"],
    type: "object",
  };
}

function taskListInputSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      dryRun: { type: "boolean" },
      taskListId: taskListIdSchema(),
    },
    required: ["taskListId"],
    type: "object",
  };
}

function taskListTitleInputSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      dryRun: { type: "boolean" },
      taskListId: taskListIdSchema(),
      title: { minLength: 1, type: "string" },
    },
    required: ["taskListId", "title"],
    type: "object",
  };
}

function taskIdInputSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      taskId: { minLength: 1, type: "string" },
      taskListId: taskListIdSchema(),
    },
    required: ["taskId"],
    type: "object",
  };
}

function taskWriteSchema(required: string[]) {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      completed: { description: "Completion timestamp as RFC3339.", minLength: 1, type: "string" },
      deleted: { type: "boolean" },
      dryRun: { type: "boolean" },
      due: { description: "Due date as RFC3339. Google Tasks stores only date information.", minLength: 1, type: "string" },
      notes: { minLength: 1, type: "string" },
      parent: { minLength: 1, type: "string" },
      previous: { minLength: 1, type: "string" },
      status: { enum: ["completed", "needsAction"], type: "string" },
      taskId: { minLength: 1, type: "string" },
      taskListId: taskListIdSchema(),
      title: { minLength: 1, type: "string" },
    },
    required,
    type: "object",
  };
}

function eventDateTimeSchema() {
  return {
    additionalProperties: false,
    properties: {
      date: { description: "All-day date in YYYY-MM-DD format.", minLength: 1, type: "string" },
      dateTime: { description: "Timed event value as an RFC3339 timestamp.", minLength: 1, type: "string" },
      timeZone: { description: "IANA timezone such as America/New_York.", minLength: 1, type: "string" },
    },
    type: "object",
  };
}

function attendeeSchema() {
  return {
    additionalProperties: false,
    properties: {
      displayName: { minLength: 1, type: "string" },
      email: { minLength: 3, type: "string" },
      optional: { type: "boolean" },
      responseStatus: { enum: ["accepted", "declined", "needsAction", "tentative"], type: "string" },
    },
    required: ["email"],
    type: "object",
  };
}

function createEventSchema() {
  return {
    additionalProperties: false,
    properties: {
      accountEmail: calendarAccountEmailSchema(),
      attendees: { items: attendeeSchema(), type: "array" },
      calendarId: calendarIdSchema(),
      createMeet: { type: "boolean" },
      description: { minLength: 1, type: "string" },
      end: eventDateTimeSchema(),
      extra: {
        additionalProperties: true,
        description: "Advanced Google Calendar event resource fields such as recurrence, reminders, colorId, visibility, transparency, guestsCanModify, extendedProperties, attachments, source, workingLocationProperties, focusTimeProperties, or outOfOfficeProperties.",
        type: "object",
      },
      location: { minLength: 1, type: "string" },
      sendUpdates: { enum: ["all", "externalOnly", "none"], type: "string" },
      start: eventDateTimeSchema(),
      summary: { minLength: 1, type: "string" },
    },
    required: ["summary", "start", "end"],
    type: "object",
  };
}

function updateEventSchema() {
  return {
    ...createEventSchema(),
    properties: {
      ...createEventSchema().properties,
      eventId: { minLength: 1, type: "string" },
      status: { enum: ["cancelled", "confirmed", "tentative"], type: "string" },
      summary: { minLength: 1, type: "string" },
    },
    required: ["eventId"],
  };
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringArg(value: unknown) {
  const valueString = stringArg(value);
  return valueString || undefined;
}

function stringArrayArg(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const itemString = stringArg(item);
      return itemString ? [itemString] : [];
    });
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function booleanArg(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function integerOrUndefinedArg(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function objectArg(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function pickDefined(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/%40/g, "@");
}

function calendarApiServiceArg(value: unknown): CalendarGoogleApiRequest["service"] | undefined {
  return value === "calendar" || value === "tasks" ? value : undefined;
}

function calendarApiWriteMethodArg(value: unknown): "POST" | "PATCH" | "PUT" | undefined {
  return value === "PATCH" || value === "PUT" ? value : value === "POST" || value === undefined ? "POST" : undefined;
}

function eventDateTimeArg(value: unknown): CalendarEventDateTimeInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const date = optionalStringArg(input.date);
  const dateTime = optionalStringArg(input.dateTime);
  const timeZone = optionalStringArg(input.timeZone);

  if (!date && !dateTime) {
    return undefined;
  }

  return { date, dateTime, timeZone };
}

function attendeesArg(value: unknown): CalendarCreateEventRequest["attendees"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const input = item as Record<string, unknown>;
    const email = optionalStringArg(input.email);

    if (!email) {
      return [];
    }

    return [{
      displayName: optionalStringArg(input.displayName),
      email,
      optional: booleanArg(input.optional),
      responseStatus: responseStatusArg(input.responseStatus),
    }];
  });
}

function sendUpdatesArg(value: unknown): CalendarCreateEventRequest["sendUpdates"] {
  return value === "none" || value === "externalOnly" ? value : "all";
}

function responseStatusArg(value: unknown) {
  return value === "accepted" || value === "declined" || value === "needsAction" || value === "tentative" ? value : undefined;
}

function eventStatusArg(value: unknown): CalendarUpdateEventRequest["status"] {
  return value === "cancelled" || value === "confirmed" || value === "tentative" ? value : undefined;
}

function taskStatusArg(value: unknown) {
  return value === "completed" || value === "needsAction" ? value : undefined;
}

function orderByArg(value: unknown): CalendarListEventsRequest["orderBy"] {
  return value === "updated" ? "updated" : "startTime";
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
