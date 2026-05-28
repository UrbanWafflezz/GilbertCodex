import { BookOpen, CheckCircle2, Copy, ExternalLink, GitBranch, Github, KeyRound, LogIn, ShieldCheck, Trash2, X } from "lucide-react";
import type { GithubConnectionState, GithubDeviceLoginSession, GithubRepository } from "../../../types/github";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface GithubSettingsPageProps {
  accountDetail: string;
  fullAccessScopes: string[];
  githubCheckingAccess: boolean;
  githubConnection: GithubConnectionState;
  githubDisconnecting: boolean;
  githubDeviceLogin: GithubDeviceLoginSession | null;
  githubDevicePolling: boolean;
  githubOauthClientId: string;
  githubRepos: GithubRepository[];
  githubRequestedScope: string;
  githubStartingLogin: boolean;
  githubStatus: SettingsStatusMessage | null;
  githubUsesCloud: boolean;
  hasFullGithubAccess: boolean;
  missingGithubScopes: string[];
  onCancelBrowserLogin: () => void;
  onCheckAccess: () => void;
  onCopyUserCode: () => void;
  onDisconnect: () => void;
  onStartBrowserLogin: () => void;
  onUpdateGithubOauthClientId: (clientId: string) => void;
}

const GITHUB_DOC_LINKS = [
  { href: "https://github.com/settings/developers", label: "Developer settings" },
  { href: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app", label: "Create OAuth App" },
  { href: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps", label: "Device flow" },
  { href: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps", label: "OAuth scopes" },
  { href: "https://docs.github.com/en/rest", label: "REST API" },
  { href: "https://docs.github.com/en/rest/repos/repos", label: "Repositories API" },
  { href: "https://docs.github.com/en/rest/repos/contents", label: "Contents API" },
  { href: "https://docs.github.com/en/rest/pulls/pulls", label: "Pull requests API" },
  { href: "https://docs.github.com/en/rest/actions/workflows", label: "Actions workflows" },
  { href: "https://gilbertcodex.com/help", label: "Setup guide" },
] as const;

export function GithubSettingsPage({
  accountDetail,
  fullAccessScopes,
  githubCheckingAccess,
  githubConnection,
  githubDisconnecting,
  githubDeviceLogin,
  githubDevicePolling,
  githubOauthClientId,
  githubRepos,
  githubRequestedScope,
  githubStartingLogin,
  githubStatus,
  githubUsesCloud,
  hasFullGithubAccess,
  missingGithubScopes,
  onCancelBrowserLogin,
  onCheckAccess,
  onCopyUserCode,
  onDisconnect,
  onStartBrowserLogin,
  onUpdateGithubOauthClientId,
}: GithubSettingsPageProps) {
  const hasGithubOauthClientId = Boolean(githubOauthClientId.trim());
  const githubLoginUsesDeviceCode = githubDeviceLogin?.userCode !== "BROWSER";
  const loginStatusNote = githubUsesCloud
    ? "Hosted GitHub OAuth is configured for this build. Users only need to sign in in the browser."
    : githubDevicePolling
    ? "Finish or cancel the current GitHub browser sign-in before changing the Client ID."
    : hasGithubOauthClientId
      ? "Client ID saved locally. No client secret is used for device-flow sign-in."
      : "Client ID required before GitHub browser sign-in. Create an OAuth App with Device Flow enabled.";

  return (
    <>
      <SettingsSectionHeading detail="Connected source control access, OAuth scopes, repository preview, and token health." icon={Github} title="GitHub" />

      <div className="github-settings-layout">
        <article className="settings-card github-account-card" data-connected={githubConnection.connected}>
          <div className="settings-card-heading github-card-heading">
            <Github size={19} aria-hidden="true" />
            <div>
              <h2>Connection</h2>
              <p>{githubUsesCloud ? "Authorize repositories, workflows, packages, gists, and pull requests through managed sign-in." : "Authorize repositories, workflows, packages, gists, and pull requests from one desktop token."}</p>
            </div>
          </div>

          <div className="github-account-hero">
            <span className="github-account-avatar-large" aria-hidden="true">
              {githubConnection.user?.avatarUrl ? <img alt="" src={githubConnection.user.avatarUrl} /> : <Github size={24} />}
            </span>
            <div className="github-account-copy">
              <span className="github-status-pill" data-connected={githubConnection.connected} data-full-access={hasFullGithubAccess}>
                {githubConnection.connected ? (hasFullGithubAccess ? "Full access" : "Reconnect needed") : "Not connected"}
              </span>
              <strong>{githubConnection.connected ? githubConnection.user?.login ?? "GitHub" : "Sign in with GitHub"}</strong>
              <small>{githubConnection.connected ? accountDetail : githubUsesCloud ? "No local OAuth setup needed." : "Use your browser to authorize source-control access."}</small>
            </div>
          </div>

          {githubConnection.connected && !hasFullGithubAccess ? (
            <div className="github-upgrade-banner" data-kind="warning">
              <div>
                <strong>Reconnect to upgrade GitHub access</strong>
                <span>Current token is missing permissions required for full repository automation.</span>
              </div>
              <div className="github-missing-scopes" aria-label="Missing GitHub OAuth scopes">
                {missingGithubScopes.slice(0, 6).map((scope) => (
                  <code key={scope}>{scope}</code>
                ))}
                {missingGithubScopes.length > 6 ? <code>+{missingGithubScopes.length - 6}</code> : null}
              </div>
            </div>
          ) : null}

          {githubDeviceLogin ? (
            <div className="github-device-login-panel" aria-live="polite">
              <div>
                <span>{githubLoginUsesDeviceCode ? "Enter this code on GitHub" : "Finish sign-in on GitHub"}</span>
                <strong>{githubLoginUsesDeviceCode ? githubDeviceLogin.userCode : "Browser authorization"}</strong>
              </div>
              <div className="github-device-actions">
                <a className="settings-ghost-button" href={githubDeviceLogin.verificationUri} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} aria-hidden="true" />
                  Open GitHub
                </a>
                {githubLoginUsesDeviceCode ? <button className="settings-ghost-button" type="button" onClick={onCopyUserCode}>
                  <Copy size={16} aria-hidden="true" />
                  Copy code
                </button> : null}
                <button className="settings-ghost-button" type="button" onClick={onCancelBrowserLogin}>
                  <X size={16} aria-hidden="true" />
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="settings-actions-row github-action-bar">
            <button className="settings-primary-button github-login-button" type="button" disabled={githubStartingLogin || githubDevicePolling} onClick={onStartBrowserLogin}>
              <LogIn size={16} aria-hidden="true" />
              {githubDevicePolling ? "Waiting for GitHub" : githubStartingLogin ? "Starting GitHub" : githubConnection.connected ? "Reconnect GitHub" : "Continue with GitHub"}
            </button>
            <button className="settings-ghost-button" type="button" disabled={githubCheckingAccess || githubStartingLogin || githubDevicePolling} onClick={onCheckAccess}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {githubCheckingAccess ? "Checking access" : "Check access"}
            </button>
            <button className="settings-ghost-button" type="button" disabled={githubDisconnecting || githubStartingLogin || githubDevicePolling || !githubConnection.connected} onClick={onDisconnect}>
              <Trash2 size={16} aria-hidden="true" />
              {githubDisconnecting ? "Disconnecting" : "Disconnect"}
            </button>
          </div>

          {githubStatus ? (
            <div className="github-status-banner" data-kind={githubStatus.kind}>
              {githubStatus.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card github-oauth-card">
          <div className="settings-card-heading github-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>OAuth app</h2>
              <p>{githubUsesCloud ? "Hosted sign-in is ready. No user-supplied Client ID is needed." : githubConnection.connected ? (hasFullGithubAccess ? "Token has the requested scope set." : "Reconnect after changing scopes.") : "Saved locally for browser sign-in."}</p>
            </div>
          </div>

          {githubUsesCloud ? (
              <div className="github-scope-summary">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Hosted OAuth</span>
              <code>Managed</code>
              </div>
          ) : (
            <label className="settings-field">
              <span>Client ID</span>
              <input
                autoComplete="off"
                disabled={githubDevicePolling}
                placeholder="Paste GitHub Client ID"
                value={githubOauthClientId}
                onChange={(event) => onUpdateGithubOauthClientId(event.target.value)}
              />
              <small className="settings-field-note" data-kind={hasGithubOauthClientId ? "ready" : "error"}>
                {loginStatusNote}
              </small>
            </label>
          )}

          {!githubUsesCloud ? (
            <div className="settings-actions-row github-oauth-actions">
              <a className="settings-ghost-button github-doc-link" href="https://github.com/settings/developers" rel="noreferrer" target="_blank">
                <ExternalLink size={16} aria-hidden="true" />
                Create OAuth App
              </a>
              <a className="settings-ghost-button github-doc-link" href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps" rel="noreferrer" target="_blank">
                <ExternalLink size={16} aria-hidden="true" />
                Device flow docs
              </a>
            </div>
          ) : null}

          <div className="github-scope-summary">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Requested scope</span>
            <code title={githubRequestedScope}>{githubRequestedScope}</code>
          </div>

          <div className="github-scope-cloud" aria-label="Requested GitHub OAuth scopes">
            {fullAccessScopes.map((scope) => (
              <code key={scope} data-missing={missingGithubScopes.includes(scope)}>
                {scope}
              </code>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide github-repositories-card">
          <div className="settings-card-heading github-card-heading">
            <GitBranch size={19} aria-hidden="true" />
            <div>
              <h2>Repositories</h2>
              <p>{githubRepos.length > 0 ? "Most recently updated repositories available to Gilbert." : "Connect or check access to load repository previews."}</p>
            </div>
          </div>

          {githubRepos.length > 0 ? (
            <div className="github-repo-grid" aria-label="GitHub repositories">
              {githubRepos.map((repo) => (
                <a href={repo.htmlUrl} key={repo.fullName} rel="noreferrer" target="_blank">
                  <GitBranch size={15} aria-hidden="true" />
                  <span>
                    <strong>{repo.fullName}</strong>
                    <small>
                      {repo.private ? "Private" : "Public"} - {repo.defaultBranch} - {formatRepositoryAccess(repo)}
                    </small>
                    {repo.description ? <em>{repo.description}</em> : null}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="github-repo-empty">
              <Github size={18} aria-hidden="true" />
              <span>No repository preview loaded.</span>
            </div>
          )}
        </article>

        <article className="settings-card settings-card-wide integration-docs-card github-docs-card">
          <div className="settings-card-heading github-card-heading">
            <BookOpen size={19} aria-hidden="true" />
            <div>
              <h2>Docs</h2>
              <p>Updated May 12, 2026 from GitHub's OAuth App, device-flow, scope, and REST API docs.</p>
            </div>
          </div>

          <div className="integration-docs-body">
            <section className="integration-doc-section" aria-labelledby="github-docs-setup-title">
              <h3 id="github-docs-setup-title">Setup steps</h3>
              <ol className="integration-doc-steps">
                <li>Open GitHub Developer settings, create an OAuth App, and use public-safe app details.</li>
                <li>Set Homepage URL to the project or repository page, set Authorization callback URL to <code>http://localhost</code>, and enable Device Flow.</li>
                <li>Copy the public Client ID into this page. Gilbert stores it locally for this desktop user.</li>
                <li>Click Continue with GitHub. Gilbert starts device-flow login and sends you to <code>https://github.com/login/device</code> with a user code.</li>
                <li>Approve the requested scopes. Scopes limit token access and do not exceed the signed-in account's own repository permissions.</li>
                <li>Return to Gilbert and wait for the connection state to show your username, then click Check access.</li>
                <li>Confirm repository previews load, then use chat for repository reads, code search, branch work, commits, PRs, releases, and workflow runs.</li>
                <li>Reconnect from this page after changing scopes, replacing the OAuth App, or authorizing SSO for organization repositories.</li>
              </ol>
            </section>

            <section className="integration-doc-section" aria-labelledby="github-docs-links-title">
              <h3 id="github-docs-links-title">Official links</h3>
              <ul className="integration-doc-link-list">
                {GITHUB_DOC_LINKS.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} rel="noreferrer" target="_blank">
                      <span>{link.label}</span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="integration-doc-note">
                Gilbert uses device flow and a public Client ID. Do not paste a GitHub OAuth client secret into this app.
              </p>
            </section>
          </div>
        </article>
      </div>
    </>
  );
}

function formatRepositoryAccess(repo: GithubRepository) {
  if (repo.permissions.admin) {
    return "Admin";
  }

  if (repo.permissions.push) {
    return "Write";
  }

  if (repo.permissions.pull) {
    return "Read";
  }

  return "Limited";
}
