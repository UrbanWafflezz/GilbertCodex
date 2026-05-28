import { CheckCircle2, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { deleteApiKeyRecord, loadApiKeyVault, upsertApiKeyRecord } from "../../../lib/appStorage";
import { API_KEY_PRESETS } from "../../../services/apiKeyPresets";
import type { ApiKeyKind, ApiKeyPreset, ApiKeyRecord } from "../../../types/apiKeys";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface KeysSettingsPageProps {
  onSettingsChange: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

interface KeyDraft {
  id: string;
  keyName: string;
  kind: ApiKeyKind;
  label: string;
  service: string;
  value: string;
}

const EMPTY_KEY_DRAFT: KeyDraft = {
  id: "",
  keyName: "",
  kind: "mcp",
  label: "",
  service: "",
  value: "",
};

const KEY_PRESET_GROUP_ORDER: ApiKeyPreset["group"][] = ["MCP", "Skill", "App", "Service"];

export function KeysSettingsPage(_props: KeysSettingsPageProps) {
  const [draft, setDraft] = useState<KeyDraft>(EMPTY_KEY_DRAFT);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const [vault, setVault] = useState(() => loadApiKeyVault());
  const keysByKind = useMemo(() => groupKeysByKind(vault.keys), [vault.keys]);
  const presetsByGroup = useMemo(() => groupKeyPresetsByGroup(API_KEY_PRESETS), []);
  const editing = Boolean(draft.id);

  function resetDraft() {
    setDraft(EMPTY_KEY_DRAFT);
    setShowKey(false);
  }

  function applyPreset(presetId: string) {
    const preset = API_KEY_PRESETS.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    setDraft((current) => ({
      ...current,
      keyName: preset.keyName,
      kind: preset.kind,
      label: current.label || preset.label,
      service: preset.service,
    }));
  }

  function saveKey() {
    const label = draft.label.trim();
    const service = draft.service.trim();
    const keyName = draft.keyName.trim();
    const value = draft.value.trim();

    if (!label || !service || !keyName || !value) {
      setStatus({ kind: "error", text: "Add a label, service, key name, and key value before saving." });
      return;
    }

    const nextVault = upsertApiKeyRecord({
      id: draft.id || undefined,
      keyName,
      kind: draft.kind,
      label,
      service,
      value,
    });

    setVault(nextVault);
    resetDraft();
    setStatus({ kind: "success", text: `${label} saved to Keys.` });
  }

  function editKey(key: ApiKeyRecord) {
    setDraft({
      id: key.id,
      keyName: key.keyName,
      kind: key.kind,
      label: key.label,
      service: key.service,
      value: key.value,
    });
    setShowKey(false);
    setStatus(null);
  }

  function deleteKey(key: ApiKeyRecord) {
    const nextVault = deleteApiKeyRecord(key.id);

    setVault(nextVault);
    if (draft.id === key.id) {
      resetDraft();
    }
    setStatus({ kind: "success", text: `${key.label} deleted.` });
  }

  return (
    <>
      <SettingsSectionHeading detail="Store MCP, app, skill, and service credentials once per local user. Model API keys stay in AI & Providers." icon={KeyRound} title="Keys" />
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide keys-vault-summary">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Saved keys</h2>
              <p>Values are hidden after save and protected by the desktop secure store when device storage is active.</p>
            </div>
          </div>
          <div className="keys-summary-grid" aria-label="Key vault summary">
            <span><strong>{vault.keys.length}</strong><small>Total keys</small></span>
            <span><strong>{keysByKind.mcp.length}</strong><small>MCP</small></span>
            <span><strong>{keysByKind.skill.length}</strong><small>Skill</small></span>
            <span><strong>{keysByKind.app.length + keysByKind.service.length + keysByKind.custom.length}</strong><small>App/Other</small></span>
          </div>
          <div className="settings-actions-row">
            <span className="settings-status">{API_KEY_PRESETS.length} non-model presets available.</span>
            {status ? <span className="settings-status" data-kind={status.kind}>{status.text}</span> : null}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Plus size={19} aria-hidden="true" />
            <div>
              <h2>{editing ? "Edit key" : "Add key"}</h2>
              <p>Pick a known key type or create a custom service key.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Preset</span>
            <select value="" onChange={(event) => applyPreset(event.target.value)}>
              <option value="">Choose a non-model key...</option>
              {KEY_PRESET_GROUP_ORDER.map((group) => (
                <optgroup key={group} label={group}>
                  {(presetsByGroup[group] ?? []).map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>Label</span>
            <input value={draft.label} placeholder="Production restricted key" onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
          </label>

          <div className="keys-form-grid">
            <label className="settings-field">
              <span>Kind</span>
              <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as ApiKeyKind }))}>
                <option value="mcp">MCP</option>
                <option value="skill">Skill</option>
                <option value="app">App</option>
                <option value="service">Service</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Service</span>
              <input value={draft.service} placeholder="service-name" onChange={(event) => setDraft((current) => ({ ...current, service: event.target.value }))} />
            </label>
          </div>

          <label className="settings-field">
            <span>Key name</span>
            <input value={draft.keyName} placeholder="SERVICE_API_KEY" onChange={(event) => setDraft((current) => ({ ...current, keyName: event.target.value }))} />
          </label>

          <label className="settings-field">
            <span>Key value</span>
            <div className="settings-secret-row">
              <input autoComplete="off" value={draft.value} placeholder="Paste key or token" type={showKey ? "text" : "password"} onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} />
              <button type="button" aria-label={showKey ? "Hide key value" : "Show key value"} onClick={() => setShowKey((visible) => !visible)}>
                {showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Clear draft value" disabled={!draft.value.trim()} onClick={() => setDraft((current) => ({ ...current, value: "" }))}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </label>

          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" onClick={saveKey}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {editing ? "Save changes" : "Save key"}
            </button>
            {editing ? <button className="settings-ghost-button" type="button" onClick={resetDraft}>Cancel</button> : null}
          </div>
        </article>

        <article className="settings-card keys-list-card">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Key library</h2>
              <p>Use these from Apps, MCP setup, services, and skill workflows.</p>
            </div>
          </div>

          {vault.keys.length > 0 ? (
            <div className="keys-list">
              {vault.keys.map((key) => (
                <div key={key.id} className="keys-row">
                  <span>
                    <strong>{key.label}</strong>
                    <small>{key.service} / {key.keyName} / {formatKeyKind(key.kind)}</small>
                    <small>Updated {formatKeyDate(key.updatedAt)}</small>
                  </span>
                  <div className="keys-row-actions">
                    <button type="button" onClick={() => editKey(key)}>Edit</button>
                    <button type="button" onClick={() => deleteKey(key)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="settings-empty-state">
              <KeyRound size={18} aria-hidden="true" />
              <span>
                <strong>No keys saved</strong>
                <small>Add an MCP token, app secret, skill key, or service credential.</small>
              </span>
            </div>
          )}
        </article>
      </div>
    </>
  );
}

function groupKeysByKind(keys: ApiKeyRecord[]) {
  return {
    app: keys.filter((key) => key.kind === "app"),
    custom: keys.filter((key) => key.kind === "custom"),
    mcp: keys.filter((key) => key.kind === "mcp"),
    provider: keys.filter((key) => key.kind === "provider"),
    service: keys.filter((key) => key.kind === "service"),
    skill: keys.filter((key) => key.kind === "skill"),
  };
}

function formatKeyKind(kind: ApiKeyKind) {
  return kind === "mcp" ? "MCP" : kind === "provider" ? "Provider (legacy)" : kind.charAt(0).toUpperCase() + kind.slice(1);
}

function groupKeyPresetsByGroup(presets: ApiKeyPreset[]) {
  return presets.reduce<Record<ApiKeyPreset["group"], ApiKeyPreset[]>>((groups, preset) => {
    groups[preset.group].push(preset);
    return groups;
  }, {
    App: [],
    MCP: [],
    Service: [],
    Skill: [],
  });
}

function formatKeyDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
