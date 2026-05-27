# GitHub Integration Setup

This guide explains how to connect GitHub to Gilbert Codex for the first-party GitHub plugin: repository browsing, repository stats, tags, code search, local vector-ranked discovery, branch reads, API-backed commits, issues, pull requests, releases, release notes, GitHub Actions, and advanced REST API automation.

Last updated: May 25, 2026 for the v0.8.2 build.

Platform note: GitHub OAuth and API-backed actions are implemented through the same app command layer on Windows, macOS, and Linux. macOS and Linux still need packaged-app launch testing before the integration is considered fully verified there, especially token persistence, browser handoff, local Git helpers, and release tooling. See [Platform Support And Porting Notes](../platform/README.md).

## What Gilbert Uses

Gilbert Codex uses a GitHub OAuth App with device-flow browser login. The desktop app stores the resulting GitHub access token locally and sends GitHub operations through the Tauri command layer.

The integration does not require:

- GitHub CLI.
- A local Git clone.
- A GitHub client secret in the desktop app.

The integration does require:

- A public GitHub OAuth App client ID.
- Device flow enabled on that OAuth App.
- A GitHub account that already has permission to the repositories it will operate on.

## Plugin Install Flow

1. Open Apps.
2. Click GitHub.
3. Click Install GitHub.
4. If Settings > GitHub is already connected, the plugin tools are ready immediately.
5. If GitHub is not connected, Gilbert opens Settings > GitHub so the user can continue with browser/device-flow sign-in.

The app stores plugin installation state locally. Disconnecting GitHub removes the account token, but the plugin can stay installed so the user can reconnect later.

## Official Links

- Create a GitHub OAuth App: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- Authorizing OAuth Apps and device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- OAuth App scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- GitHub webhooks: https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
- Webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub REST API docs: https://docs.github.com/en/rest
- GitHub Developer settings: https://github.com/settings/developers

## Step 1: Create The OAuth App

1. Sign in to GitHub.

2. Open Developer settings:
   https://github.com/settings/developers

3. Click OAuth Apps.

4. Click New OAuth App.

   If this is your first app, the button may say Register a new application.

5. Fill in:

   - Application name: `Gilbert Codex Local`
   - Homepage URL: your repository URL or project page
   - Application description: optional, public-facing text
   - Authorization callback URL: `http://localhost`

   Gilbert uses device flow, so the callback URL is not used for the normal desktop sign-in. GitHub still requires a value.

6. Enable Device Flow.

7. Click Register application.

8. Copy the Client ID.

Do not copy or commit the client secret. Gilbert Codex does not need it for device-flow login.

## Step 2: Save The Client ID In Gilbert

1. Start the desktop app:

   ```bash
   npm run app:dev
   ```

2. Open Settings > GitHub.

3. Paste the public OAuth App Client ID.

4. Gilbert stores that Client ID locally for the current app user. Do not paste or commit the OAuth client secret.

## Step 3: Connect From Gilbert Codex

1. Open Settings > GitHub.

2. Confirm the Client ID field is filled.

3. Click Continue with GitHub.

4. Gilbert opens GitHub's device login page or shows a code.

5. In the browser, authorize the app.

6. Return to Gilbert Codex.

7. Wait for the connection status to show the GitHub username.

8. Click Check access.

9. Confirm repository previews load.

## Step 4: Understand The Requested Scopes

Gilbert currently requests a broad scope set for GitHub surfaces and repository administration features. GitHub actions that can affect repositories should stay visible in activity or review UI and should remain behind the app's approval policy for high-impact operations.

Current requested scopes:

```text
repo workflow delete_repo admin:repo_hook admin:org admin:public_key admin:org_hook gist notifications user project write:packages read:packages delete:packages admin:gpg_key codespace read:audit_log security_events
```

Important details:

- Scopes do not grant access beyond the signed-in user's GitHub permissions.
- Users can reduce granted scopes during authorization.
- Settings > GitHub shows missing scopes and asks the user to reconnect if the token is too limited.
- The `repo` scope includes access to private repositories the user can access.
- The `workflow` scope is required for creating or updating GitHub Actions workflow files.
- `admin:repo_hook` and related hook scopes support webhook automation.
- `delete_repo` is powerful and should only be authorized on accounts where repository deletion capability is acceptable.

## Step 5: Current App Status

GitHub operations are available when the desktop app is connected and the selected permission mode allows the requested action. Repository inventory, repository stats, branch reads, tag lists, code search, semantic discovery, API commits, full issue lifecycle work, completed-issue discovery, pull request review work, release helpers, workflow listing, workflow dispatch, workflow-run inspection, workflow jobs/artifacts, workflow approval/rerun/cancel, pending deployment review, security alerts, notifications, and advanced REST calls should all route through the Tauri command layer instead of the GitHub CLI.

AI-callable GitHub tool ids:

- `github_account`
- `github_list_repositories`
- `github_get_repository`
- `github_list_branches`
- `github_list_tags`
- `github_list_tree`
- `github_read_file`
- `github_search_code`
- `github_semantic_search`
- `github_create_branch`
- `github_commit_files`
- `github_search_issues`
- `github_list_issues`
- `github_list_completed_issues`
- `github_get_issue`
- `github_list_issue_comments`
- `github_create_issue`
- `github_update_issue`
- `github_close_issue`
- `github_reopen_issue`
- `github_mark_issue_duplicate`
- `github_comment_issue`
- `github_update_issue_comment`
- `github_delete_issue_comment`
- `github_set_issue_labels`
- `github_add_issue_labels`
- `github_remove_issue_label`
- `github_clear_issue_labels`
- `github_assign_issue`
- `github_unassign_issue`
- `github_lock_issue`
- `github_unlock_issue`
- `github_pin_issue`
- `github_unpin_issue`
- `github_transfer_issue`
- `github_list_milestones`
- `github_create_milestone`
- `github_update_milestone`
- `github_delete_milestone`
- `github_list_pull_requests`
- `github_get_pull_request`
- `github_list_pull_request_files`
- `github_list_pull_request_commits`
- `github_list_pull_request_reviews`
- `github_create_pull_request_review`
- `github_request_pull_request_reviewers`
- `github_remove_pull_request_reviewers`
- `github_update_pull_request_branch`
- `github_check_pull_request_merged`
- `github_create_pull_request`
- `github_update_pull_request`
- `github_merge_pull_request`
- `github_search_repositories`
- `github_search_users`
- `github_list_commits`
- `github_get_commit`
- `github_compare_refs`
- `github_list_contributors`
- `github_list_stargazers`
- `github_list_forks`
- `github_create_fork`
- `github_star_repository`
- `github_unstar_repository`
- `github_watch_repository`
- `github_unwatch_repository`
- `github_generate_release_notes`
- `github_list_releases`
- `github_create_release`
- `github_list_workflows`
- `github_list_workflow_runs`
- `github_get_workflow_run`
- `github_list_workflow_run_jobs`
- `github_list_workflow_run_artifacts`
- `github_approve_workflow_run`
- `github_dispatch_workflow`
- `github_rerun_workflow_run`
- `github_cancel_workflow_run`
- `github_force_cancel_workflow_run`
- `github_get_pending_deployments`
- `github_review_pending_deployments`
- `github_list_code_scanning_alerts`
- `github_list_secret_scanning_alerts`
- `github_list_dependabot_alerts`
- `github_list_notifications`
- `github_mark_notification_thread_read`
- `github_mark_all_notifications_read`
- `github_api_read`
- `github_api_write`
- `github_api_delete`

`github_semantic_search` uses local deterministic vector embeddings to rank repository metadata and GitHub code-search candidates. It does not send repository content to a separate embedding provider.

For the Gilbert Codex release workflow, public release notes are kept in `docs/releases/<tag>.md`. The workflow reads that file so the GitHub Release body can stay in sync with the repo note instead of using a one-line generated placeholder.

## Repository Webhooks

Use this section when you want GitHub events to call an external service. Discord chat setup lives separately in:
../discord/README.md

1. Open the GitHub repository.

2. Go to Settings > Webhooks.

3. Click Add webhook.

4. Enter the Payload URL.

5. Set Content type to `application/json`.

6. Add a high-entropy Secret.

7. Choose only the events the receiver needs.

8. Keep Active checked.

9. Click Add webhook.

10. Open Recent Deliveries to inspect the ping delivery and later deliveries.

GitHub says repository webhooks require repository owner or admin access. Use organization or GitHub App webhooks only when the integration needs broader coverage.

## Security Notes

- Do not commit `.env`.
- Do not commit GitHub OAuth client secrets.
- Do not paste access tokens into issues, docs, examples, or screenshots.
- Use a dedicated OAuth App for local Gilbert development.
- Revoke the OAuth token from GitHub account settings if a machine is lost or shared.
- Reconnect in Settings > GitHub after changing scopes or replacing the OAuth App.
- Move stored access tokens to OS-backed secure storage before a production release.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| Continue with GitHub is disabled | Client ID is empty | Paste the OAuth App Client ID in Settings > GitHub |
| Device login fails immediately | Device flow is not enabled on the OAuth App | Open the OAuth App settings and enable Device Flow |
| GitHub connects but repositories do not load | Token scopes are reduced, SSO is required, or the account lacks repo access | Click Check access, authorize SSO if needed, or reconnect with full scopes |
| Settings says reconnect needed | Token is missing scopes Gilbert expects | Click Continue with GitHub again and approve the requested scopes |
| GitHub API returns 404 for a private repo | The signed-in account cannot access it or SSO is not authorized | Verify access in GitHub's web UI, then reconnect if needed |
| Workflow file commits fail | Missing `workflow` scope | Reconnect GitHub and approve the workflow scope |
| Webhook creation fails | Missing repo admin permission or wrong hook scope | Use an admin account or reconnect with hook-capable scopes |

## Maintainer Checklist

- Keep `.env.example` limited to non-secret setup values.
- Keep requested scopes in `src/app/githubClient.ts`, Settings UI copy, and this document aligned.
- Keep GitHub token storage notes in `SECURITY.md` current.
- Prefer draft PR creation until richer review cards and diffs are available in the UI.
- Keep GitHub actions aligned with visible approval, activity, and release-note flows.
