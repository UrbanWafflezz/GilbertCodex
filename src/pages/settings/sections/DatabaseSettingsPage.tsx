import { Cloud, Database, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { firebaseProjectId, firebaseWebConfig } from "../../../firebase";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface DatabaseSettingsPageProps {
  showHeading?: boolean;
}

export function DatabaseSettingsPage({ showHeading = true }: DatabaseSettingsPageProps = {}) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Cloud account data, Firebase security, and sync status." icon={Database} title="Cloud Data" /> : null}
      <div className="settings-section-grid database-settings-grid">
        <article className="settings-card settings-card-wide database-storage-hero">
          <div className="settings-card-heading">
            <Cloud size={19} aria-hidden="true" />
            <div>
              <h2>Firebase workspace</h2>
              <p>{firebaseProjectId}</p>
            </div>
          </div>
          <div className="database-metric-grid">
            <CloudDataMetric icon={Database} label="Primary database" value="Cloud Firestore" detail="Chats, projects, settings, usage, and billing state sync through the signed-in account." />
            <CloudDataMetric icon={Cloud} label="Storage bucket" value="Firebase Storage" detail={firebaseWebConfig.storageBucket} />
            <CloudDataMetric icon={LockKeyhole} label="Access model" value="Per-user rules" detail="Only the signed-in Firebase UID can read or write its workspace data." />
            <CloudDataMetric icon={ShieldCheck} label="Local database" value="Disconnected" detail="The app hydrates from Firebase before the workspace opens." />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Security rules</h2>
              <p>Firestore and Storage rules are deployed for the Gilbert Codex cloud project.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Users</span>
              <strong>Owner-only</strong>
              <em>users/&lt;uid&gt; and nested cloud app storage</em>
            </div>
            <div className="settings-row">
              <span>Username lookup</span>
              <strong>Readable</strong>
              <em>required for username sign-in before Cloud Functions are added</em>
            </div>
            <div className="settings-row">
              <span>Billing customer records</span>
              <strong>Server-only writes</strong>
              <em>ready for Stripe webhook ownership</em>
            </div>
            <div className="settings-row">
              <span>Files and images</span>
              <strong>Owner-only</strong>
              <em>users/&lt;uid&gt;/... in Firebase Storage</em>
            </div>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <RefreshCw size={19} aria-hidden="true" />
            <div>
              <h2>Sync behavior</h2>
              <p>Gilbert hydrates cloud state before rendering the workspace, then queues Firestore writes during normal app use.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Authentication</span>
              <strong>Firebase Auth</strong>
            </div>
            <div className="settings-row">
              <span>Workspace persistence</span>
              <strong>Firestore</strong>
            </div>
            <div className="settings-row">
              <span>Media persistence</span>
              <strong>Storage-ready</strong>
            </div>
          </div>
        </article>
      </div>
    </>
  );
}

interface CloudDataMetricProps {
  detail: string;
  icon: typeof Database;
  label: string;
  value: string;
}

function CloudDataMetric({ detail, icon: Icon, label, value }: CloudDataMetricProps) {
  return (
    <div className="database-metric">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}
