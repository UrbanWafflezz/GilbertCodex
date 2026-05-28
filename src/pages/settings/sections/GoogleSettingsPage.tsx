import { BookOpen, CalendarDays, Copy, ExternalLink, Eye, EyeOff, KeyRound, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { googleCloudAvailable } from "../../../app/gmailClient";
import { clearGoogleOAuthSettings, loadGoogleOAuthSettings, saveGoogleOAuthSettings, type GoogleOAuthSettings } from "../../../lib/appStorage";
import { GMAIL_CORE_OAUTH_SCOPES, GOOGLE_CALENDAR_CORE_OAUTH_SCOPES } from "../../../lib/googleOAuthScopes";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

const GOOGLE_DOC_LINKS = [
  { href: "https://console.cloud.google.com/apis/dashboard", label: "Google Cloud Console" },
  { href: "https://console.cloud.google.com/auth/overview", label: "Google Auth Platform" },
  { href: "https://console.cloud.google.com/apis/credentials", label: "OAuth clients" },
  { href: "https://developers.google.com/identity/protocols/oauth2/native-app", label: "Desktop OAuth" },
  { href: "https://developers.google.com/workspace/gmail/api/auth/scopes", label: "Gmail scopes" },
  { href: "https://developers.google.com/workspace/calendar/api/auth", label: "Calendar scopes" },
  { href: "https://support.google.com/cloud/answer/15549945", label: "Audience and test users" },
  { href: "https://support.google.com/cloud/answer/13461325", label: "OAuth verification" },
  { href: "https://developers.google.com/gmail/api/policy", label: "Gmail user data policy" },
] as const;

const GOOGLE_API_NAMES = ["Gmail API", "Google Calendar API", "Google Tasks API"] as const;
const GMAIL_SCOPE_TEXT = GMAIL_CORE_OAUTH_SCOPES.join("\n");
const GOOGLE_CALENDAR_SCOPE_TEXT = GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.join("\n");

export function GoogleSettingsPage() {
  const [draft, setDraft] = useState<GoogleOAuthSettings>(() => loadGoogleOAuthSettings());
  const [savedSettings, setSavedSettings] = useState<GoogleOAuthSettings>(() => loadGoogleOAuthSettings());
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const hostedGoogle = googleCloudAvailable();
  const hasUserClientId = Boolean(savedSettings.clientId.trim());
  const hasClientSecret = Boolean(draft.clientSecret.trim() || savedSettings.clientSecret.trim());
  const readiness = [
    { label: "Client ID", detail: hostedGoogle ? "Hosted Google OAuth configured" : hasUserClientId ? "Ready for Google sign-in" : "Paste a desktop OAuth client ID", ready: hostedGoogle || hasUserClientId },
    { label: "Client secret", detail: hostedGoogle ? "Stored in Google Cloud Secret Manager" : hasClientSecret ? "Saved locally for token exchange" : "Required for this desktop flow", ready: hostedGoogle || hasClientSecret },
    { label: "APIs", detail: "Enable Gmail, Calendar, and Tasks in Google Cloud", ready: true },
    { label: "Test user", detail: "Needed while the Google app is in Testing", ready: true },
  ];

  function patchDraft(patch: Partial<GoogleOAuthSettings>) {
    setDraft((current) => ({
      ...current,
      ...patch,
    }));
    setStatus(null);
  }

  function saveSettings() {
    const nextSettings = {
      clientId: draft.clientId.trim(),
      clientSecret: draft.clientSecret.trim(),
    };

    if (!nextSettings.clientId) {
      setStatus({ kind: "error", text: "Paste a Google desktop OAuth Client ID before saving." });
      return;
    }

    if (!nextSettings.clientSecret) {
      setStatus({ kind: "error", text: "Paste the matching Google desktop OAuth Client secret before saving." });
      return;
    }

    saveGoogleOAuthSettings(nextSettings);
    setDraft(nextSettings);
    setSavedSettings(nextSettings);
    setStatus({ kind: "success", text: "Google OAuth settings saved locally. Gmail and Calendar will use these values for new sign-ins and token refresh." });
  }

  function clearSettings() {
    clearGoogleOAuthSettings();
    const clearedSettings = loadGoogleOAuthSettings();
    setDraft(clearedSettings);
    setSavedSettings(clearedSettings);
    setStatus({
      kind: "success",
      text: "Google OAuth settings cleared.",
    });
  }

  async function copyText(text: string, successText: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ kind: "success", text: successText });
    } catch {
      setStatus({ kind: "error", text: "Clipboard access failed." });
    }
  }

  return (
    <>
      <SettingsSectionHeading detail={hostedGoogle ? "Hosted Google OAuth for Gmail, Google Calendar, and Tasks." : "Bring your own Google OAuth client for Gmail, Google Calendar, and Tasks."} icon={KeyRound} title="Google" />

      <div className="google-settings-layout">
        <article className="settings-card google-oauth-card">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>OAuth client</h2>
              <p>{hostedGoogle ? "This build uses Gilbert's hosted Google connector. Users sign in without pasting OAuth credentials." : "Use a Google Cloud Desktop app client so this machine can open browser sign-in and refresh tokens after restart."}</p>
            </div>
          </div>

          {hostedGoogle ? (
            <div className="github-scope-summary">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Hosted OAuth</span>
              <code>Cloud Run</code>
            </div>
          ) : null}

          <label className="settings-field">
            <span>Desktop Client ID</span>
            <input autoComplete="off" disabled={hostedGoogle} placeholder="1234567890-abc.apps.googleusercontent.com" value={hostedGoogle ? "" : draft.clientId} onChange={(event) => patchDraft({ clientId: event.target.value })} />
            <small className="settings-field-note" data-kind={hostedGoogle || hasUserClientId ? "ready" : "error"}>
              {hostedGoogle ? "No local Client ID required." : hasUserClientId ? "Using the Client ID saved on this page." : "Required before Gmail or Calendar can open Google sign-in."}
            </small>
          </label>

          <label className="settings-field">
            <span>Desktop Client secret</span>
            <div className="settings-secret-row">
              <input
                autoComplete="off"
                disabled={hostedGoogle}
                placeholder="Paste the matching desktop client secret"
                type={showSecret ? "text" : "password"}
                value={hostedGoogle ? "" : draft.clientSecret}
                onChange={(event) => patchDraft({ clientSecret: event.target.value })}
              />
              <button type="button" aria-label={showSecret ? "Hide Google OAuth client secret" : "Show Google OAuth client secret"} onClick={() => setShowSecret((visible) => !visible)}>
                {showSecret ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            <small className="settings-field-note" data-kind={hostedGoogle || hasClientSecret ? "ready" : "error"}>
              {hostedGoogle ? "Stored only on the hosted connector service." : "Stored locally. Desktop storage protects this field with the app secure-storage layer before writing it to the local database."}
            </small>
          </label>

          {!hostedGoogle ? <div className="settings-actions-row google-action-row">
            <button className="settings-primary-button" type="button" onClick={saveSettings}>
              <ShieldCheck size={16} aria-hidden="true" />
              Save Google setup
            </button>
            <button className="settings-ghost-button" type="button" onClick={clearSettings}>
              <Trash2 size={15} aria-hidden="true" />
              Clear
            </button>
            <a className="settings-ghost-button google-doc-link" href="https://console.cloud.google.com/auth/overview" rel="noreferrer" target="_blank">
              <ExternalLink size={15} aria-hidden="true" />
              Open Google Auth
            </a>
          </div> : null}

          {status ? (
            <div className="settings-status-banner" data-kind={status.kind}>
              {status.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card google-readiness-card">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Readiness</h2>
              <p>Each user can run their own Google Cloud project without waiting for Gilbert's production verification.</p>
            </div>
          </div>

          <ul className="discord-readiness-list google-readiness-list" aria-label="Google setup readiness">
            {readiness.map((item) => (
              <li key={item.label} data-ready={item.ready}>
                <span aria-hidden="true" />
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              </li>
            ))}
          </ul>

          <div className="google-api-list" aria-label="Google APIs to enable">
            {GOOGLE_API_NAMES.map((apiName) => (
              <span key={apiName}>{apiName}</span>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide google-scopes-card">
          <div className="settings-card-heading">
            <Mail size={19} aria-hidden="true" />
            <div>
              <h2>Requested scopes</h2>
              <p>Paste these exact scopes into Google Auth Platform so the consent screen matches what Gilbert requests.</p>
            </div>
          </div>

          <div className="google-scope-columns">
            <section className="google-scope-section" aria-labelledby="google-gmail-scopes-title">
              <div className="google-scope-heading">
                <Mail size={16} aria-hidden="true" />
                <h3 id="google-gmail-scopes-title">Gmail</h3>
                <button type="button" onClick={() => copyText(GMAIL_CORE_OAUTH_SCOPES.join(" "), "Gmail OAuth scopes copied.")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <textarea className="google-scope-textarea" aria-label="Gmail OAuth scopes" readOnly rows={GMAIL_CORE_OAUTH_SCOPES.length} spellCheck={false} value={GMAIL_SCOPE_TEXT} wrap="off" />
            </section>

            <section className="google-scope-section" aria-labelledby="google-calendar-scopes-title">
              <div className="google-scope-heading">
                <CalendarDays size={16} aria-hidden="true" />
                <h3 id="google-calendar-scopes-title">Calendar and Tasks</h3>
                <button type="button" onClick={() => copyText(GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.join(" "), "Calendar OAuth scopes copied.")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <textarea className="google-scope-textarea" aria-label="Google Calendar OAuth scopes" readOnly rows={GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.length} spellCheck={false} value={GOOGLE_CALENDAR_SCOPE_TEXT} wrap="off" />
            </section>
          </div>
        </article>

        <article className="settings-card settings-card-wide integration-docs-card google-docs-card">
          <div className="settings-card-heading">
            <BookOpen size={19} aria-hidden="true" />
            <div>
              <h2>Docs</h2>
              <p>Updated May 21, 2026 from Google's desktop OAuth, Auth Platform, Gmail, Calendar, and user-data policy docs.</p>
            </div>
          </div>

          <div className="integration-docs-body">
            <section className="integration-doc-section" aria-labelledby="google-docs-setup-title">
              <h3 id="google-docs-setup-title">Setup steps</h3>
              <ol className="integration-doc-steps">
                <li>Open Google Cloud Console, create a project, then enable <code>Gmail API</code>, <code>Google Calendar API</code>, and <code>Google Tasks API</code>.</li>
                <li>Open Google Auth Platform, choose External audience, fill in app name, support email, developer contact email, homepage, and privacy policy.</li>
                <li>Add the Gmail and Calendar scopes from this page under Data Access. Use exactly the scopes Gilbert shows here.</li>
                <li>Go to Credentials, create an OAuth client, choose <code>Desktop app</code>, then copy its Client ID and Client secret into this page.</li>
                <li>While the app is in Testing, add the Gmail or Calendar account under Audience &gt; Test users. Google limits Testing apps to listed test users.</li>
                <li>Click Save Google setup, then go to Apps and install Gmail or Google Calendar. Gilbert opens Google sign-in in your browser.</li>
                <li>Approve the consent screen, return to Gilbert, then confirm the connected account appears in the app account manager.</li>
                <li>If Google shows an unverified-app warning, continue only for your own trusted project. Public production use still needs Google verification.</li>
                <li>For broad Gmail access, prepare OAuth verification and explain why Gilbert needs mailbox read, compose, send, labels, and settings access.</li>
                <li>Disconnect accounts from the Apps page when replacing the OAuth client, then reconnect so refresh tokens match the new Client ID and secret.</li>
              </ol>
            </section>

            <section className="integration-doc-section" aria-labelledby="google-docs-links-title">
              <h3 id="google-docs-links-title">Official links</h3>
              <ul className="integration-doc-link-list">
                {GOOGLE_DOC_LINKS.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} rel="noreferrer" target="_blank">
                      <span>{link.label}</span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="integration-doc-note">
                User-owned OAuth setup is good for personal and testing use. To let the general public use one Gilbert-owned Google app, that production Google project still needs OAuth verification for sensitive or restricted scopes.
              </p>
            </section>
          </div>
        </article>
      </div>
    </>
  );
}
