import { Database, FolderLock, HardDrive, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface DatabaseSettingsPageProps {
  showHeading?: boolean;
}

export function DatabaseSettingsPage({ showHeading = true }: DatabaseSettingsPageProps = {}) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Account data, privacy, and sync status." icon={Database} title="Library & Data" /> : null}
      <div className="settings-section-grid database-settings-grid">
        <article className="settings-card settings-card-wide database-storage-hero">
          <div className="settings-card-heading">
            <FolderLock size={19} aria-hidden="true" />
            <div>
              <h2>Private workspace</h2>
              <p>Your account keeps chats, projects, files, settings, and plan state separate from every other user.</p>
            </div>
          </div>
          <div className="database-metric-grid">
            <AccountDataMetric icon={Database} label="Workspace data" value="Private account library" detail="Chats, projects, settings, usage, and plan state stay attached to your sign-in." />
            <AccountDataMetric icon={HardDrive} label="Files and images" value="Account storage" detail="Uploaded files and generated media stay scoped to your account." />
            <AccountDataMetric icon={LockKeyhole} label="Access model" value="Owner-only" detail="Only your signed-in account can read or write your workspace data." />
            <AccountDataMetric icon={ShieldCheck} label="Local cache" value="Protected" detail="Gilbert keeps local app state separate for each signed-in user." />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Privacy rules</h2>
              <p>Account data is separated by owner and protected from client-side plan changes.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Workspace</span>
              <strong>Owner-only</strong>
              <em>Your chats, projects, and settings</em>
            </div>
            <div className="settings-row">
              <span>Username lookup</span>
              <strong>Sign-in only</strong>
              <em>Used to find your account during login</em>
            </div>
            <div className="settings-row">
              <span>Plan records</span>
              <strong>Protected writes</strong>
              <em>Users cannot grant themselves paid access</em>
            </div>
            <div className="settings-row">
              <span>Files and images</span>
              <strong>Owner-only</strong>
              <em>Saved only under your account</em>
            </div>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <RefreshCw size={19} aria-hidden="true" />
            <div>
              <h2>Sync behavior</h2>
              <p>Gilbert loads your account state before opening the workspace, then saves changes as you work.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Authentication</span>
              <strong>Gilbert account</strong>
            </div>
            <div className="settings-row">
              <span>Workspace persistence</span>
              <strong>Account library</strong>
            </div>
            <div className="settings-row">
              <span>Media persistence</span>
              <strong>Account files</strong>
            </div>
          </div>
        </article>
      </div>
    </>
  );
}

interface AccountDataMetricProps {
  detail: string;
  icon: typeof Database;
  label: string;
  value: string;
}

function AccountDataMetric({ detail, icon: Icon, label, value }: AccountDataMetricProps) {
  return (
    <div className="database-metric">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}
