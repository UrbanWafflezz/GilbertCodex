# Gmail Plugin Setup

Last updated: May 28, 2026 for the v0.8.5 build.

The user flow should stay simple:

1. Open Apps.
2. Choose Gmail.
3. Click Install Gmail.
4. Pick the Gmail account in the browser.
5. Approve the permission screen.
6. Return to Gilbert Codex when the browser says Gmail connected.

If Google OAuth is not configured yet, the Apps page opens Settings > Google automatically. Users should paste only their own Desktop OAuth Client ID and Client secret there. Users should never paste Google access tokens, refresh tokens, authorization codes, or downloaded credential JSON into Gilbert Codex.

Users can connect up to six Gmail accounts. Tool calls use the active account by default and can target another connected account with `accountEmail`.

Platform note: Gmail OAuth, account storage, and Gmail API calls use the shared desktop command/storage layer on Windows, macOS, and Linux. Windows is verified alpha; macOS and Linux still need packaged-app launch testing before Gmail is called fully verified there. See [Platform Support And Porting Notes](../platform/README.md).

## Google Setup

1. Open Google Cloud Console.
2. Create or choose a Google Cloud project.
3. Enable the Gmail API.
4. Create an OAuth client for a desktop app.
5. Open Settings > Google in the desktop app.
6. Paste the Desktop app Client ID and Client secret.
7. Save the Google setup.
8. Return to Apps and install Gmail.

If Google shows `Error 403: access_denied` with a message that Gilbert Codex has not completed verification, open Google Auth Platform > Audience and add the Gmail account as a test user. While the app is in Testing, only listed test users can authorize Gmail scopes.

Do not commit Desktop OAuth Client IDs, Client secrets, downloaded credential JSON, access tokens, refresh tokens, or Gmail payload exports.

## Current Scope Bundle

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/gmail.settings.basic`
- `https://www.googleapis.com/auth/gmail.settings.sharing`

Google classifies `gmail.modify` as a restricted Gmail scope. Keep it only because the product goal is more than read-only Gmail: labels, drafts, archive/trash actions, and send proposals need broad Gmail action support.

## AI Tool Surface

Gmail tools are exposed through the local tool bridge, backed by Tauri commands that call the Gmail REST API with the user's stored OAuth token.

- Metadata and search tools: `gmail_account`, `gmail_search_messages`, `gmail_semantic_search`, `gmail_get_message`, `gmail_get_thread`, `gmail_list_labels`
- Full-content tools: `gmail_read_full_message`, `gmail_read_full_thread`
- Draft and organize tools: `gmail_create_draft`, `gmail_create_label`, `gmail_modify_message_labels`, `gmail_batch_modify_messages`, `gmail_untrash_message`
- Confirmation-gated send tools: `gmail_send_message`, `gmail_send_separate_messages`, `gmail_send_draft`
- Confirmation-gated destructive tools: `gmail_delete_draft`, `gmail_trash_message`

The tool bridge treats send, draft deletion, and trash as destructive so the app approval path stays visible before the operation runs.

Outgoing draft and send bodies use Markdown by default. The approval card shows the Markdown body for review, and the desktop Gmail command renders that Markdown to safe HTML before it calls Gmail so recipients see formatted headings, lists, links, and emphasis. Explicit `contentType: "text/plain"` keeps the Markdown characters literal; explicit `contentType: "text/html"` sends trusted HTML as provided.

Full-content reads are also approval-gated. Metadata tools can show sender, recipient, subject, date, labels, snippets, ids, and thread ids without exposing the full body. Approved full reads can return body text, attachment metadata, detected image attachments, and detected links. Detected links are never opened automatically.

`gmail_semantic_search` uses local vector-style hashing over metadata and snippets to rank fuzzy requests. It does not send email content to a separate embedding provider.

`gmail_batch_modify_messages` uses Gmail's batch label modify capability for explicit message IDs. Separate-recipient sends intentionally send one message per recipient so addresses are not exposed to each other.

## Public Distribution Requirements

- The OAuth consent screen must be configured for external users and moved out of testing before the app is treated as public.
- Sensitive or restricted Gmail scopes need Google OAuth verification.
- If restricted Gmail data is stored on servers or transmitted outside the user's device, Google can require an additional security assessment.
- The public home page and privacy policy should clearly explain how Gilbert Codex accesses, uses, stores, and shares Google user data.
- Release notes should not claim Gmail is broadly available until the production Google Cloud project is verified for the requested scopes.

## Safety Contract

- Reading Gmail requires the connected Google account.
- Installing the Gmail plugin writes a local installed-plugin record before Google auth starts.
- Metadata-first reads should be preferred before full-body reads.
- Full message or thread body reads require visible approval for the exact id.
- Drafting is safe to propose without sending.
- Sending, deleting, archiving, spam, unsubscribe, and bulk label changes require a visible confirmation card.
- Approval previews must not execute the Gmail action.
- Links detected in email content must be listed only; never open them automatically.
- Tokens are stored under the signed-in local Gilbert user namespace.
- Guest mode must not read or write authenticated Gmail state.
