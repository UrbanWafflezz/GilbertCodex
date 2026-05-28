# Google OAuth Setup

Last updated: May 28, 2026 for the v0.8.5 build.

Gilbert Codex uses a bring-your-own Google OAuth setup. Each user supplies their own Google Cloud Desktop OAuth Client ID and Client secret in Settings > Google before connecting Gmail, Google Calendar, or Tasks.

This keeps shared Google OAuth credentials out of the public codebase and lets personal testers use their own Google Cloud project while any future Gilbert-owned production Google project goes through verification separately.

## User Setup

1. Open Google Cloud Console.
2. Create a new project for Gilbert Codex personal use.
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Tasks API
4. Open Google Auth Platform.
5. Configure an External audience.
6. Fill in app name, support email, developer contact email, homepage, and privacy policy fields.
7. Add the Gmail and Calendar scopes shown in Gilbert Codex under Settings > Google.
8. Open Credentials.
9. Create an OAuth client.
10. Choose Desktop app.
11. Copy the Client ID and Client secret.
12. Paste both values into Gilbert Codex Settings > Google.
13. Save the Google setup.
14. While the Google app is in Testing, add the Google account as a test user under Audience.
15. Open Gilbert Codex Apps.
16. Install Gmail or Google Calendar.
17. Pick the Google account in the browser and approve the consent screen.

If Google shows an unverified-app warning, that is expected for a personal or testing Google Cloud project using sensitive or restricted scopes. Only continue for a Google Cloud project you control and trust.

## Production Notes

The app does not ship a shared Google OAuth client ID or client secret. If Gilbert later offers one first-party public Google OAuth app, that should use a separate production Google Cloud project with a configured OAuth consent screen, declared scopes, public support/privacy links, and OAuth verification for sensitive or restricted scopes before release notes claim broad public Gmail availability.

## Notes

- User-owned OAuth settings are stored locally per Gilbert user.
- The desktop storage layer protects the saved Google client secret before writing it to the local database.
- Existing connected accounts should be disconnected and reconnected after replacing the OAuth client, because Google refresh tokens are tied to the OAuth client that created them.
- Public production use with broad Gmail access still needs Google verification.
