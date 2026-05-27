import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  Check,
  Clock3,
  Copy,
  Edit3,
  Folder,
  History,
  Inbox,
  Mail,
  Pause,
  Play,
  Plus,
  Plug,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  AUTOMATION_CAPABILITIES,
  createAutomationTaskFromDraft,
  getAutomationCapabilityDefinition,
} from "../lib/automationScheduler";
import {
  MODEL_PROVIDERS,
  buildProviderModelOptions,
  filterEnabledProviderModelOptions,
  formatModelPricingSummary,
  getDefaultModelForProvider,
  getModelProvider,
  getProviderApiKeyForProvider,
  normalizeProviderModelId,
  prefersLiveModelCatalog,
  type ChatModelOption,
  type ModelProviderCatalogItem,
} from "../lib/models";
import { DEFAULT_PROJECT } from "../lib/chatUtils";
import { formatDeviceTaskDateTime } from "../lib/localDateTime";
import type {
  AutomationCapabilityId,
  AutomationNotificationPolicy,
  AutomationRun,
  AutomationTask,
  AutomationTaskDraft,
  AutomationTrigger,
} from "../types/automation";
import type { DiscordBridgeSettings } from "../types/discord";
import type { McpServerState } from "../types/mcp";
import type { ProjectSummary } from "../types/project";
import type { ModelProviderId, ProviderSettings } from "../types/settings";
import type { AppSkill, SkillRegistryState } from "../types/skills";

type TasksTab = "inbox" | "automations" | "runs";
type BuilderStep = "prompt" | "schedule" | "tools" | "autonomy" | "notify" | "review";

interface TasksPageProps {
  activeProjectName?: string;
  draft?: AutomationTaskDraft | null;
  discordSettings: DiscordBridgeSettings;
  globalPaused: boolean;
  mcpServers?: McpServerState[];
  onAcknowledgeRun: (runId: string) => void;
  onBackToChat: () => void;
  onClearDraft?: () => void;
  onCreateTask: (draft: AutomationTaskDraft) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onOpenRunChat: (run: AutomationRun) => void;
  onPauseAll: (paused: boolean) => void;
  onPauseTask: (taskId: string, paused: boolean) => void;
  onRunTask: (taskId: string) => void;
  onSimulateTask: (taskId: string) => void;
  onSnoozeRun: (runId: string, minutes: number) => void;
  onUpdateTask: (taskId: string, draft: AutomationTaskDraft) => void;
  providerSettings: ProviderSettings;
  projects: ProjectSummary[];
  runs: AutomationRun[];
  skillRegistry?: SkillRegistryState;
  tasks: AutomationTask[];
}

const BUILDER_STEPS: BuilderStep[] = ["prompt", "schedule", "tools", "autonomy", "notify", "review"];
const EMPTY_SKILL_REGISTRY: SkillRegistryState = { skills: [], updatedAt: "", version: 1 };

const TEMPLATE_DRAFTS: Array<{ icon: typeof Bot; label: string; draft: AutomationTaskDraft }> = [
  {
    icon: Bot,
    label: "Custom agent",
    draft: {
      title: "Custom agent",
      prompt: "Run the task and summarize what changed, what needs attention, and what should happen next.",
      trigger: { kind: "manual" },
      capabilityScope: { autonomyLevel: "review", capabilities: [] },
    },
  },
  {
    icon: Mail,
    label: "Inbox monitor",
    draft: {
      title: "Inbox monitor",
      prompt: "Check Gmail for important new messages, summarize what needs a reply, and flag anything urgent.",
      trigger: { everyMinutes: 180, kind: "interval" },
      capabilityScope: { autonomyLevel: "scoped", capabilities: ["gmail.read"] },
    },
  },
  {
    icon: CalendarClock,
    label: "Calendar prep",
    draft: {
      title: "Calendar prep",
      prompt: "Review my upcoming calendar events and prepare a concise agenda with conflicts and prep notes.",
      trigger: { kind: "daily", time: "07:30" },
      capabilityScope: { autonomyLevel: "scoped", capabilities: ["calendar.read"] },
    },
  },
  {
    icon: Workflow,
    label: "GitHub watcher",
    draft: {
      title: "GitHub watcher",
      prompt: "Check GitHub notifications, issues, and pull requests I should pay attention to.",
      trigger: { everyMinutes: 240, kind: "interval" },
      capabilityScope: { autonomyLevel: "scoped", capabilities: ["github.read"] },
    },
  },
  {
    icon: Search,
    label: "Daily research scout",
    draft: {
      title: "Daily research scout",
      prompt: "Search the web for current updates on the topic I care about and summarize the strongest sources.",
      trigger: { kind: "daily", time: "08:00" },
      capabilityScope: { autonomyLevel: "scoped", capabilities: ["web.search"] },
    },
  },
];

export function TasksPage({
  activeProjectName = DEFAULT_PROJECT,
  draft,
  discordSettings,
  globalPaused,
  mcpServers = [],
  onAcknowledgeRun,
  onBackToChat,
  onClearDraft,
  onCreateTask,
  onDeleteTask,
  onDuplicateTask,
  onOpenRunChat,
  onPauseAll,
  onPauseTask,
  onRunTask,
  onSimulateTask,
  onSnoozeRun,
  onUpdateTask,
  providerSettings,
  projects = [],
  runs,
  skillRegistry = EMPTY_SKILL_REGISTRY,
  tasks,
}: TasksPageProps) {
  const [activeTab, setActiveTab] = useState<TasksTab>("inbox");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState<BuilderStep>("prompt");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [builderDraft, setBuilderDraft] = useState<AutomationTaskDraft>(() => TEMPLATE_DRAFTS[0].draft);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const inboxRuns = useMemo(
    () => runs.filter((run) => run.status !== "running" && !run.acknowledgedAt && (!run.snoozedUntil || Date.parse(run.snoozedUntil) <= Date.now())),
    [runs],
  );
  const attentionCount = inboxRuns.filter((run) => run.status === "waiting_for_approval" || run.status === "failed").length;
  const enabledCount = tasks.filter((task) => task.status === "enabled").length;

  useEffect(() => {
    if (!draft) {
      return;
    }

    setBuilderDraft(applyTaskModelDefault(withTaskProjectDefault({
      ...TEMPLATE_DRAFTS[0].draft,
      ...draft,
      capabilityScope: {
        ...TEMPLATE_DRAFTS[0].draft.capabilityScope,
        ...draft.capabilityScope,
        mcpServers: draft.capabilityScope?.mcpServers ?? TEMPLATE_DRAFTS[0].draft.capabilityScope?.mcpServers ?? [],
        skills: draft.capabilityScope?.skills ?? TEMPLATE_DRAFTS[0].draft.capabilityScope?.skills ?? [],
      },
      notificationPolicy: {
        ...draft.notificationPolicy,
      },
    }, activeProjectName), providerSettings));
    setBuilderStep("prompt");
    setEditingTaskId(null);
    setBuilderOpen(true);
    setActiveTab("automations");
  }, [activeProjectName, draft, providerSettings]);

  function openCreateBuilder(nextDraft: AutomationTaskDraft = TEMPLATE_DRAFTS[0].draft) {
    setBuilderDraft(applyTaskModelDefault(withTaskProjectDefault(nextDraft, activeProjectName), providerSettings));
    setBuilderStep("prompt");
    setEditingTaskId(null);
    setBuilderOpen(true);
    setActiveTab("automations");
  }

  function openEditBuilder(task: AutomationTask) {
    setBuilderDraft({
      capabilityScope: task.capabilityScope,
      description: task.description,
      model: task.model,
      notificationPolicy: task.notificationPolicy,
      prompt: task.prompt,
      projectName: task.projectName ?? DEFAULT_PROJECT,
      provider: task.provider,
      runLimits: task.runLimits,
      sourceChatId: task.sourceChatId,
      status: task.status,
      title: task.title,
      trigger: task.trigger,
    });
    setBuilderStep("prompt");
    setEditingTaskId(task.id);
    setBuilderOpen(true);
    setActiveTab("automations");
  }

  function closeBuilder() {
    setBuilderOpen(false);
    setEditingTaskId(null);
    onClearDraft?.();
  }

  function saveBuilder(status: "enabled" | "paused") {
    const nextDraft: AutomationTaskDraft = {
      ...applyTaskModelDefault(builderDraft, providerSettings),
      projectName: builderDraft.projectName ?? activeProjectName,
      status,
    };

    if (!isTaskDraftReady(nextDraft, providerSettings)) {
      setBuilderDraft(nextDraft);
      setBuilderStep("prompt");
      return;
    }

    if (editingTaskId) {
      onUpdateTask(editingTaskId, nextDraft);
    } else {
      onCreateTask(nextDraft);
    }

    closeBuilder();
  }

  return (
    <section className="tasks-page">
      <header className="tasks-header">
        <div className="tasks-title">
          <span className="tasks-title-icon" aria-hidden="true">
            <Workflow size={22} />
          </span>
          <div>
            <h1>Tasks</h1>
            <small>{enabledCount} enabled - {attentionCount} attention</small>
          </div>
        </div>
        <div className="tasks-actions">
          <button className="tasks-secondary-button" type="button" onClick={onBackToChat}>
            <X size={16} aria-hidden="true" />
            <span>Chat</span>
          </button>
          <button className="tasks-secondary-button" type="button" data-active={globalPaused} onClick={() => onPauseAll(!globalPaused)}>
            {globalPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            <span>{globalPaused ? "Resume all" : "Pause all"}</span>
          </button>
          <button className="tasks-primary-button" type="button" onClick={() => openCreateBuilder()}>
            <Plus size={16} aria-hidden="true" />
            <span>New task</span>
          </button>
        </div>
      </header>

      <nav className="tasks-tabs" aria-label="Tasks sections">
        <button type="button" data-active={activeTab === "inbox"} onClick={() => setActiveTab("inbox")}>
          <Inbox size={16} aria-hidden="true" />
          <span>Inbox</span>
          {inboxRuns.length > 0 ? <strong>{inboxRuns.length}</strong> : null}
        </button>
        <button type="button" data-active={activeTab === "automations"} onClick={() => setActiveTab("automations")}>
          <Bot size={16} aria-hidden="true" />
          <span>Automations</span>
        </button>
        <button type="button" data-active={activeTab === "runs"} onClick={() => setActiveTab("runs")}>
          <History size={16} aria-hidden="true" />
          <span>Runs</span>
        </button>
      </nav>

      <main className="tasks-content">
        {activeTab === "inbox" ? (
          <RunList
            emptyIcon={Inbox}
            emptyTitle="Inbox clear"
            runs={inboxRuns}
            taskById={taskById}
            variant="inbox"
            onAcknowledgeRun={onAcknowledgeRun}
            onEditTask={openEditBuilder}
            onOpenRunChat={onOpenRunChat}
            onPauseTask={onPauseTask}
            onSnoozeRun={onSnoozeRun}
          />
        ) : null}

        {activeTab === "automations" ? (
          <div className="tasks-automation-view">
            <div className="tasks-template-row" aria-label="Task templates">
              {TEMPLATE_DRAFTS.map((template) => {
                const TemplateIcon = template.icon;
                return (
                  <button key={template.label} className="tasks-template-button" type="button" onClick={() => openCreateBuilder(template.draft)}>
                    <TemplateIcon size={16} aria-hidden="true" />
                    <span>{template.label}</span>
                  </button>
                );
              })}
            </div>

            {builderOpen ? (
              <TaskBuilder
                activeProjectName={activeProjectName}
                draft={builderDraft}
                discordSettings={discordSettings}
                editing={Boolean(editingTaskId)}
                mcpServers={mcpServers}
                projects={projects}
                skillRegistry={skillRegistry}
                step={builderStep}
                onCancel={closeBuilder}
                onDraftChange={setBuilderDraft}
                providerSettings={providerSettings}
                onSave={saveBuilder}
                onStepChange={setBuilderStep}
              />
            ) : null}

            <div className="tasks-grid">
              {tasks.length === 0 ? (
                <EmptyState icon={Bot} title="No tasks yet" />
              ) : tasks.map((task) => {
                const taskRuns = runs.filter((run) => run.taskId === task.id);
                const lastRun = taskRuns[0];
                return (
                  <TaskCard
                    key={task.id}
                    lastRun={lastRun}
                    running={taskRuns.some((run) => run.status === "running")}
                    task={task}
                    mcpServers={mcpServers}
                    onDeleteTask={onDeleteTask}
                    onDuplicateTask={onDuplicateTask}
                    onEditTask={openEditBuilder}
                    onPauseTask={onPauseTask}
                    onRunTask={onRunTask}
                    onSimulateTask={onSimulateTask}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        {activeTab === "runs" ? (
          <RunList
            emptyIcon={History}
            emptyTitle="No runs yet"
            runs={runs}
            taskById={taskById}
            variant="history"
            onAcknowledgeRun={onAcknowledgeRun}
            onEditTask={openEditBuilder}
            onOpenRunChat={onOpenRunChat}
            onPauseTask={onPauseTask}
            onSnoozeRun={onSnoozeRun}
          />
        ) : null}
      </main>
    </section>
  );
}

function TaskBuilder({
  activeProjectName,
  draft,
  discordSettings,
  editing,
  mcpServers,
  onCancel,
  onDraftChange,
  providerSettings,
  projects,
  skillRegistry,
  onSave,
  onStepChange,
  step,
}: {
  activeProjectName: string;
  draft: AutomationTaskDraft;
  discordSettings: DiscordBridgeSettings;
  editing: boolean;
  mcpServers: McpServerState[];
  onCancel: () => void;
  onDraftChange: (draft: AutomationTaskDraft) => void;
  providerSettings: ProviderSettings;
  projects: ProjectSummary[];
  skillRegistry: SkillRegistryState;
  onSave: (status: "enabled" | "paused") => void;
  onStepChange: (step: BuilderStep) => void;
  step: BuilderStep;
}) {
  const previewTask = createAutomationTaskFromDraft(draft);
  const capabilities = draft.capabilityScope?.capabilities ?? [];
  const selectedMcpServers = draft.capabilityScope?.mcpServers ?? [];
  const selectedSkills = draft.capabilityScope?.skills ?? [];
  const installedMcpServers = getInstalledMcpToolServers(mcpServers);
  const installedSkills = getInstalledTaskSkills(skillRegistry);
  const [toolSearch, setToolSearch] = useState("");
  const normalizedToolSearch = normalizeToolSearch(toolSearch);
  const visibleCapabilities = AUTOMATION_CAPABILITIES.filter((capability) => matchesCapabilitySearch(capability, normalizedToolSearch));
  const visibleSkills = installedSkills.filter((skill) => matchesSkillSearch(skill, normalizedToolSearch));
  const visibleMcpServers = installedMcpServers.filter((server) => matchesMcpServerSearch(server, normalizedToolSearch));
  const visibleCapabilityIds = visibleCapabilities.map((capability) => capability.id);
  const visibleMcpServerIds = new Set(visibleMcpServers.map((server) => server.id));
  const selectedVisibleCapabilityCount = visibleCapabilityIds.filter((capabilityId) => capabilities.includes(capabilityId)).length;
  const selectedVisibleSkillCount = visibleSkills.filter((skill) => isSkillSelected(selectedSkills, skill.id)).length;
  const selectedVisibleMcpServerCount = visibleMcpServers.filter((server) => isMcpServerSelected(selectedMcpServers, server.id)).length;
  const allCapabilitiesSelected = visibleCapabilityIds.length > 0 && visibleCapabilityIds.every((capabilityId) => capabilities.includes(capabilityId));
  const allSkillsSelected = visibleSkills.length > 0 && visibleSkills.every((skill) => isSkillSelected(selectedSkills, skill.id));
  const allMcpServersSelected = visibleMcpServers.length > 0 && visibleMcpServers.every((server) => isMcpServerSelected(selectedMcpServers, server.id));
  const selectedProvider = resolveTaskModelProvider(draft, providerSettings);
  const modelOptions = selectedProvider ? getTaskModelOptions(providerSettings, selectedProvider.id, draft.model) : [];
  const selectedModel = selectedProvider ? resolveTaskModelValue(draft, providerSettings, selectedProvider.id, modelOptions) : "";
  const titleReady = Boolean(draft.title?.trim());
  const promptReady = Boolean(draft.prompt?.trim());
  const modelReady = Boolean(selectedProvider && selectedModel);
  const canSave = titleReady && promptReady && modelReady;

  function patch(next: AutomationTaskDraft) {
    onDraftChange({ ...draft, ...next });
  }

  function patchCapabilityScope(next: Partial<NonNullable<AutomationTaskDraft["capabilityScope"]>>) {
    patch({
      capabilityScope: {
        autonomyLevel: draft.capabilityScope?.autonomyLevel ?? "review",
        capabilities,
        mcpServers: selectedMcpServers,
        skills: selectedSkills,
        ...next,
      },
    });
  }

  function patchCapability(capabilityId: AutomationCapabilityId, enabled: boolean) {
    const nextCapabilities = enabled
      ? [...new Set([...capabilities, capabilityId])]
      : capabilities.filter((id) => id !== capabilityId);
    patchCapabilityScope({ capabilities: nextCapabilities });
  }

  function setAllCapabilities(enabled: boolean) {
    patchCapabilityScope({
      capabilities: enabled
        ? [...new Set([...capabilities, ...visibleCapabilityIds])]
        : capabilities.filter((capabilityId) => !visibleCapabilityIds.includes(capabilityId)),
    });
  }

  function patchMcpServer(server: McpServerState, enabled: boolean) {
    const nextMcpServers = selectedMcpServers
      .filter((scope) => scope.serverId !== server.id)
      .concat(enabled ? [createMcpServerScope(server)] : [])
      .sort((left, right) => left.serverName.localeCompare(right.serverName));

    patchCapabilityScope({ mcpServers: nextMcpServers });
  }

  function patchSkill(skill: AppSkill, enabled: boolean) {
    const nextSkills = enabled
      ? [
          ...selectedSkills.filter((scope) => scope.id !== skill.id),
          createTaskSkillScope(skill),
        ]
      : selectedSkills.filter((scope) => scope.id !== skill.id);

    patchCapabilityScope({ skills: nextSkills.sort((left, right) => left.name.localeCompare(right.name)) });
  }

  function setAllSkills(enabled: boolean) {
    const visibleSkillIds = new Set(visibleSkills.map((skill) => skill.id));
    patchCapabilityScope({
      skills: enabled
        ? [
            ...selectedSkills.filter((scope) => !visibleSkillIds.has(scope.id)),
            ...visibleSkills.map(createTaskSkillScope),
          ].sort((left, right) => left.name.localeCompare(right.name))
        : selectedSkills.filter((scope) => !visibleSkillIds.has(scope.id)),
    });
  }

  function setAllMcpServers(enabled: boolean) {
    patchCapabilityScope({
      mcpServers: enabled
        ? [
            ...selectedMcpServers.filter((scope) => !visibleMcpServerIds.has(scope.serverId)),
            ...visibleMcpServers.map(createMcpServerScope),
          ].sort((left, right) => left.serverName.localeCompare(right.serverName))
        : selectedMcpServers.filter((scope) => !visibleMcpServerIds.has(scope.serverId)),
    });
  }

  return (
    <section className="tasks-builder" aria-label={editing ? "Edit task" : "Create task"}>
      <div className="tasks-builder-steps">
        {BUILDER_STEPS.map((builderStep) => (
          <button key={builderStep} type="button" data-active={step === builderStep} onClick={() => onStepChange(builderStep)}>
            {formatStepLabel(builderStep)}
          </button>
        ))}
      </div>

      <div className="tasks-builder-body">
        {step === "prompt" ? (
          <div className="tasks-form-grid">
            <label>
              <span>Name</span>
              <input
                aria-invalid={!titleReady}
                autoComplete="off"
                className="tasks-name-input"
                maxLength={80}
                placeholder="Agent name"
                value={draft.title ?? ""}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </label>
            <label>
              <span>Prompt</span>
              <textarea
                aria-invalid={!promptReady}
                className="tasks-prompt-input"
                maxLength={12_000}
                placeholder="What should this agent do each time it runs?"
                spellCheck
                value={draft.prompt ?? ""}
                onChange={(event) => patch({ prompt: event.target.value })}
              />
            </label>
            <ProjectField
              activeProjectName={activeProjectName}
              draft={draft}
              projects={projects}
              onDraftChange={patch}
            />
            <ModelFields
              modelOptions={modelOptions}
              providerSettings={providerSettings}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              onDraftChange={patch}
            />
          </div>
        ) : null}

        {step === "schedule" ? (
          <ScheduleFields draft={draft} onDraftChange={patch} />
        ) : null}

        {step === "tools" ? (
          <div className="tasks-tools-panel">
            <label className="tasks-tool-search">
              <Search size={16} aria-hidden="true" />
              <input
                autoComplete="off"
                placeholder="Search tools, skills, plugins"
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
              />
            </label>

            <section className="tasks-tool-section" aria-label="Built-in task tools">
              <div className="tasks-tool-section-header">
                <div className="tasks-tool-section-title">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>
                    <strong>Built-in tools</strong>
                    <small>{capabilities.length} selected - {visibleCapabilities.length} shown</small>
                  </span>
                </div>
                <ToolBulkActions
                  canClear={selectedVisibleCapabilityCount > 0}
                  canSelectAll={!allCapabilitiesSelected && visibleCapabilityIds.length > 0}
                  onClear={() => setAllCapabilities(false)}
                  onSelectAll={() => setAllCapabilities(true)}
                />
              </div>
              {visibleCapabilities.length === 0 ? (
                <p className="tasks-inline-warning">
                  <Search size={14} aria-hidden="true" />
                  <span>No matching built-in tools.</span>
                </p>
              ) : (
                <div className="tasks-capability-grid">
                {visibleCapabilities.map((capability) => (
                  <label key={capability.id} className="tasks-capability-option" data-risk={capability.risk}>
                    <input
                      type="checkbox"
                      checked={capabilities.includes(capability.id)}
                      onChange={(event) => patchCapability(capability.id, event.target.checked)}
                    />
                    <span>
                      <strong>{capability.label}</strong>
                      <small>{capability.description}</small>
                    </span>
                  </label>
                ))}
                </div>
              )}
            </section>

            <section className="tasks-tool-section" aria-label="Installed skills">
              <div className="tasks-tool-section-header">
                <div className="tasks-tool-section-title">
                  <Workflow size={16} aria-hidden="true" />
                  <span>
                    <strong>Installed skills</strong>
                    <small>{selectedSkills.length} selected - {visibleSkills.length} shown</small>
                  </span>
                </div>
                <ToolBulkActions
                  canClear={selectedVisibleSkillCount > 0}
                  canSelectAll={!allSkillsSelected && visibleSkills.length > 0}
                  onClear={() => setAllSkills(false)}
                  onSelectAll={() => setAllSkills(true)}
                />
              </div>
              {installedSkills.length === 0 ? (
                <p className="tasks-inline-warning">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>No enabled installed skills are available for task runs.</span>
                </p>
              ) : visibleSkills.length === 0 ? (
                <p className="tasks-inline-warning">
                  <Search size={14} aria-hidden="true" />
                  <span>No matching installed skills.</span>
                </p>
              ) : (
                <div className="tasks-skill-grid">
                  {visibleSkills.map((skill) => (
                    <label key={skill.id} className="tasks-skill-option">
                      <input
                        type="checkbox"
                        checked={isSkillSelected(selectedSkills, skill.id)}
                        onChange={(event) => patchSkill(skill, event.target.checked)}
                      />
                      <span>
                        <strong>{skill.name}</strong>
                        <small>{skill.trigger} - {skill.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="tasks-tool-section" aria-label="MCP server tools">
              <div className="tasks-tool-section-header">
                <div className="tasks-tool-section-title">
                  <Plug size={16} aria-hidden="true" />
                  <span>
                    <strong>MCP plugins</strong>
                    <small>{selectedMcpServers.length} selected - {visibleMcpServers.length} shown</small>
                  </span>
                </div>
                <ToolBulkActions
                  canClear={selectedVisibleMcpServerCount > 0}
                  canSelectAll={!allMcpServersSelected && visibleMcpServers.length > 0}
                  onClear={() => setAllMcpServers(false)}
                  onSelectAll={() => setAllMcpServers(true)}
                />
              </div>
              {installedMcpServers.length === 0 ? (
                <p className="tasks-inline-warning">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>No enabled MCP servers have tool schemas ready. Installed skills can still guide task runs.</span>
                </p>
              ) : visibleMcpServers.length === 0 ? (
                <p className="tasks-inline-warning">
                  <Search size={14} aria-hidden="true" />
                  <span>No matching MCP plugins.</span>
                </p>
              ) : (
                <div className="tasks-mcp-server-grid">
                  {visibleMcpServers.map((server) => (
                    <label key={server.id} className="tasks-mcp-server-option">
                      <input
                        type="checkbox"
                        checked={isMcpServerSelected(selectedMcpServers, server.id)}
                        onChange={(event) => patchMcpServer(server, event.target.checked)}
                      />
                      <span>
                        <strong>{server.name}</strong>
                        <small>{formatMcpServerToolSummary(server)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {step === "autonomy" ? (
          <div className="tasks-radio-grid">
            <label data-active={(draft.capabilityScope?.autonomyLevel ?? "review") === "review"}>
              <input
                type="radio"
                name="task-autonomy"
                checked={(draft.capabilityScope?.autonomyLevel ?? "review") === "review"}
                onChange={() => patchCapabilityScope({ autonomyLevel: "review" })}
              />
              <span>
                <strong>Review first</strong>
                <small>Connected-app writes pause for approval.</small>
              </span>
            </label>
            <label data-active={draft.capabilityScope?.autonomyLevel === "scoped"}>
              <input
                type="radio"
                name="task-autonomy"
                checked={draft.capabilityScope?.autonomyLevel === "scoped"}
                onChange={() => patchCapabilityScope({ autonomyLevel: "scoped" })}
              />
              <span>
                <strong>Scoped autonomy</strong>
                <small>Allowed capabilities can run without another prompt.</small>
              </span>
            </label>
          </div>
        ) : null}

        {step === "notify" ? (
          <NotifyFields discordSettings={discordSettings} draft={draft} onDraftChange={patch} />
        ) : null}

        {step === "review" ? (
          <div className="tasks-review">
            <dl>
              <div>
                <dt>Schedule</dt>
                <dd>{formatTrigger(previewTask.trigger)}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{previewTask.projectName ?? DEFAULT_PROJECT}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{formatTaskModel(previewTask)}</dd>
              </div>
              <div>
                <dt>Tools</dt>
                <dd>{formatCapabilityList(previewTask.capabilityScope.capabilities, previewTask.capabilityScope.mcpServers, previewTask.capabilityScope.skills)}</dd>
              </div>
              <div>
                <dt>Autonomy</dt>
                <dd>{previewTask.capabilityScope.autonomyLevel === "scoped" ? "Scoped" : "Review first"}</dd>
              </div>
              <div>
                <dt>Notify</dt>
                <dd>{formatNotify(previewTask.notificationPolicy)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <footer className="tasks-builder-footer">
        <button className="tasks-secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <div>
          <button className="tasks-secondary-button" type="button" disabled={!canSave} title={canSave ? undefined : "Add a name, prompt, and available model"} onClick={() => onSave("paused")}>
            {editing ? "Save paused" : "Create paused"}
          </button>
          <button className="tasks-primary-button" type="button" disabled={!canSave} title={canSave ? undefined : "Add a name, prompt, and available model"} onClick={() => onSave("enabled")}>
            {editing ? "Save enabled" : "Create enabled"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function ToolBulkActions({
  canClear,
  canSelectAll,
  onClear,
  onSelectAll,
}: {
  canClear: boolean;
  canSelectAll: boolean;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  return (
    <div className="tasks-tool-actions">
      <button className="tasks-mini-button" type="button" disabled={!canSelectAll} onClick={onSelectAll}>
        <Check size={14} aria-hidden="true" />
        <span>Select all</span>
      </button>
      <button className="tasks-mini-button" type="button" disabled={!canClear} onClick={onClear}>
        <X size={14} aria-hidden="true" />
        <span>Clear</span>
      </button>
    </div>
  );
}

function ModelFields({
  modelOptions,
  onDraftChange,
  providerSettings,
  selectedModel,
  selectedProvider,
}: {
  modelOptions: ChatModelOption[];
  onDraftChange: (draft: AutomationTaskDraft) => void;
  providerSettings: ProviderSettings;
  selectedModel: string;
  selectedProvider: ModelProviderCatalogItem | undefined;
}) {
  const providerOptions = getSelectableTaskModelProviders(providerSettings);

  function selectProvider(providerId: ModelProviderId) {
    const model = resolveTaskProviderDefaultModel(providerSettings, providerId);
    onDraftChange({
      model,
      provider: providerId,
    });
  }

  return (
    <div className="tasks-model-grid">
      <label>
        <span>Model provider</span>
        <select
          disabled={providerOptions.length === 0}
          value={selectedProvider?.id ?? ""}
          onChange={(event) => {
            const providerId = event.target.value as ModelProviderId;
            if (providerOptions.some((provider) => provider.id === providerId)) {
              selectProvider(providerId);
            }
          }}
        >
          {providerOptions.length === 0 ? <option value="">Connect a provider first</option> : null}
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select
          disabled={!selectedProvider || modelOptions.length === 0}
          value={selectedModel}
          onChange={(event) => {
            if (selectedProvider) {
              onDraftChange({
                model: event.target.value,
                provider: selectedProvider.id,
              });
            }
          }}
        >
          {!selectedProvider ? <option value="">Choose a provider</option> : null}
          {selectedProvider && modelOptions.length === 0 ? <option value="">No models ready</option> : null}
          {modelOptions.map((option) => (
            <option key={option.id} value={option.value}>
              {option.label} - {formatModelPricingSummary(option.pricing)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ProjectField({
  activeProjectName,
  draft,
  onDraftChange,
  projects,
}: {
  activeProjectName: string;
  draft: AutomationTaskDraft;
  onDraftChange: (draft: AutomationTaskDraft) => void;
  projects: ProjectSummary[];
}) {
  const selectedProject = draft.projectName?.trim() || activeProjectName || DEFAULT_PROJECT;
  const projectOptions = getTaskProjectOptions(projects, activeProjectName, selectedProject);

  return (
    <label>
      <span>Project</span>
      <select value={selectedProject} onChange={(event) => onDraftChange({ projectName: event.target.value })}>
        {projectOptions.map((projectName) => (
          <option key={projectName} value={projectName}>
            {projectName}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScheduleFields({ draft, onDraftChange }: { draft: AutomationTaskDraft; onDraftChange: (draft: AutomationTaskDraft) => void }) {
  const trigger = draft.trigger ?? { kind: "manual" };

  function setTrigger(nextTrigger: AutomationTrigger) {
    onDraftChange({ trigger: nextTrigger });
  }

  return (
    <div className="tasks-form-grid tasks-form-grid-compact">
      <label>
        <span>Trigger</span>
        <select value={trigger.kind} onChange={(event) => {
          const kind = event.target.value as AutomationTrigger["kind"];
          if (kind === "interval") setTrigger({ everyMinutes: 60, kind });
          else if (kind === "daily") setTrigger({ kind, time: "09:00" });
          else setTrigger({ kind });
        }}>
          <option value="manual">Manual</option>
          <option value="interval">Every N minutes</option>
          <option value="daily">Daily</option>
          <option value="app_start">App start</option>
        </select>
      </label>
      {trigger.kind === "interval" ? (
        <label>
          <span>Minutes</span>
          <input
            min={5}
            type="number"
            value={trigger.everyMinutes}
            onChange={(event) => setTrigger({ everyMinutes: Number.parseInt(event.target.value, 10) || 60, kind: "interval" })}
          />
        </label>
      ) : null}
      {trigger.kind === "daily" ? (
        <label>
          <span>Time</span>
          <input type="time" value={trigger.time} onChange={(event) => setTrigger({ kind: "daily", time: event.target.value || "09:00" })} />
        </label>
      ) : null}
    </div>
  );
}

function NotifyFields({
  discordSettings,
  draft,
  onDraftChange,
}: {
  discordSettings: DiscordBridgeSettings;
  draft: AutomationTaskDraft;
  onDraftChange: (draft: AutomationTaskDraft) => void;
}) {
  const policy: Partial<AutomationNotificationPolicy> = {
    desktop: true,
    discord: false,
    maxSummaryChars: 900,
    privacy: "summary",
    ...draft.notificationPolicy,
  };
  const discordReady = isDiscordTaskNotificationReady(discordSettings);

  function patchPolicy(nextPolicy: Partial<AutomationNotificationPolicy>) {
    onDraftChange({ notificationPolicy: { ...policy, ...nextPolicy } });
  }

  return (
    <div className="tasks-notify-panel">
      <div className="tasks-notify-grid">
        <label>
          <input type="checkbox" checked={policy.desktop !== false} onChange={(event) => patchPolicy({ desktop: event.target.checked })} />
          <span>Desktop</span>
        </label>
        <label data-warning={policy.discord === true && !discordReady}>
          <input type="checkbox" checked={policy.discord === true} onChange={(event) => patchPolicy({ discord: event.target.checked })} />
          <span>Discord</span>
        </label>
        <label>
          <span>Privacy</span>
          <select value={policy.privacy ?? "summary"} onChange={(event) => patchPolicy({ privacy: event.target.value === "private" ? "private" : "summary" })}>
            <option value="summary">Summary</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          <span>Max chars</span>
          <input
            min={120}
            type="number"
            value={policy.maxSummaryChars ?? 900}
            onChange={(event) => patchPolicy({ maxSummaryChars: Number.parseInt(event.target.value, 10) || 900 })}
          />
        </label>
      </div>
      {policy.discord === true && !discordReady ? (
        <p className="tasks-inline-warning">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Discord notifications need an incoming webhook, or a bot token with an allowed channel ID.</span>
        </p>
      ) : null}
    </div>
  );
}

function TaskCard({
  lastRun,
  mcpServers,
  onDeleteTask,
  onDuplicateTask,
  onEditTask,
  onPauseTask,
  onRunTask,
  onSimulateTask,
  running,
  task,
}: {
  lastRun?: AutomationRun;
  mcpServers: McpServerState[];
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onEditTask: (task: AutomationTask) => void;
  onPauseTask: (taskId: string, paused: boolean) => void;
  onRunTask: (taskId: string) => void;
  onSimulateTask: (taskId: string) => void;
  running: boolean;
  task: AutomationTask;
}) {
  const paused = task.status !== "enabled";
  const capabilityLabels = getTaskCapabilityLabels(task, mcpServers);

  return (
    <article className="tasks-task-card" data-status={task.status}>
      <header>
        <div>
          <strong>{task.title}</strong>
          <small>{formatTrigger(task.trigger)}</small>
        </div>
        <span className="tasks-status-pill" data-status={task.status}>{task.status}</span>
      </header>
      <p>{task.lastResult || lastRun?.finalSummary || task.prompt}</p>
      <div className="tasks-card-meta">
        <span><Clock3 size={14} aria-hidden="true" />{task.nextRunAt ? formatDate(task.nextRunAt) : "Manual"}</span>
        <span><Folder size={14} aria-hidden="true" />{task.projectName ?? DEFAULT_PROJECT}</span>
        <span><Bot size={14} aria-hidden="true" />{formatTaskModel(task)}</span>
        <span><ShieldCheck size={14} aria-hidden="true" />{task.capabilityScope.autonomyLevel === "scoped" ? "Scoped" : "Review"}</span>
        <span><Bell size={14} aria-hidden="true" />{formatNotify(task.notificationPolicy)}</span>
      </div>
      <div className="tasks-card-capabilities">
        {capabilityLabels.length === 0 ? <span>Plain agent</span> : capabilityLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <footer>
        <button type="button" title={running ? "Task is already running" : "Run now"} disabled={running} onClick={() => onRunTask(task.id)}><Play size={15} aria-hidden="true" /></button>
        <button type="button" title={running ? "Task is already running" : "Simulate run"} disabled={running} onClick={() => onSimulateTask(task.id)}><RotateCcw size={15} aria-hidden="true" /></button>
        <button type="button" title={paused ? "Resume task" : "Pause task"} onClick={() => onPauseTask(task.id, !paused)}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </button>
        <button type="button" title="Edit task" onClick={() => onEditTask(task)}><Edit3 size={15} aria-hidden="true" /></button>
        <button type="button" title="Duplicate task" onClick={() => onDuplicateTask(task.id)}><Copy size={15} aria-hidden="true" /></button>
        <button type="button" title="Delete task" data-danger="true" onClick={() => onDeleteTask(task.id)}><Trash2 size={15} aria-hidden="true" /></button>
      </footer>
    </article>
  );
}

function RunList({
  emptyIcon,
  emptyTitle,
  onAcknowledgeRun,
  onEditTask,
  onOpenRunChat,
  onPauseTask,
  onSnoozeRun,
  runs,
  taskById,
  variant,
}: {
  emptyIcon: typeof Inbox;
  emptyTitle: string;
  onAcknowledgeRun: (runId: string) => void;
  onEditTask: (task: AutomationTask) => void;
  onOpenRunChat: (run: AutomationRun) => void;
  onPauseTask: (taskId: string, paused: boolean) => void;
  onSnoozeRun: (runId: string, minutes: number) => void;
  runs: AutomationRun[];
  taskById: Map<string, AutomationTask>;
  variant: "history" | "inbox";
}) {
  if (runs.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} />;
  }

  return (
    <div className="tasks-run-list" data-variant={variant}>
      {runs.map((run) => {
        const task = taskById.get(run.taskId);
        return (
          <article key={run.id} className="tasks-run-card" data-status={run.status}>
            <header>
              <div>
                <strong>{task?.title ?? "Deleted task"}</strong>
                <small>{formatDate(run.startedAt)} - {run.reason}</small>
              </div>
              <span className="tasks-status-pill" data-status={run.status}>{formatRunStatus(run.status)}</span>
            </header>
            <p>{run.finalSummary || run.error || "Run in progress."}</p>
            {run.notificationAttempts.some((attempt) => !attempt.ok) ? (
              <div className="tasks-run-warning">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{formatNotificationFailure(run)}</span>
              </div>
            ) : null}
            <div className="tasks-card-meta">
              <span><Workflow size={14} aria-hidden="true" />{run.toolCallCount ?? 0} tools</span>
              <span><Bot size={14} aria-hidden="true" />{formatTaskModel(run)}</span>
              <span><Inbox size={14} aria-hidden="true" />{run.notificationAttempts.length} notices</span>
              {run.status === "waiting_for_approval" ? <span><AlertTriangle size={14} aria-hidden="true" />approval</span> : null}
            </div>
            <footer>
              <button type="button" onClick={() => onOpenRunChat(run)}>Open run</button>
              {task ? <button type="button" onClick={() => onEditTask(task)}>Edit task</button> : null}
              {task ? <button type="button" onClick={() => onPauseTask(task.id, true)}>Pause task</button> : null}
              {variant === "inbox" ? <button type="button" onClick={() => onSnoozeRun(run.id, 60)}>Snooze</button> : null}
              {variant === "inbox" ? <button type="button" onClick={() => onAcknowledgeRun(run.id)}><Check size={15} aria-hidden="true" />Done</button> : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title }: { icon: typeof Inbox; title: string }) {
  return (
    <div className="tasks-empty">
      <Icon size={24} aria-hidden="true" />
      <strong>{title}</strong>
    </div>
  );
}

function applyTaskModelDefault(draft: AutomationTaskDraft, providerSettings: ProviderSettings): AutomationTaskDraft {
  const provider = resolveTaskModelProvider(draft, providerSettings);

  if (!provider) {
    const nextDraft = { ...draft };
    delete nextDraft.model;
    delete nextDraft.provider;
    return nextDraft;
  }

  const modelOptions = getTaskModelOptions(providerSettings, provider.id, draft.model);
  const model = resolveTaskModelValue(draft, providerSettings, provider.id, modelOptions);

  return {
    ...draft,
    model,
    provider: provider.id,
  };
}

function withTaskProjectDefault(draft: AutomationTaskDraft, activeProjectName: string): AutomationTaskDraft {
  return {
    ...draft,
    projectName: draft.projectName?.trim() || activeProjectName || DEFAULT_PROJECT,
  };
}

function isTaskDraftReady(draft: AutomationTaskDraft, providerSettings: ProviderSettings) {
  const provider = resolveTaskModelProvider(draft, providerSettings);
  const modelOptions = provider ? getTaskModelOptions(providerSettings, provider.id, draft.model) : [];
  const model = provider ? resolveTaskModelValue(draft, providerSettings, provider.id, modelOptions) : "";

  return Boolean(draft.title?.trim() && draft.prompt?.trim() && provider && model);
}

function getSelectableTaskModelProviders(providerSettings: ProviderSettings) {
  return MODEL_PROVIDERS.filter((provider) => isSelectableTaskModelProvider(providerSettings, provider));
}

function isSelectableTaskModelProvider(providerSettings: ProviderSettings, provider: ModelProviderCatalogItem) {
  if (provider.id === "9router") {
    return providerSettings.provider === "9router";
  }

  if (prefersLiveModelCatalog(provider.id)) {
    return providerSettings.provider === provider.id && Boolean(providerSettings.providerModels[provider.id]?.trim());
  }

  if (provider.requiresApiKey) {
    return Boolean(getProviderApiKeyForProvider(providerSettings, provider.id).trim());
  }

  return true;
}

function resolveTaskModelProvider(draft: AutomationTaskDraft, providerSettings: ProviderSettings) {
  const providers = getSelectableTaskModelProviders(providerSettings);
  const draftProvider = draft.provider ? providers.find((provider) => provider.id === draft.provider) : undefined;

  return draftProvider ?? providers.find((provider) => provider.id === providerSettings.provider) ?? providers[0];
}

function getTaskModelOptions(providerSettings: ProviderSettings, provider: ModelProviderId, currentModel?: string) {
  const selectedModel = currentModel?.trim() || providerSettings.providerModels[provider]?.trim() || getDefaultModelForProvider(provider);

  return filterEnabledProviderModelOptions(
    buildProviderModelOptions(provider, undefined, selectedModel),
    providerSettings.disabledModels[provider],
  );
}

function resolveTaskProviderDefaultModel(providerSettings: ProviderSettings, provider: ModelProviderId) {
  const modelOptions = getTaskModelOptions(providerSettings, provider);
  const rememberedModel = providerSettings.providerModels[provider]?.trim();

  if (rememberedModel && modelOptions.some((option) => option.value === rememberedModel)) {
    return rememberedModel;
  }

  return modelOptions[0]?.value ?? normalizeProviderModelId(provider, getDefaultModelForProvider(provider));
}

function resolveTaskModelValue(
  draft: AutomationTaskDraft,
  providerSettings: ProviderSettings,
  provider: ModelProviderId,
  modelOptions: ChatModelOption[],
) {
  const requestedModel = draft.model?.trim() || providerSettings.providerModels[provider]?.trim();
  const normalizedModel = normalizeProviderModelId(provider, requestedModel || getDefaultModelForProvider(provider));

  return modelOptions.some((option) => option.value === normalizedModel)
    ? normalizedModel
    : modelOptions[0]?.value ?? normalizedModel;
}

function formatTaskModel(task: Pick<AutomationTask, "model" | "provider">) {
  if (!task.provider || !task.model) {
    return "Default model";
  }

  return `${getModelProvider(task.provider).label}: ${formatCompactModel(task.model)}`;
}

function formatCompactModel(model: string) {
  return model.length > 28 ? `${model.slice(0, 25).trim()}...` : model;
}

function isDiscordTaskNotificationReady(settings: DiscordBridgeSettings) {
  return Boolean(
    settings.incomingWebhookUrl.trim() ||
    (settings.enabled && settings.botToken.trim() && getFirstDiscordId(settings.allowedChannelIds)),
  );
}

function getFirstDiscordId(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .find((part) => /^\d{12,24}$/.test(part));
}

function formatNotificationFailure(run: AutomationRun) {
  const failedAttempt = [...run.notificationAttempts].reverse().find((attempt) => !attempt.ok);
  return failedAttempt?.detail || "One notification channel failed.";
}

function formatStepLabel(step: BuilderStep) {
  return step[0].toUpperCase() + step.slice(1);
}

function getTaskProjectOptions(projects: ProjectSummary[], activeProjectName: string, selectedProjectName: string) {
  const options: string[] = [];
  const add = (value?: string | null) => {
    const projectName = value?.trim() || DEFAULT_PROJECT;
    if (!options.some((option) => option.toLowerCase() === projectName.toLowerCase())) {
      options.push(projectName);
    }
  };

  add(DEFAULT_PROJECT);
  add(activeProjectName);
  projects.forEach((project) => add(project.name));
  add(selectedProjectName);
  return options;
}

function getInstalledMcpToolServers(servers: McpServerState[]) {
  return servers
    .filter((server) => server.enabled && server.tools.length > 0)
    .map((server) => ({
      ...server,
      tools: [...server.tools].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getInstalledTaskSkills(skillRegistry: SkillRegistryState) {
  return skillRegistry.skills
    .filter((skill) => skill.installed && skill.enabled)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createTaskSkillScope(skill: AppSkill) {
  return {
    id: skill.id,
    name: skill.name,
    trigger: skill.trigger,
  };
}

function createMcpServerScope(server: McpServerState) {
  return {
    serverId: server.id,
    serverName: server.name,
    toolNames: server.tools.map((tool) => tool.name),
  };
}

function isMcpServerSelected(scopes: NonNullable<AutomationTaskDraft["capabilityScope"]>["mcpServers"], serverId: string) {
  return scopes?.some((scope) => scope.serverId === serverId && scope.toolNames.length > 0) === true;
}

function isSkillSelected(scopes: NonNullable<AutomationTaskDraft["capabilityScope"]>["skills"], skillId: string) {
  return scopes?.some((scope) => scope.id === skillId) === true;
}

function normalizeToolSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesCapabilitySearch(capability: (typeof AUTOMATION_CAPABILITIES)[number], query: string) {
  return matchesToolSearch(query, [
    capability.id,
    capability.label,
    capability.description,
    capability.promptHint,
    capability.risk,
  ]);
}

function matchesSkillSearch(skill: AppSkill, query: string) {
  return matchesToolSearch(query, [
    skill.id,
    skill.name,
    skill.trigger,
    skill.description,
    skill.category,
    skill.source,
    ...skill.tags,
  ]);
}

function matchesMcpServerSearch(server: McpServerState, query: string) {
  return matchesToolSearch(query, [
    server.id,
    server.name,
    server.serverName,
    server.serverVersion,
    server.command,
    server.endpoint,
    server.transport,
    ...server.tools.flatMap((tool) => [tool.name, formatMcpToolLabel(tool.name), tool.description]),
  ]);
}

function matchesToolSearch(query: string, values: Array<string | undefined>) {
  if (!query) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(query));
}

function formatMcpToolLabel(toolName: string) {
  return toolName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || toolName;
}

function formatMcpServerToolSummary(server: McpServerState) {
  const previewTools = server.tools.slice(0, 3).map((tool) => formatMcpToolLabel(tool.name)).join(", ");
  const hiddenCount = server.tools.length - 3;
  const preview = previewTools ? ` - ${previewTools}${hiddenCount > 0 ? ` +${hiddenCount}` : ""}` : "";
  return `${server.tools.length} MCP tool${server.tools.length === 1 ? "" : "s"}${preview}`;
}

function getTaskCapabilityLabels(task: AutomationTask, installedMcpServers: McpServerState[] = []) {
  const labels = task.capabilityScope.capabilities.map((id) => getAutomationCapabilityDefinition(id)?.label ?? id);
  const installedServerIds = new Set(installedMcpServers.filter((server) => server.enabled).map((server) => server.id));
  const mcpLabels = task.capabilityScope.mcpServers
    .filter((server) => installedServerIds.has(server.serverId))
    .map((server) => server.toolNames.length === 1
      ? `${server.serverName}: ${formatMcpToolLabel(server.toolNames[0] ?? "")}`
      : `${server.serverName}: ${server.toolNames.length} MCP tools`);

  const skillLabels = task.capabilityScope.skills.map((skill) => `${skill.trigger} ${skill.name}`);

  return [...labels, ...skillLabels, ...mcpLabels];
}

function formatCapabilityList(
  capabilities: AutomationCapabilityId[],
  mcpServers: AutomationTask["capabilityScope"]["mcpServers"] = [],
  skills: AutomationTask["capabilityScope"]["skills"] = [],
) {
  const labels = [
    ...capabilities.map((id) => getAutomationCapabilityDefinition(id)?.label ?? id),
    ...skills.map((skill) => `${skill.trigger} ${skill.name}`),
    ...mcpServers.map((server) => server.toolNames.length === 1
      ? `${server.serverName}: ${formatMcpToolLabel(server.toolNames[0] ?? "")}`
      : `${server.serverName}: ${server.toolNames.length} MCP tools`),
  ];

  return labels.length > 0 ? labels.join(", ") : "Plain agent";
}

function formatNotify(policy: AutomationNotificationPolicy) {
  const channels = [
    "Inbox",
    policy.desktop ? "Desktop" : "",
    policy.discord ? "Discord" : "",
  ].filter(Boolean);
  return channels.join(", ");
}

function formatTrigger(trigger: AutomationTrigger) {
  if (trigger.kind === "manual") return "Manual";
  if (trigger.kind === "app_start") return "App start";
  if (trigger.kind === "interval") return `Every ${trigger.everyMinutes} min`;
  return `Daily ${trigger.time}`;
}

function formatDate(value: string) {
  return formatDeviceTaskDateTime(value);
}

function formatRunStatus(status: AutomationRun["status"]) {
  return status.replace(/_/g, " ");
}
