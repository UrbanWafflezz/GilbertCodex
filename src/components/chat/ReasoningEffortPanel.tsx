import { BrainCircuit, Check } from "lucide-react";
import type { ReasoningEffort, ThinkingSettings } from "../../types/settings";

interface ReasoningEffortPanelProps {
  onChange: (settings: ThinkingSettings) => void;
  settings: ThinkingSettings;
}

const effortOptions: Array<{ detail: string; label: string; value: ReasoningEffort }> = [
  { detail: "Quick pass", label: "Low", value: "low" },
  { detail: "Balanced", label: "Medium", value: "medium" },
  { detail: "Deep work", label: "High", value: "high" },
];

function formatReasoningStatus(settings: ThinkingSettings) {
  if (!settings.enabled) {
    return "Off";
  }

  return `${effortOptions.find((option) => option.value === settings.effort)?.label ?? settings.effort} effort`;
}

export function ReasoningEffortPanel({ onChange, settings }: ReasoningEffortPanelProps) {
  return (
    <div className="reasoning-effort-panel" data-enabled={settings.enabled ? "true" : "false"}>
      <div className="reasoning-effort-header">
        <span className="reasoning-effort-orb" data-on={settings.enabled ? "true" : undefined} aria-hidden="true">
          <BrainCircuit size={17} />
        </span>
        <span>
          <strong>Reasoning</strong>
          <small>{formatReasoningStatus(settings)}</small>
        </span>
        <button
          className="reasoning-effort-power"
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={settings.enabled ? "Turn reasoning off" : "Turn reasoning on"}
          data-on={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
        >
          <span>{settings.enabled ? "On" : "Off"}</span>
        </button>
      </div>

      <div className="reasoning-effort-grid" role="radiogroup" aria-label="Reasoning effort">
        {effortOptions.map((option) => {
          const selected = settings.enabled && settings.effort === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-selected={selected}
              onClick={() => onChange({ enabled: true, effort: option.value })}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              {selected ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
