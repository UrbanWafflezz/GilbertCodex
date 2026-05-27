import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Check, ChevronLeft, ChevronRight, Gauge, Route, Search, Sparkles, Zap } from "lucide-react";
import { ReasoningEffortPanel } from "./ReasoningEffortPanel";
import {
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  GLM_45_AIR_FREE_MODEL,
  GPT_OSS_120B_FREE_MODEL,
  LAGUNA_M1_FREE_MODEL,
  MINIMAX_M25_FREE_MODEL,
  MODEL_PROVIDERS,
  NEMOTRON_3_SUPER_MODEL,
  OPENROUTER_FREE_AUTO_MODEL,
  OWL_ALPHA_MODEL,
  TRINITY_LARGE_THINKING_FREE_MODEL,
  buildProviderModelOptions,
  filterEnabledProviderModelOptions,
  formatModelCapabilitySummary,
  formatModelPricingSummary,
  formatModelPricingTitle,
  getEffectiveProviderModelContextWindowTokens,
  getModelRouteSourceInfo,
  isModelProviderAvailableForSelection,
  type ChatModelOption,
  type ProviderModelMetadata,
} from "../../lib/models";
import { formatTokenCount, getFallbackModelContextWindow, type ModelContextWindow, type ModelContextWindowMap } from "../../lib/contextWindow";
import type { ModelProviderId, ProviderSettings, ThinkingSettings } from "../../types/settings";

export type LiveModelCatalogStatus = "error" | "idle" | "loading" | "ready";

interface ModelSelectorPopoverProps {
  anchorRef: RefObject<HTMLElement>;
  liveModelCatalogs: Partial<Record<ModelProviderId, ProviderModelMetadata[]>>;
  liveModelCatalogStatus: Partial<Record<ModelProviderId, LiveModelCatalogStatus>>;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onClose: () => void;
  onModelChange: (model: string, provider: ChatModelOption["provider"]) => void;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  providerSettings: ProviderSettings;
  selectedModel: ChatModelOption;
  thinking: ThinkingSettings;
}

export interface ModelSelectorEntry {
  contextWindow: ModelContextWindow;
  option: ChatModelOption;
  provider: (typeof MODEL_PROVIDERS)[number];
  selected: boolean;
}

export interface ModelSelectorEntryGroup {
  entries: ModelSelectorEntry[];
  id: string;
  label: string;
}

const LOCAL_RUNTIME_PROVIDER_IDS = new Set<ModelProviderId>(["lmstudio", "ollama", "vllm"]);
const RECOMMENDED_HOSTED_MODEL_ORDER = [
  OPENROUTER_FREE_AUTO_MODEL,
  LAGUNA_M1_FREE_MODEL,
  OWL_ALPHA_MODEL,
  NEMOTRON_3_SUPER_MODEL,
  DEEPSEEK_V4_FLASH_FREE_MODEL,
  MINIMAX_M25_FREE_MODEL,
  GLM_45_AIR_FREE_MODEL,
  GPT_OSS_120B_FREE_MODEL,
  TRINITY_LARGE_THINKING_FREE_MODEL,
] as const;
const RECOMMENDED_HOSTED_MODEL_SET = new Set<string>(RECOMMENDED_HOSTED_MODEL_ORDER);

export function ModelSelectorPopover({
  anchorRef,
  liveModelCatalogs,
  liveModelCatalogStatus,
  model,
  modelContextWindows,
  onClose,
  onModelChange,
  onThinkingChange,
  providerSettings,
  selectedModel,
  thinking,
}: ModelSelectorPopoverProps) {
  const [query, setQuery] = useState("");
  const [allModelsOpen, setAllModelsOpen] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const selectorEntries = useMemo(
    () => (catalogReady ? buildSelectorEntries(providerSettings, model, liveModelCatalogs, liveModelCatalogStatus, modelContextWindows) : []),
    [catalogReady, liveModelCatalogs, liveModelCatalogStatus, model, modelContextWindows, providerSettings],
  );
  const selectedEntry = selectorEntries.find((entry) => entry.option.value === selectedModel.value && entry.option.provider === providerSettings.provider);
  const quickEntries = useMemo(
    () => createQuickModelEntries(selectorEntries, selectedEntry, providerSettings.provider),
    [providerSettings.provider, selectedEntry, selectorEntries],
  );
  const allEntries = useMemo(() => dedupeEntries(selectorEntries), [selectorEntries]);
  const visibleAllEntries = normalizedQuery ? allEntries.filter((entry) => matchesModelSearch(entry, normalizedQuery)) : allEntries;
  const visibleGroups = useMemo(() => createModelSelectorGroups(visibleAllEntries), [visibleAllEntries]);
  const floatingPosition = useModelSelectorPosition(anchorRef, allModelsOpen);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCatalogReady(true));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setAllModelsOpen(false);
    setQuery("");
  }, [providerSettings.provider]);

  const popover = (
    <div
      className="composer-popover composer-popover-model model-selector-popover"
      role="dialog"
      aria-label="Model selector"
      data-layout={floatingPosition.layout}
      data-mode={allModelsOpen ? "all" : "quick"}
      data-placement={floatingPosition.placement}
      style={floatingPosition.style}
    >
      {allModelsOpen ? (
        <>
          <div className="model-selector-all-head">
            <button type="button" aria-label="Back to quick models" onClick={() => setAllModelsOpen(false)}>
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <div>
              <strong>More models</strong>
              <span>{catalogReady ? `${formatModelCount(allEntries.length)} across providers` : "Preparing model list"}</span>
            </div>
          </div>

          <label className="model-selector-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} placeholder="Search models or providers" onChange={(event) => setQuery(event.target.value)} />
          </label>

          <div className="model-selector-content-head">
            <strong>{normalizedQuery ? "Matches" : "All providers"}</strong>
            <span>{catalogReady ? formatModelCount(visibleAllEntries.length) : "Preparing"}</span>
          </div>

          <div className="model-selector-list">
            {!catalogReady ? (
              <div className="model-selector-loading" role="status">
                Preparing model list...
              </div>
            ) : visibleGroups.length > 0 ? (
              visibleGroups.map((group) => (
                <ModelSelectorGroup
                  group={group}
                  key={group.id}
                  onSelect={(entry) => {
                    onModelChange(entry.option.value, entry.option.provider);
                    onClose();
                  }}
                />
              ))
            ) : (
              <div className="model-selector-empty">{normalizedQuery ? "No matching models." : "No models ready."}</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="model-selector-quick-head">
            <span className="model-selector-quick-icon" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Model</strong>
              <span>{createQuickModelSubtitle(providerSettings.provider, quickEntries)}</span>
            </div>
            <button
              className="model-selector-quick-more"
              type="button"
              onClick={() => {
                setQuery("");
                setAllModelsOpen(true);
              }}
            >
              <span>More models</span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>

          <div className="model-selector-reasoning-panel">
            <ReasoningEffortPanel settings={thinking} onChange={onThinkingChange} />
          </div>

          <div className="model-selector-quick-list">
            {!catalogReady ? (
              <div className="model-selector-loading" role="status">
                Preparing model list...
              </div>
            ) : quickEntries.length > 0 ? (
              quickEntries.map((entry) => (
                <ModelSelectorQuickRow
                  entry={entry}
                  key={`${entry.option.provider}:${entry.option.id}`}
                  onSelect={() => {
                    onModelChange(entry.option.value, entry.option.provider);
                    onClose();
                  }}
                />
              ))
            ) : (
              <div className="model-selector-empty">No quick models ready.</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(popover, document.body);
}

function ModelSelectorGroup({ group, onSelect }: { group: ModelSelectorEntryGroup; onSelect: (entry: ModelSelectorEntry) => void }) {
  return (
    <section className="model-selector-group" aria-label={group.label}>
      <div className="model-selector-group-head">
        <strong>{group.label}</strong>
        <span>{formatModelCount(group.entries.length)}</span>
      </div>
      <div className="model-selector-group-list">
        {group.entries.map((entry) => (
          <ModelSelectorRow entry={entry} key={`${entry.option.provider}:${entry.option.id}`} onSelect={() => onSelect(entry)} />
        ))}
      </div>
    </section>
  );
}

function ModelSelectorQuickRow({ entry, onSelect }: { entry: ModelSelectorEntry; onSelect: () => void }) {
  return (
    <button className="model-selector-quick-row" type="button" aria-pressed={entry.selected} data-selected={entry.selected} onClick={onSelect}>
      <span>
        <strong>{formatDisplayModelLabel(entry.option.label)}</strong>
        <small>{createQuickModelDescription(entry)}</small>
      </span>
      {entry.selected ? <Check size={18} aria-hidden="true" /> : null}
    </button>
  );
}

function ModelSelectorRow({ entry, onSelect }: { entry: ModelSelectorEntry; onSelect: () => void }) {
  const Icon = iconForEntry(entry);
  const useCase = formatModelEntryDescription(entry);
  const sourceLabel = formatModelEntrySourceLabel(entry);

  return (
    <button className="model-selector-row" type="button" aria-pressed={entry.selected} data-selected={entry.selected} onClick={onSelect}>
      <span className="model-selector-row-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="model-selector-row-main">
        <strong>
          <span>{formatDisplayModelLabel(entry.option.label)}</span>
          <em>{sourceLabel}</em>
        </strong>
        <small>{useCase}</small>
      </span>
      <span className="model-selector-row-meta" title={formatModelPricingTitle(entry.option.pricing)}>
        <strong>{formatModelPricingSummary(entry.option.pricing)}</strong>
        <small>{formatModelContextWindow(entry.contextWindow)}</small>
      </span>
      {entry.selected ? <Check size={18} aria-hidden="true" /> : null}
    </button>
  );
}

function useModelSelectorPosition(anchorRef: RefObject<HTMLElement>, expanded: boolean) {
  const [position, setPosition] = useState<{ layout: "anchored" | "empty"; placement: "above" | "below" | "viewport"; style: CSSProperties }>(() => ({
    layout: "anchored",
    placement: "above",
    style: {
      opacity: 0,
      pointerEvents: "none",
      position: "fixed",
    },
  }));

  useLayoutEffect(() => {
    let positionFrame: number | null = null;

    function updatePosition() {
      const anchor = anchorRef.current;

      if (!anchor) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const bounds = getModelSelectorBounds(anchor);
      const gap = 10;
      const availableWidth = Math.max(280, bounds.right - bounds.left);
      const preferredWidth = expanded ? 720 : 368;
      const width = Math.min(preferredWidth, availableWidth);
      const preferredLeft = anchorRect.right - width;
      const left = clamp(preferredLeft, bounds.left, bounds.right - width);

      const availableAbove = anchorRect.top - bounds.top - gap;
      const availableBelow = bounds.bottom - anchorRect.bottom - gap;
      const placeAbove = availableAbove >= 280 || availableAbove >= availableBelow;
      const availableHeight = Math.max(220, placeAbove ? availableAbove : availableBelow);
      const maxHeight = Math.min(expanded ? 640 : 430, availableHeight);

      setPosition({
        layout: "anchored",
        placement: placeAbove ? "above" : "below",
        style: {
          bottom: placeAbove ? `${window.innerHeight - anchorRect.top + gap}px` : undefined,
          height: expanded ? `${maxHeight}px` : undefined,
          left: `${left}px`,
          maxHeight: `${maxHeight}px`,
          maxWidth: `${width}px`,
          opacity: 1,
          pointerEvents: "auto",
          position: "fixed",
          right: "auto",
          top: placeAbove ? undefined : `${anchorRect.bottom + gap}px`,
          width: `${width}px`,
        },
      });
    }

    function schedulePositionUpdate() {
      if (positionFrame !== null) {
        return;
      }

      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        updatePosition();
      });
    }

    updatePosition();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    return () => {
      if (positionFrame !== null) {
        window.cancelAnimationFrame(positionFrame);
      }

      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [anchorRef, expanded]);

  return position;
}

function getModelSelectorBounds(anchor: HTMLElement) {
  const workspaceRect = anchor.closest(".conversation-main")?.getBoundingClientRect() ?? anchor.closest(".app-main")?.getBoundingClientRect();
  const viewportRect = {
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
  };
  const sidebarRect = getVisibleRect(document.querySelector('.shell-sidebar[data-open="true"]'));
  const rightOverlayRect =
    getVisibleRect(document.querySelector(".right-rail")) ??
    getVisibleRect(document.querySelector(".browser-preview-panel")) ??
    getVisibleRect(document.querySelector(".coding-sidecar-panel"));
  const rawBounds = workspaceRect
    ? {
        bottom: Math.min(workspaceRect.bottom, viewportRect.bottom),
        left: Math.max(workspaceRect.left, viewportRect.left),
        right: Math.min(workspaceRect.right, viewportRect.right),
        top: Math.max(workspaceRect.top, viewportRect.top),
      }
    : viewportRect;
  const sidebarRight = sidebarRect && sidebarRect.right > rawBounds.left && sidebarRect.left <= rawBounds.left ? sidebarRect.right : rawBounds.left;
  const overlayLeft = rightOverlayRect && rightOverlayRect.left < rawBounds.right && rightOverlayRect.right >= rawBounds.right ? rightOverlayRect.left : rawBounds.right;
  const margin = 12;

  return {
    bottom: Math.max(rawBounds.top + 240, rawBounds.bottom - margin),
    left: Math.min(rawBounds.right - 280, Math.max(rawBounds.left, sidebarRight) + margin),
    right: Math.max(rawBounds.left + 280, Math.min(rawBounds.right, overlayLeft) - margin),
    top: rawBounds.top + margin,
  };
}

function getVisibleRect(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const style = window.getComputedStyle(element);

  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function buildSelectorEntries(
  providerSettings: ProviderSettings,
  currentModel: string,
  liveModelCatalogs: Partial<Record<ModelProviderId, ProviderModelMetadata[]>>,
  liveModelCatalogStatus: Partial<Record<ModelProviderId, LiveModelCatalogStatus>>,
  modelContextWindows: ModelContextWindowMap,
): ModelSelectorEntry[] {
  return MODEL_PROVIDERS.flatMap((provider) => {
    const rawLiveModels = liveModelCatalogs[provider.id];
    const liveStatus = liveModelCatalogStatus[provider.id];
    const liveModels = liveStatus === "ready" ? rawLiveModels : undefined;
    const providerModel = provider.id === providerSettings.provider ? currentModel : providerSettings.providerModels[provider.id] || provider.defaultModel;

    if (!isModelProviderAvailableForSelection(providerSettings, provider.id, rawLiveModels, liveStatus)) {
      return [];
    }

    const providerOptions = filterEnabledProviderModelOptions(buildProviderModelOptions(provider.id, liveModels, providerModel), providerSettings.disabledModels[provider.id]);

    return providerOptions.map((option) => {
      const resolvedContextWindow =
        modelContextWindows[option.value] ??
        (option.contextWindowTokens
          ? {
              source: "provider" as const,
              tokens: option.contextWindowTokens,
            }
          : getFallbackModelContextWindow(option.value));
      const effectiveTokens = getEffectiveProviderModelContextWindowTokens(
        option.provider,
        option.value,
        resolvedContextWindow.tokens,
        providerSettings.subscriptionOptimization,
      );

      return {
        contextWindow: effectiveTokens && effectiveTokens !== resolvedContextWindow.tokens
          ? {
              ...resolvedContextWindow,
              source: "provider" as const,
              tokens: effectiveTokens,
            }
          : resolvedContextWindow,
        option,
        provider,
        selected: option.value === currentModel.trim() && option.provider === providerSettings.provider,
      };
    });
  });
}

function sortRecommendedEntries(entries: ModelSelectorEntry[]) {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      order: RECOMMENDED_HOSTED_MODEL_ORDER.indexOf(entry.option.value as (typeof RECOMMENDED_HOSTED_MODEL_ORDER)[number]),
    }))
    .sort((left, right) => {
      const leftOrder = left.order === -1 ? Number.MAX_SAFE_INTEGER : left.order;
      const rightOrder = right.order === -1 ? Number.MAX_SAFE_INTEGER : right.order;

      return leftOrder - rightOrder || left.index - right.index;
    })
    .map((item) => item.entry);
}

function createQuickModelEntries(entries: ModelSelectorEntry[], selectedEntry: ModelSelectorEntry | undefined, activeProvider: ModelProviderId) {
  const providerEntries = entries.filter((entry) => entry.provider.id === activeProvider);
  const recommendedEntries = sortRecommendedEntries(entries.filter(isRecommendedHostedEntry));
  const primaryEntries = activeProvider === "openrouter" ? recommendedEntries : providerEntries.length > 0 ? providerEntries : recommendedEntries;
  const selectedFirst = selectedEntry && selectedEntry.provider.id === activeProvider ? [selectedEntry, ...primaryEntries] : primaryEntries;
  const quickEntries = dedupeEntries(selectedFirst).slice(0, 3);

  if (quickEntries.length >= 3 || activeProvider === "openrouter") {
    return quickEntries;
  }

  return dedupeEntries([...quickEntries, ...recommendedEntries]).slice(0, 3);
}

function createQuickModelSubtitle(provider: ModelProviderId, entries: ModelSelectorEntry[]) {
  if (entries.length === 0) {
    return "No models ready";
  }

  if (provider === "openrouter") {
    return "Free OpenRouter defaults";
  }

  if (provider === "9router") {
    return "Subscription routes by account";
  }

  if (isLocalRuntimeProvider(provider)) {
    return "Live local runtime models";
  }

  return `${getProviderLabel(provider)} defaults`;
}

function createQuickModelDescription(entry: ModelSelectorEntry) {
  return `${formatModelEntrySourceLabel(entry)} - ${formatModelEntryDescription(entry)}`;
}

function formatDisplayModelLabel(label: string) {
  return label.replace(/^Codex\s+/i, "").trim() || label;
}

function dedupeEntries(entries: ModelSelectorEntry[]) {
  const seen = new Set<string>();
  const dedupedEntries: ModelSelectorEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.provider.id}:${entry.option.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedEntries.push(entry);
  }

  return dedupedEntries;
}

export function createModelSelectorGroups(entries: ModelSelectorEntry[]): ModelSelectorEntryGroup[] {
  const groups: ModelSelectorEntryGroup[] = [];
  const groupByRoute = new Map<string, ModelSelectorEntryGroup>();

  for (const entry of entries) {
    const routeSource = getModelRouteSourceInfo(entry.option.provider, entry.option.value);
    let group = groupByRoute.get(routeSource.groupId);

    if (!group) {
      group = {
        entries: [],
        id: routeSource.groupId,
        label: routeSource.groupLabel,
      };
      groupByRoute.set(routeSource.groupId, group);
      groups.push(group);
    }

    group.entries.push(entry);
  }

  return groups;
}

function isRecommendedHostedEntry(entry: ModelSelectorEntry) {
  if (isLocalRuntimeProvider(entry.provider.id)) {
    return false;
  }

  return entry.provider.id === "openrouter" && RECOMMENDED_HOSTED_MODEL_SET.has(entry.option.value);
}

function matchesModelSearch(entry: ModelSelectorEntry, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  return [
    entry.option.label,
    entry.option.value,
    entry.option.detail,
    entry.option.useCase,
    getProviderLabel(entry.provider.id),
    formatModelEntrySourceLabel(entry),
    ...createModelSearchTags(entry),
    ...(entry.option.capabilities ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function createModelSearchTags(entry: ModelSelectorEntry) {
  const text = getModelSearchText(entry.option);
  const free = isFreeModel(entry.option, text);
  const local = isLocalRuntimeProvider(entry.provider.id);
  const gateway = entry.provider.id === "9router";
  const routeSource = getModelRouteSourceInfo(entry.option.provider, entry.option.value);
  const tags = [
    gateway ? "Subscription" : local ? "Local" : "Provider",
    routeSource.sourceLabel,
    routeSource.groupLabel,
    ...routeSource.searchTags,
    free ? "Free" : formatModelPricingSummary(entry.option.pricing),
    formatModelContextWindow(entry.contextWindow),
  ];

  if (isThinkingModel(entry.option, text)) {
    tags.push("Reasoning");
  }

  if (isToolModel(entry.option, text)) {
    tags.push("Tools");
  }

  return tags;
}

function getModelSearchText(option: ChatModelOption) {
  return `${option.label} ${option.value} ${option.detail} ${option.useCase ?? ""} ${(option.capabilities ?? []).join(" ")}`.toLowerCase();
}

function iconForEntry(entry: ModelSelectorEntry) {
  if (entry.provider.id === "9router") {
    return Route;
  }

  if (isLocalRuntimeProvider(entry.provider.id)) {
    return Gauge;
  }

  const text = getModelSearchText(entry.option);

  if (/flash|fast|m2\.5|mini|maximize throughput/.test(text)) {
    return Zap;
  }

  if (/reason|thinking|agent|tool|coding|software|laguna|gpt-oss|nemotron/.test(text)) {
    return BrainCircuit;
  }

  return Sparkles;
}

function isToolModel(option: ChatModelOption, text: string) {
  const capabilityText = (option.capabilities ?? []).join(" ").toLowerCase();

  return /\btool|agent|coding|software|structured|json/.test(capabilityText) || /\btool|agent|coding|software|structured|json/.test(text);
}

function isThinkingModel(option: ChatModelOption, text: string) {
  const capabilityText = (option.capabilities ?? []).join(" ").toLowerCase();

  return /\breason(?:ing)?\b|thinking|planning|analysis/.test(capabilityText) || /\breason(?:ing)?\b|thinking|planning|analysis/.test(text);
}

function isFreeModel(option: ChatModelOption, text: string) {
  const pricing = option.pricing;
  const freePricing = pricing && pricing.inputPerMillionTokens === 0 && pricing.outputPerMillionTokens === 0;

  return Boolean(freePricing || option.value.endsWith(":free") || /\bfree\b|no-cost|cost-free/.test(text));
}

function isLocalRuntimeProvider(providerId: ModelProviderId) {
  return LOCAL_RUNTIME_PROVIDER_IDS.has(providerId);
}

function getProviderLabel(providerId: ModelProviderId) {
  if (providerId === "9router") {
    return "Subscription routes";
  }

  return MODEL_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

function formatModelEntrySourceLabel(entry: ModelSelectorEntry) {
  return getModelRouteSourceInfo(entry.option.provider, entry.option.value).sourceLabel;
}

function formatModelEntryDescription(entry: ModelSelectorEntry) {
  return formatModelCapabilitySummary(entry.option);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function formatModelCount(count: number) {
  return count === 1 ? "1 model" : `${count} models`;
}

function formatModelContextWindow(contextWindow: ModelContextWindow) {
  const suffix = contextWindow.source === "openrouter" || contextWindow.source === "provider" ? "" : " est.";

  return `${formatTokenCount(contextWindow.tokens)} ctx${suffix}`;
}
