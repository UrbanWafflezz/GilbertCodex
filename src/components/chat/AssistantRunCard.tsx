import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, FileCode2, FileText, Globe2, LoaderCircle, Pencil, Plug, X } from "lucide-react";
import type { AgentApproval, AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage, ChatSource, ChatToolCall, ChatToolFileChange } from "../../types/chat";

type RunStageKey = "planning" | "reading" | "editing" | "terminal" | "browser" | "web" | "mcp" | "approval" | "summary";
type RunStageStatus = "active" | "complete" | "idle" | "issue" | "skipped" | "waiting";
type RunLaneStatus = ChatToolCall["status"] | "pending";

interface AssistantRunCardProps {
  embedded?: boolean;
  message: ChatMessage;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  responseStarted?: boolean;
}

interface RunStage {
  detail: string;
  key: RunStageKey;
  label: string;
  status: RunStageStatus;
}

interface RunFileItem {
  action: string;
  additions?: number;
  deletions?: number;
  detail?: string;
  id: string;
  path: string;
  status: RunLaneStatus;
}

interface RunTerminalItem {
  command: string;
  failure?: string;
  id: string;
  outputPreview?: string;
  status: RunLaneStatus;
  workingDirectory?: string;
}

interface RunBrowserItem {
  detail?: string;
  id: string;
  label: string;
  status: RunLaneStatus;
  target?: string;
}

interface RunMcpItem {
  detail?: string;
  id: string;
  server?: string;
  status: RunLaneStatus;
  tool: string;
}

interface RunSummary {
  changed: string;
  failed: string;
  needsUser: string;
}

interface AssistantRunView {
  approvals: AgentApproval[];
  browserItems: RunBrowserItem[];
  fileItems: RunFileItem[];
  hasWebLane: boolean;
  live: boolean;
  mcpItems: RunMcpItem[];
  needsAttention: boolean;
  sources: ChatSource[];
  stages: RunStage[];
  status: RunStageStatus;
  statusLabel: string;
  summary: RunSummary;
  terminalItems: RunTerminalItem[];
  title: string;
  webDetail: string;
}

const STAGE_LABELS: Array<{ key: RunStageKey; label: string }> = [
  { key: "planning", label: "Planning" },
  { key: "reading", label: "Reading" },
  { key: "editing", label: "Editing" },
  { key: "terminal", label: "Terminal" },
  { key: "browser", label: "Browser" },
  { key: "web", label: "Web" },
  { key: "mcp", label: "MCP" },
  { key: "approval", label: "Approval" },
  { key: "summary", label: "Summary" },
];

export function hasAssistantRunDetails(message: ChatMessage, responseStarted = false) {
  const run = createAssistantRunView(message, responseStarted);

  return Boolean(
    run &&
      (run.fileItems.length > 0 ||
        run.terminalItems.length > 0 ||
        run.browserItems.length > 0 ||
        run.mcpItems.length > 0 ||
        run.hasWebLane ||
        run.approvals.length > 0 ||
        run.needsAttention),
  );
}

export function AssistantRunCard({ embedded = false, message, onResolveToolApproval, responseStarted = false }: AssistantRunCardProps) {
  const run = useMemo(() => createAssistantRunView(message, responseStarted), [message, responseStarted]);
  const [expanded, setExpanded] = useState(() => Boolean(embedded || run?.live || run?.needsAttention));

  if (!run) {
    return null;
  }

  if (embedded) {
    return (
      <AssistantRunInline run={run} messageId={message.id} onResolveToolApproval={onResolveToolApproval} />
    );
  }

  return (
    <section className="assistant-run-card" data-status={run.status} data-expanded={expanded} aria-label="Assistant run card">
      <button className="assistant-run-card-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
        <span className="assistant-run-card-status" data-status={run.status} aria-hidden="true">
          <RunStatusIcon status={run.status} />
        </span>
        <span className="assistant-run-card-title">
          <strong>{run.title}</strong>
          <small>{run.statusLabel}</small>
        </span>
        <span className="assistant-run-card-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {expanded ? (
        <div className="assistant-run-card-body">
          <RunStageStrip stages={run.stages} />
          <RunFileLane items={run.fileItems} />
          <RunTerminalLane items={run.terminalItems} />
          <RunBrowserLane items={run.browserItems} />
          <RunSourceLane detail={run.webDetail} hasWebLane={run.hasWebLane} sources={run.sources} />
          <RunMcpLane items={run.mcpItems} />
          <RunApprovalLane approvals={run.approvals} messageId={message.id} onResolveToolApproval={onResolveToolApproval} />
          <RunSummaryLane summary={run.summary} />
        </div>
      ) : null}
    </section>
  );
}

export function AssistantRunToolProcessRow({ toolCall }: { toolCall: ChatToolCall }) {
  if (!isVisibleAssistantRunToolCall(toolCall)) {
    return null;
  }

  const fileItems = collectRunFileItems([toolCall]);
  const terminalItems = collectRunTerminalItems([toolCall]);
  const browserItems = collectRunBrowserItems([toolCall]);
  const mcpItems = collectRunMcpItems([toolCall]);

  if (fileItems.length > 0) {
    const group = createInlineBatchFileGroup(toolCall, fileItems) ?? createInlineFileGroups(fileItems)[0];

    if (group) {
      return (
        <InlineProcessRow
          collapsible
          defaultExpanded={false}
          detail={group.detail}
          icon={group.icon}
          status={group.status}
          title={group.title}
        >
          <InlineFileItems files={group.files} />
        </InlineProcessRow>
      );
    }
  }

  if (terminalItems.length > 0) {
    return (
      <InlineProcessRow
        detail={formatTerminalInlineDetail(terminalItems)}
        icon={<FileCode2 size={16} />}
        status={getInlineStatus(terminalItems.map((item) => item.status))}
        title={formatTerminalInlineTitle(terminalItems)}
      />
    );
  }

  if (browserItems.length > 0) {
    return (
      <InlineProcessRow
        detail={browserItems[0]?.target || browserItems[0]?.detail || "Browser preview activity"}
        icon={<Globe2 size={16} />}
        status={getInlineStatus(browserItems.map((item) => item.status))}
        title={`${browserItems.some((item) => item.status === "active") ? "Checking" : "Checked"} browser`}
      />
    );
  }

  if (mcpItems.length > 0) {
    return (
      <InlineProcessRow
        collapsible={mcpItems.length > 0}
        defaultExpanded={true}
        detail={formatMcpInlineDetail(mcpItems)}
        icon={<Plug size={16} />}
        status={getInlineStatus(mcpItems.map((item) => item.status))}
        title={formatMcpInlineTitle(mcpItems)}
      >
        <InlineMcpItems items={mcpItems} />
      </InlineProcessRow>
    );
  }

  if (isWebToolCall(toolCall)) {
    return (
      <InlineProcessRow
        detail={cleanInlineText(toolCall.detail ?? toolCall.output ?? "")}
        icon={<Globe2 size={16} />}
        status={toolCall.status}
        title={toolCall.status === "active" ? "Searching web" : "Searched web"}
      />
    );
  }

  return null;
}

function AssistantRunInline({
  messageId,
  onResolveToolApproval,
  run,
}: {
  messageId: string;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  run: AssistantRunView;
}) {
  const fileGroups = createInlineFileGroups(run.fileItems);
  const pendingApprovals = run.approvals.filter((approval) => approval.status === "pending");
  const resolvedApprovals = run.approvals.filter((approval) => approval.status !== "pending");

  return (
    <section className="assistant-run-inline" data-status={run.status} aria-label="Assistant process">
      {fileGroups.map((group) => (
        <InlineProcessRow
          collapsible={group.files.length > 0}
          defaultExpanded={true}
          detail={group.detail}
          icon={group.icon}
          key={group.key}
          status={group.status}
          title={group.title}
        >
          {group.files.length > 0 ? (
            <InlineFileItems files={group.files} />
          ) : null}
        </InlineProcessRow>
      ))}

      {run.terminalItems.length > 0 ? (
        <InlineProcessRow
          detail={formatTerminalInlineDetail(run.terminalItems)}
          icon={<FileCode2 size={16} />}
          status={getInlineStatus(run.terminalItems.map((item) => item.status))}
          title={formatTerminalInlineTitle(run.terminalItems)}
        />
      ) : null}

      {run.browserItems.length > 0 ? (
        <InlineProcessRow
          detail={run.browserItems[0]?.target || run.browserItems[0]?.detail || "Browser preview activity"}
          icon={<Globe2 size={16} />}
          status={getInlineStatus(run.browserItems.map((item) => item.status))}
          title={`${run.browserItems.some((item) => item.status === "active") ? "Checking" : "Checked"} browser`}
        />
      ) : null}

      {run.mcpItems.length > 0 ? (
        <InlineProcessRow
          collapsible
          defaultExpanded={true}
          detail={formatMcpInlineDetail(run.mcpItems)}
          icon={<Plug size={16} />}
          status={getInlineStatus(run.mcpItems.map((item) => item.status))}
          title={formatMcpInlineTitle(run.mcpItems)}
        >
          <InlineMcpItems items={run.mcpItems} />
        </InlineProcessRow>
      ) : null}

      {run.hasWebLane ? (
        <InlineProcessRow
          detail={run.webDetail}
          icon={<Globe2 size={16} />}
          status={run.status === "active" ? "active" : "complete"}
          title={run.sources.length > 0 ? `Found ${formatCount(run.sources.length, "source")}` : "Searched web"}
        >
          {run.sources.length > 0 ? (
            <div className="assistant-run-inline-sources">
              {run.sources.slice(0, 4).map((source) => (
                <a href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank">
                  {formatSourceHost(source.url)}
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : null}
        </InlineProcessRow>
      ) : null}

      {pendingApprovals.length > 0 ? (
        <InlineProcessRow
          detail={pendingApprovals.map((approval) => approval.title).join(", ")}
          icon={<AlertTriangle size={16} />}
          status="waiting_approval"
          title={`Needs ${formatCount(pendingApprovals.length, "approval")}`}
        >
          <div className="assistant-run-inline-approval-actions">
            {pendingApprovals.slice(0, 2).map((approval) => (
              <span key={approval.id}>
                <b>{formatRiskLabel(approval.risk)}</b>
                {onResolveToolApproval ? (
                  <>
                    <button type="button" onClick={() => void onResolveToolApproval(messageId, approval.id, { status: "approved" })}>Allow</button>
                    <button type="button" onClick={() => void onResolveToolApproval(messageId, approval.id, { status: "denied" })}>Deny</button>
                  </>
                ) : null}
              </span>
            ))}
          </div>
        </InlineProcessRow>
      ) : resolvedApprovals.length > 0 ? (
        <InlineProcessRow
          detail={resolvedApprovals.map((approval) => approval.status).join(", ")}
          icon={<Check size={16} />}
          status="complete"
          title={`Resolved ${formatCount(resolvedApprovals.length, "approval")}`}
        />
      ) : null}

      {!run.live && (run.summary.failed !== "Nothing failed in the recorded run." || run.summary.needsUser !== "Nothing is currently waiting on you.") ? (
        <InlineProcessRow
          detail={[run.summary.failed, run.summary.needsUser].filter((part) => part && !part.startsWith("Nothing")).join(" ")}
          icon={<Check size={16} />}
          status={run.status}
          title="Run summary"
        />
      ) : null}
    </section>
  );
}

function InlineFileItems({ files }: { files: RunFileItem[] }) {
  return (
    <div className="assistant-run-inline-files">
      {files.slice(0, 10).map((file) => (
        <div className="assistant-run-inline-file-line" data-action={file.action} data-status={file.status} key={file.id} title={file.path}>
          <em>{formatInlineFileVerb(file)}</em>
          <b>{formatActivityPath(file.path)}</b>
          {isChangedFileItem(file) ? (
            <small>
              <i data-kind="add">+{formatNumber(file.additions ?? 0)}</i>
              <i data-kind="delete">-{formatNumber(file.deletions ?? 0)}</i>
            </small>
          ) : null}
          <i className="assistant-run-inline-file-state" aria-hidden="true" />
        </div>
      ))}
      {files.length > 10 ? <div className="assistant-run-inline-file-line" data-action="more">+{files.length - 10} more</div> : null}
    </div>
  );
}

function InlineMcpItems({ items }: { items: RunMcpItem[] }) {
  return (
    <div className="assistant-run-inline-mcp">
      {items.slice(0, 8).map((item) => (
        <div className="assistant-run-inline-mcp-line" data-status={item.status} key={item.id}>
          <em>{formatInlineMcpVerb(item.status)}</em>
          <b>{item.tool}</b>
          {item.server ? <small>{item.server}</small> : null}
          <i className="assistant-run-inline-file-state" aria-hidden="true" />
        </div>
      ))}
      {items.length > 8 ? <div className="assistant-run-inline-mcp-line" data-status="complete">+{items.length - 8} more MCP calls</div> : null}
    </div>
  );
}

function InlineProcessRow({
  children,
  collapsible = false,
  defaultExpanded = false,
  detail,
  icon,
  status,
  title,
}: {
  children?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  detail?: string;
  icon: ReactNode;
  status: RunLaneStatus | RunStageStatus;
  title: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const canExpand = Boolean(collapsible && children);
  const header = (
    <>
      <strong>{title}</strong>
      {detail ? <small>{detail}</small> : null}
      {canExpand ? (
        <span className="assistant-run-inline-disclosure" aria-hidden="true">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="assistant-run-inline-row" data-expanded={expanded} data-status={status}>
      <span className="assistant-run-inline-icon" aria-hidden="true">{icon}</span>
      <div className="assistant-run-inline-copy">
        {canExpand ? (
          <button
            className="assistant-run-inline-summary"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {header}
          </button>
        ) : (
          <span className="assistant-run-inline-summary">{header}</span>
        )}
        {children && (!canExpand || expanded) ? children : null}
      </div>
    </div>
  );
}

function RunStatusIcon({ status }: { status: RunStageStatus }) {
  if (status === "active") return <LoaderCircle size={14} />;
  if (status === "waiting") return <AlertTriangle size={14} />;
  if (status === "issue" || status === "skipped") return <X size={14} />;
  return <Check size={14} />;
}

function RunStageStrip({ stages }: { stages: RunStage[] }) {
  return (
    <div className="assistant-run-stages" aria-label="Run stages">
      {stages.map((stage) => (
        <span className="assistant-run-stage" data-stage={stage.key} data-status={stage.status} key={stage.key} title={stage.detail}>
          <b aria-hidden="true" />
          <span>{stage.label}</span>
        </span>
      ))}
    </div>
  );
}

function RunFileLane({ items }: { items: RunFileItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="assistant-run-lane" data-lane="files" aria-label="File activity">
      <RunLaneHeading icon={<FileText size={14} />} title="Files" detail={`${items.length} item${items.length === 1 ? "" : "s"}`} />
      <div className="assistant-run-file-list">
        {items.map((item) => (
          <article className="assistant-run-file-row" data-status={item.status} key={item.id}>
            <span className="assistant-run-file-action">{item.action}</span>
            <span className="assistant-run-file-path" title={item.path}>{formatActivityPath(item.path)}</span>
            {typeof item.additions === "number" || typeof item.deletions === "number" ? (
              <span className="assistant-run-file-diff">+{formatNumber(item.additions ?? 0)} -{formatNumber(item.deletions ?? 0)}</span>
            ) : item.detail ? (
              <small>{item.detail}</small>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RunTerminalLane({ items }: { items: RunTerminalItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="assistant-run-lane" data-lane="terminal" aria-label="Terminal activity">
      <RunLaneHeading icon={<FileCode2 size={14} />} title="Terminal" detail={`${items.length} command${items.length === 1 ? "" : "s"}`} />
      <div className="assistant-run-terminal-list">
        {items.map((item) => (
          <article className="assistant-run-terminal-row" data-status={item.status} key={item.id}>
            <code>{item.command}</code>
            {item.workingDirectory ? <small>cwd: {formatActivityPath(item.workingDirectory)}</small> : null}
            {item.failure ? <strong>{item.failure}</strong> : null}
            {item.outputPreview ? <pre>{item.outputPreview}</pre> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RunBrowserLane({ items }: { items: RunBrowserItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="assistant-run-lane" data-lane="browser" aria-label="Browser activity">
      <RunLaneHeading icon={<Globe2 size={14} />} title="Browser" detail={`${items.length} action${items.length === 1 ? "" : "s"}`} />
      <div className="assistant-run-browser-list">
        {items.map((item) => (
          <article className="assistant-run-browser-row" data-status={item.status} key={item.id}>
            <span>
              <strong>{item.label}</strong>
              {item.target ? <small>{item.target}</small> : item.detail ? <small>{item.detail}</small> : null}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function RunMcpLane({ items }: { items: RunMcpItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="assistant-run-lane" data-lane="mcp" aria-label="MCP activity">
      <RunLaneHeading icon={<Plug size={14} />} title="MCP" detail={`${items.length} call${items.length === 1 ? "" : "s"}`} />
      <div className="assistant-run-mcp-list">
        {items.map((item) => (
          <article className="assistant-run-mcp-row" data-status={item.status} key={item.id}>
            <span>
              <strong>{formatInlineMcpVerb(item.status)}</strong>
              <b>{item.tool}</b>
              {item.server ? <small>{item.server}</small> : null}
            </span>
            {item.detail ? <small>{item.detail}</small> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RunSourceLane({ detail, hasWebLane, sources }: { detail: string; hasWebLane: boolean; sources: ChatSource[] }) {
  if (!hasWebLane) return null;

  return (
    <section className="assistant-run-lane" data-lane="sources" aria-label="Web sources">
      <RunLaneHeading icon={<Globe2 size={14} />} title="Sources" detail={detail} />
      {sources.length > 0 ? (
        <div className="assistant-run-source-list">
          {sources.map((source, index) => (
            <a className="assistant-run-source-row" href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank">
              <span className="assistant-run-source-index">{index + 1}</span>
              <span>
                <strong>{cleanInlineText(source.title) || formatSourceHost(source.url)}</strong>
                <small>{formatSourceDetail(source)}</small>
              </span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : (
        <p className="assistant-run-empty-lane">Web/search ran, but no source cards were recorded.</p>
      )}
    </section>
  );
}

function RunApprovalLane({
  approvals,
  messageId,
  onResolveToolApproval,
}: {
  approvals: AgentApproval[];
  messageId: string;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}) {
  if (approvals.length === 0) return null;

  return (
    <section className="assistant-run-lane" data-lane="approvals" aria-label="Approval cards">
      <RunLaneHeading icon={<AlertTriangle size={14} />} title="Approvals" detail={`${approvals.length} request${approvals.length === 1 ? "" : "s"}`} />
      <div className="assistant-run-approval-list">
        {approvals.map((approval) => {
          const pending = approval.status === "pending";

          return (
            <article className="assistant-run-approval-card" data-risk={approval.risk} data-status={approval.status} key={approval.id}>
              <div>
                <strong>{approval.title}</strong>
                <small>{approval.detail ?? formatApprovalTarget(approval)}</small>
              </div>
              <span className="assistant-run-risk">{formatRiskLabel(approval.risk)}</span>
              {pending && onResolveToolApproval ? (
                <div className="assistant-run-approval-actions">
                  <button type="button" onClick={() => void onResolveToolApproval(messageId, approval.id, { status: "approved" })}>
                    <Check size={13} aria-hidden="true" />
                    <span>Allow</span>
                  </button>
                  <button type="button" onClick={() => void onResolveToolApproval(messageId, approval.id, { status: "denied" })}>
                    <X size={13} aria-hidden="true" />
                    <span>Deny</span>
                  </button>
                </div>
              ) : (
                <small className="assistant-run-approval-state">{approval.status}</small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RunSummaryLane({ summary }: { summary: RunSummary }) {
  return (
    <section className="assistant-run-lane assistant-run-summary" data-lane="summary" aria-label="Run summary">
      <RunLaneHeading icon={<Pencil size={14} />} title="Summary" detail="What changed, failed, and needs you" />
      <dl>
        <div>
          <dt>What changed</dt>
          <dd>{summary.changed}</dd>
        </div>
        <div>
          <dt>What failed</dt>
          <dd>{summary.failed}</dd>
        </div>
        <div>
          <dt>What still needs you</dt>
          <dd>{summary.needsUser}</dd>
        </div>
      </dl>
    </section>
  );
}

function RunLaneHeading({ detail, icon, title }: { detail: string; icon: ReactNode; title: string }) {
  return (
    <div className="assistant-run-lane-heading">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  );
}

function createAssistantRunView(message: ChatMessage, responseStarted: boolean): AssistantRunView | null {
  const toolCalls = (message.toolCalls ?? []).filter(isVisibleAssistantRunToolCall);
  const approvals = message.approvals ?? [];
  const progressItems = message.progress ?? [];
  const fileItems = collectRunFileItems(toolCalls);
  const terminalItems = collectRunTerminalItems(toolCalls);
  const browserItems = collectRunBrowserItems(toolCalls);
  const mcpItems = collectRunMcpItems(toolCalls);
  const hasWebLane = hasRealWebSearchRun(message);
  const sources = hasWebLane ? getUniqueSources(message.sources ?? []) : [];
  const planningStatus = getPlanningStageStatus(message, responseStarted);
  const readingStatus = getToolFamilyStageStatus(toolCalls.filter(isFileReadingToolCall));
  const editingStatus = getToolFamilyStageStatus(toolCalls.filter(isFileEditingToolCall));
  const terminalStatus = getToolFamilyStageStatus(toolCalls.filter(isTerminalToolCall));
  const browserStatus = getToolFamilyStageStatus(toolCalls.filter(isBrowserToolCall));
  const webStatus = getWebStageStatus(message, toolCalls);
  const mcpStatus = getToolFamilyStageStatus(toolCalls.filter(isMcpToolCall));
  const approvalStatus = getApprovalStageStatus(approvals);
  const summaryStatus = getSummaryStageStatus(message, responseStarted, approvals);
  const live = Boolean(
    message.isStreaming ||
      message.agentRunStatus === "queued" ||
      message.agentRunStatus === "running" ||
      toolCalls.some((toolCall) => toolCall.status === "active" || toolCall.status === "waiting_approval") ||
      progressItems.some((item) => item.status === "active"),
  );
  const issueCount = toolCalls.filter((toolCall) => toolCall.status === "error").length;
  const pendingApprovalCount = approvals.filter((approval) => approval.status === "pending").length;
  const shouldRender = Boolean(
    message.agentRunId ||
      message.agentRunStatus ||
      toolCalls.length > 0 ||
      approvals.length > 0 ||
      progressItems.length > 0 ||
      hasWebLane,
  );

  if (!shouldRender) {
    return null;
  }

  const status = chooseOverallRunStatus({ issueCount, live, pendingApprovalCount, toolCalls });

  return {
    approvals,
    browserItems,
    fileItems,
    hasWebLane,
    live,
    mcpItems,
    needsAttention: pendingApprovalCount > 0 || issueCount > 0,
    sources,
    stages: STAGE_LABELS.map(({ key, label }) => ({
      detail: formatStageDetail(key),
      key,
      label,
      status: {
        approval: approvalStatus,
        browser: browserStatus,
        editing: editingStatus,
        mcp: mcpStatus,
        planning: planningStatus,
        reading: readingStatus,
        summary: summaryStatus,
        terminal: terminalStatus,
        web: webStatus,
      }[key],
    })),
    status,
    statusLabel: createRunStatusLabel({ fileItems, issueCount, live, pendingApprovalCount, toolCalls }),
    summary: createRunSummary({ approvals, fileItems, message, terminalItems, toolCalls }),
    terminalItems,
    title: message.agentRunId ? "Agent run" : "Request run",
    webDetail: createWebLaneDetail(message, sources),
  };
}

function getPlanningStageStatus(message: ChatMessage, responseStarted: boolean): RunStageStatus {
  if (message.planning?.inputRequest && !message.planning.inputRequest.answeredAt) return "waiting";
  if (message.isStreaming && !responseStarted) return "active";
  if (message.planning) return "complete";
  return message.toolCalls?.length || responseStarted ? "complete" : "idle";
}

function getToolFamilyStageStatus(toolCalls: ChatToolCall[]): RunStageStatus {
  if (toolCalls.length === 0) return "idle";
  if (toolCalls.some((toolCall) => toolCall.status === "waiting_approval")) return "waiting";
  if (toolCalls.some((toolCall) => toolCall.status === "active")) return "active";
  if (toolCalls.some((toolCall) => toolCall.status === "error")) return "issue";
  if (toolCalls.every((toolCall) => toolCall.status === "skipped")) return "skipped";
  return "complete";
}

function getWebStageStatus(message: ChatMessage, toolCalls: ChatToolCall[]): RunStageStatus {
  const webToolCalls = toolCalls.filter(isWebToolCall);
  if (!hasRealWebSearchRun(message) && webToolCalls.length === 0) return "idle";
  if (message.webSearch?.status === "active" || webToolCalls.some((toolCall) => toolCall.status === "active")) return "active";
  if (message.webSearch?.status === "error" || webToolCalls.some((toolCall) => toolCall.status === "error")) return "issue";
  return "complete";
}

function getApprovalStageStatus(approvals: AgentApproval[]): RunStageStatus {
  if (approvals.length === 0) return "idle";
  if (approvals.some((approval) => approval.status === "pending")) return "waiting";
  if (approvals.some((approval) => approval.status === "denied" || approval.status === "expired")) return "skipped";
  return "complete";
}

function getSummaryStageStatus(message: ChatMessage, responseStarted: boolean, approvals: AgentApproval[]): RunStageStatus {
  if (approvals.some((approval) => approval.status === "pending")) return "waiting";
  if (message.isStreaming) return responseStarted ? "active" : "idle";
  if (message.content.trim() || responseStarted || message.agentRunStatus === "completed") return "complete";
  if (message.agentRunStatus === "failed") return "issue";
  return "idle";
}

function chooseOverallRunStatus({
  issueCount,
  live,
  pendingApprovalCount,
  toolCalls,
}: {
  issueCount: number;
  live: boolean;
  pendingApprovalCount: number;
  toolCalls: ChatToolCall[];
}): RunStageStatus {
  if (pendingApprovalCount > 0 || toolCalls.some((toolCall) => toolCall.status === "waiting_approval")) return "waiting";
  if (live) return "active";
  if (issueCount > 0) return "issue";
  if (toolCalls.length > 0 && toolCalls.every((toolCall) => toolCall.status === "skipped")) return "skipped";
  return "complete";
}

function createRunStatusLabel({
  fileItems,
  issueCount,
  live,
  pendingApprovalCount,
  toolCalls,
}: {
  fileItems: RunFileItem[];
  issueCount: number;
  live: boolean;
  pendingApprovalCount: number;
  toolCalls: ChatToolCall[];
}) {
  if (pendingApprovalCount > 0) return `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? "" : "s"} waiting`;
  if (live) return toolCalls.length > 0 ? `Working through ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}` : "Working";
  if (issueCount > 0) return `${issueCount} issue${issueCount === 1 ? "" : "s"} recorded`;
  if (fileItems.length > 0) return `${fileItems.length} file item${fileItems.length === 1 ? "" : "s"} tracked`;
  return toolCalls.length > 0 ? `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"} completed` : "Summary ready";
}

function createRunSummary({
  approvals,
  fileItems,
  message,
  terminalItems,
  toolCalls,
}: {
  approvals: AgentApproval[];
  fileItems: RunFileItem[];
  message: ChatMessage;
  terminalItems: RunTerminalItem[];
  toolCalls: ChatToolCall[];
}): RunSummary {
  const changedItems = fileItems.filter(isChangedFileItem);
  const readItems = fileItems.filter((item) => !changedItems.includes(item));
  const failedTools = toolCalls.filter((toolCall) => toolCall.status === "error");
  const skippedTools = toolCalls.filter((toolCall) => toolCall.status === "skipped");
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const activeTerminals = terminalItems.filter((item) => item.status === "active");

  return {
    changed: changedItems.length > 0
      ? `${changedItems.length} file action${changedItems.length === 1 ? "" : "s"} recorded.`
      : readItems.length > 0
        ? `No file changes recorded; ${readItems.length} read/search item${readItems.length === 1 ? "" : "s"} tracked.`
        : "No file changes recorded.",
    failed: failedTools.length > 0
      ? `${failedTools.length} tool call${failedTools.length === 1 ? "" : "s"} failed: ${failedTools.slice(0, 2).map((toolCall) => toolCall.label).join(", ")}.`
      : skippedTools.length > 0
        ? `${skippedTools.length} action${skippedTools.length === 1 ? "" : "s"} skipped or canceled.`
        : "Nothing failed in the recorded run.",
    needsUser: pendingApprovals.length > 0
      ? `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} need your decision.`
      : message.planning?.inputRequest && !message.planning.inputRequest.answeredAt
        ? "A planning answer is still needed."
        : activeTerminals.length > 0
          ? "A terminal command is still running."
          : "Nothing is currently waiting on you.",
  };
}

function createInlineFileGroups(fileItems: RunFileItem[]) {
  const changedFiles = fileItems.filter(isChangedFileItem);
  const unchangedFiles = fileItems.filter((item) => item.action === "unchanged");
  const readFiles = fileItems.filter((item) => item.action === "read");
  const checkedFiles = fileItems.filter((item) => item.action === "checked");
  const searchedFiles = fileItems.filter((item) => item.action === "searched");
  const skippedFiles = fileItems.filter((item) => item.action === "skipped");
  const groups = [
    createInlineFileGroup("changed", changedFiles, getChangedFileGroupLabel(changedFiles), <Pencil size={16} />),
    createInlineFileGroup("unchanged", unchangedFiles, "Checked", <FileText size={16} />, "no changes applied"),
    createInlineFileGroup("read", readFiles, "Read", <FileText size={16} />),
    createInlineFileGroup("checked", checkedFiles, "Checked", <FileText size={16} />),
    createInlineFileGroup("searched", searchedFiles, "Searched", <FileText size={16} />),
    createInlineFileGroup("skipped", skippedFiles, "Skipped", <AlertTriangle size={16} />),
  ];

  return groups.filter((group) => group.files.length > 0);
}

function createInlineBatchFileGroup(toolCall: ChatToolCall, fileItems: RunFileItem[]) {
  const operation = getBatchOperation(toolCall);

  if (!operation || fileItems.length === 0) {
    return null;
  }

  const status = getInlineStatus(fileItems.map((file) => file.status));
  const live = isLiveLaneStatus(status) || toolCall.status === "active" || toolCall.status === "waiting_approval";
  const summary = toolCall.batchSummary;
  const totalCount = Math.max(summary?.fileCount ?? 0, fileItems.length);
  const successCount = summary?.successCount ?? fileItems.filter((file) => file.status === "complete").length;
  const failureCount = summary?.failureCount ?? fileItems.filter((file) => file.status === "error").length;
  const skippedCount = summary?.skippedCount ?? fileItems.filter((file) => file.status === "skipped").length;
  const processedCount = Math.min(totalCount, successCount + failureCount + skippedCount);
  const verb = operation === "write"
    ? live ? "writing" : "wrote"
    : live ? "editing" : "edited";
  const title = live && processedCount > 0
    ? `Batch ${verb} ${formatFileRatio(processedCount, totalCount)}`
    : `Batch ${verb} ${formatCount(live ? totalCount : Math.max(successCount, fileItems.length), "file")}`;
  const changedFiles = fileItems.filter(isChangedFileItem);
  const additions = changedFiles.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = changedFiles.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const firstFile = fileItems[0] ? formatActivityPath(fileItems[0].path) : "";
  const extraCount = Math.max(0, fileItems.length - 1);
  const filePreview = firstFile ? `${firstFile}${extraCount > 0 ? ` and ${extraCount} more` : ""}` : "";
  const diffPreview = changedFiles.length > 0 && (additions > 0 || deletions > 0)
    ? `+${formatNumber(additions)} / -${formatNumber(deletions)}`
    : "";
  const pendingCount = live ? Math.max(0, totalCount - processedCount) : 0;
  const outcomeDetail = [
    successCount > 0 ? `${successCount} OK` : "",
    failureCount > 0 ? `${failureCount} failed` : "",
    skippedCount > 0 ? `${skippedCount} skipped` : "",
    pendingCount > 0 && processedCount > 0 ? `${pendingCount} pending` : "",
  ].filter(Boolean).join(", ");
  const detail = outcomeDetail || [filePreview, diffPreview].filter(Boolean).join(" ");

  return {
    detail,
    files: fileItems,
    icon: <Pencil size={16} />,
    key: `${operation}-${toolCall.id}`,
    status,
    title,
  };
}

function createInlineFileGroup(key: string, files: RunFileItem[], label: string, icon: ReactNode, detailOverride = "") {
  const status = getInlineStatus(files.map((file) => file.status));
  const changedFiles = files.filter(isChangedFileItem);
  const additions = changedFiles.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = changedFiles.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const firstFile = files[0] ? formatActivityPath(files[0].path) : "";
  const extraCount = Math.max(0, files.length - 1);
  const filePreview = firstFile ? `${firstFile}${extraCount > 0 ? ` +${extraCount}` : ""}` : "";
  const diffPreview = changedFiles.length > 0 && (additions > 0 || deletions > 0)
    ? `+${formatNumber(additions)} / -${formatNumber(deletions)}`
    : "";
  const detail = detailOverride || [filePreview, diffPreview].filter(Boolean).join(" ");

  return {
    detail,
    files,
    icon,
    key,
    status,
    title: `${label} ${formatCount(files.length, "file")}`,
  };
}

function isLiveLaneStatus(status: RunLaneStatus | RunStageStatus) {
  return status === "active" || status === "waiting_approval" || status === "waiting";
}

function formatFileRatio(count: number, total: number) {
  return `${formatNumber(count)} of ${formatCount(Math.max(total, count), "file")}`;
}

function getChangedFileGroupLabel(files: RunFileItem[]) {
  const actions = files.map((file) => file.action);

  if (actions.length === 0) return "Edited";
  if (actions.every((action) => action === "wrote")) return "Wrote";
  if (actions.every((action) => action === "created")) return "Created";
  if (actions.every((action) => action === "deleted")) return "Deleted";
  if (actions.every((action) => action === "copied")) return "Copied";
  if (actions.every((action) => action === "moved")) return "Moved";
  return "Edited";
}

function isChangedFileItem(item: RunFileItem) {
  if (item.action === "created" || item.action === "deleted" || item.action === "moved" || item.action === "copied") {
    return true;
  }

  if (item.action !== "edited" && item.action !== "wrote") {
    return false;
  }

  return (item.additions ?? 0) > 0 || (item.deletions ?? 0) > 0;
}

function getInlineStatus(statuses: Array<RunLaneStatus | RunStageStatus>): RunLaneStatus | RunStageStatus {
  if (statuses.includes("waiting_approval") || statuses.includes("waiting")) return "waiting_approval";
  if (statuses.includes("active")) return "active";
  if (statuses.includes("error") || statuses.includes("issue")) return "error";
  if (statuses.includes("skipped")) return "skipped";
  return "complete";
}

function formatTerminalInlineDetail(items: RunTerminalItem[]) {
  const failed = items.filter((item) => item.failure);
  if (failed.length > 0) {
    return failed.map((item) => item.failure).filter(Boolean).join(" ");
  }

  const firstCommand = items[0]?.command ?? "";
  return firstCommand ? limitText(firstCommand, 80) : "";
}

function formatTerminalInlineTitle(items: RunTerminalItem[]) {
  const running = items.some((item) => item.status === "active");

  if (items.length === 1) {
    return running ? "Running command" : "Ran command";
  }

  return `${running ? "Running" : "Ran"} ${formatCount(items.length, "command")}`;
}

function formatMcpInlineTitle(items: RunMcpItem[]) {
  const running = items.some((item) => item.status === "active" || item.status === "waiting_approval");

  if (items.length === 1) {
    return `${running ? "Calling" : "Called"} MCP`;
  }

  return `${running ? "Calling" : "Called"} ${formatCount(items.length, "MCP tool")}`;
}

function formatMcpInlineDetail(items: RunMcpItem[]) {
  const first = items[0];
  if (!first) return "";

  const label = [first.server, first.tool].filter(Boolean).join(" / ");
  return items.length > 1 ? `${label} +${items.length - 1}` : label;
}

function formatCount(count: number, noun: string) {
  return `${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function collectRunFileItems(toolCalls: ChatToolCall[]): RunFileItem[] {
  const items: RunFileItem[] = [];

  for (const toolCall of toolCalls) {
    items.push(...collectExplicitFileResultItems(toolCall));

    if (hasExplicitFileResult(toolCall)) continue;

    const parsedInput = parseToolInput(toolCall.input);
    const paths = getInputPaths(parsedInput);
    const key = getToolKey(toolCall);

    if (isFileEditingToolCall(toolCall)) {
      const estimatedItems = collectEstimatedEditingFileItems(toolCall, parsedInput);

      if (estimatedItems.length > 0) {
        items.push(...estimatedItems);
        continue;
      }

      const action = getEditingAction(toolCall);
      const editPaths = paths.length > 0 ? paths : getEditInputPaths(parsedInput);
      for (const path of editPaths) items.push(createRunFileItem(toolCall, path, action));
    } else if (isFileReadingToolCall(toolCall)) {
      const action = /\bsearch\b/.test(key) ? "searched" : /\blist|tree|stat|count\b/.test(key) ? "checked" : "read";
      for (const path of paths.length > 0 ? paths : [toolCall.detail ?? "workspace"]) items.push(createRunFileItem(toolCall, path, action));
    }
  }

  return dedupeFileItems(items).slice(0, 24);
}

function collectEstimatedEditingFileItems(toolCall: ChatToolCall, input: Record<string, unknown> | null): RunFileItem[] {
  if (!input) {
    return [];
  }

  if (isWriteToolCall(toolCall)) {
    return getWriteInputRecords(input).flatMap((file, index) => {
      const path = stringValue(file.path);
      if (!path) {
        return [];
      }

      return [{
        action: file.overwrite === false ? "created" : "wrote",
        additions: countTextLines(stringValue(file.content)),
        deletions: 0,
        id: `${toolCall.id}:write-estimate:${path}:${index}`,
        path,
        status: toolCall.status,
      }];
    });
  }

  return getEditInputRecords(input).flatMap((edit, index) => {
    const path = stringValue(edit.path);
    if (!path) {
      return [];
    }

    const operation = stringValue(edit.operation ?? edit.type).toLowerCase();
    return [{
      action: "edited",
      additions: estimateEditAdditions(edit, operation),
      deletions: estimateEditDeletions(edit, operation),
      id: `${toolCall.id}:edit-estimate:${path}:${index}`,
      path,
      status: toolCall.status,
    }];
  });
}

function getWriteInputRecords(input: Record<string, unknown>): Record<string, unknown>[] {
  const files = recordArrayValue(input.files);
  if (files.length > 0) {
    return files;
  }

  const paths = stringArrayValue(input.paths);
  const contents = stringArrayValue(input.contents);
  const content = stringValue(input.content);

  if (paths.length > 0) {
    return paths.map((path, index) => ({
      content: contents[index] ?? content,
      overwrite: input.overwrite,
      path,
    }));
  }

  const path = stringValue(input.path);
  return path ? [{ content, overwrite: input.overwrite, path }] : [];
}

function getEditInputRecords(input: Record<string, unknown>): Record<string, unknown>[] {
  const edits = recordArrayValue(input.edits);
  if (edits.length > 0) {
    return edits;
  }

  const path = stringValue(input.path);
  if (path) {
    return [{ ...input, path }];
  }

  const paths = stringArrayValue(input.paths);
  const oldTexts = stringArrayValue(input.oldTexts ?? input.old_texts);
  const newTexts = stringArrayValue(input.newTexts ?? input.new_texts);
  const oldText = stringValue(input.oldText ?? input.old_text);
  const newText = stringValue(input.newText ?? input.new_text);

  return paths.map((editPath, index) => ({
    newText: newTexts[index] ?? newText,
    oldText: oldTexts[index] ?? oldText,
    operation: "exact_replace",
    path: editPath,
  }));
}

function estimateEditAdditions(edit: Record<string, unknown>, operation: string) {
  if (operation === "exact_replace" || edit.oldText !== undefined || edit.old_text !== undefined) {
    return countTextLines(stringValue(edit.newText ?? edit.new_text));
  }

  return countTextLines(stringValue(edit.content));
}

function estimateEditDeletions(edit: Record<string, unknown>, operation: string) {
  if (isSpanEdit(edit, operation)) {
    return estimateSpanDeletionCount(edit);
  }

  if (operation === "replace_range" || edit.startLine !== undefined || edit.start_line !== undefined) {
    const startLine = numberValue(edit.startLine ?? edit.start_line);
    const endLine = numberValue(edit.endLine ?? edit.end_line);
    return startLine && endLine && endLine >= startLine ? endLine - startLine + 1 : 0;
  }

  if (operation === "exact_replace" || edit.oldText !== undefined || edit.old_text !== undefined) {
    return countTextLines(stringValue(edit.oldText ?? edit.old_text));
  }

  return 0;
}

function isSpanEdit(edit: Record<string, unknown>, operation: string) {
  return operation === "replace_span" || operation === "span_replace" || operation === "line_column_span" || operation === "column_range" || operation === "char_range" || operation === "replace_chars"
    || edit.startColumn !== undefined
    || edit.start_column !== undefined
    || edit.startChar !== undefined
    || edit.start_char !== undefined
    || edit.endColumn !== undefined
    || edit.end_column !== undefined
    || edit.endChar !== undefined
    || edit.end_char !== undefined;
}

function estimateSpanDeletionCount(input: Record<string, unknown>) {
  const startLine = numberValue(input.startLine ?? input.start_line);
  const endLine = numberValue(input.endLine ?? input.end_line) ?? startLine;
  const startColumn = numberValue(input.startColumn ?? input.start_column ?? input.startChar ?? input.start_char);
  const endColumn = numberValue(input.endColumn ?? input.end_column ?? input.endChar ?? input.end_char);

  if (startLine && endLine && endLine > startLine) {
    return endLine - startLine + 1;
  }

  if (startLine && endLine === startLine && startColumn && endColumn && endColumn > startColumn) {
    return 1;
  }

  return 0;
}

function collectExplicitFileResultItems(toolCall: ChatToolCall): RunFileItem[] {
  const items: RunFileItem[] = [];

  for (const result of toolCall.batchFileResults ?? []) {
    const action = getExplicitFileAction(toolCall, result.kind, result.additions, result.deletions, result.status);
    items.push({
      action,
      additions: result.additions,
      deletions: result.deletions,
      detail: result.detail,
      id: `${toolCall.id}:batch:${result.path}`,
      path: result.path || result.requestedPath || "workspace",
      status: result.status === "ok" ? toolCall.status : result.status === "error" ? "error" : "skipped",
    });
  }

  for (const change of toolCall.fileChanges ?? []) {
    const action = getExplicitFileAction(toolCall, change.kind, change.additions, change.deletions, toolCall.status === "skipped" ? "skipped" : "ok");
    items.push({
      action,
      additions: change.additions,
      deletions: change.deletions,
      id: `${toolCall.id}:change:${change.path}`,
      path: change.path,
      status: toolCall.status,
    });
  }

  return items;
}

function hasExplicitFileResult(toolCall: ChatToolCall) {
  return Boolean(toolCall.batchFileResults?.length || toolCall.fileChanges?.length);
}

function getExplicitFileAction(
  toolCall: ChatToolCall,
  kind: ChatToolFileChange["kind"] | undefined,
  additions: number,
  deletions: number,
  resultStatus: "error" | "ok" | "skipped",
) {
  if (resultStatus === "skipped" || toolCall.status === "skipped") return "skipped";
  if (isFileReadingToolCall(toolCall)) {
    const key = getToolKey(toolCall);
    if (/\bsearch\b/.test(key)) return "searched";
    if (/\blist|tree|stat|count\b/.test(key)) return "checked";
    return "read";
  }

  if (additions === 0 && deletions === 0 && !kind) {
    return isFileEditingToolCall(toolCall) ? "unchanged" : "checked";
  }

  if (kind === "create") return "created";
  if (kind === "delete") return "deleted";
  if (kind === "move") return "moved";
  if (isCopyToolCall(toolCall)) return "copied";
  if (isWriteToolCall(toolCall)) return "wrote";
  return "edited";
}

function createRunFileItem(toolCall: ChatToolCall, path: string, action: string): RunFileItem {
  return {
    action: toolCall.status === "skipped" ? "skipped" : action,
    detail: cleanInlineText(toolCall.detail ?? ""),
    id: `${toolCall.id}:${action}:${path}`,
    path,
    status: toolCall.status,
  };
}

function dedupeFileItems(items: RunFileItem[]) {
  const byKey = new Map<string, RunFileItem>();

  for (const item of items) {
    const key = `${item.action}:${item.path}:${item.status}`;
    const existing = byKey.get(key);
    if (!existing || getLaneStatusRank(item.status) > getLaneStatusRank(existing.status)) byKey.set(key, item);
  }

  return [...byKey.values()];
}

function collectRunTerminalItems(toolCalls: ChatToolCall[]): RunTerminalItem[] {
  const items = toolCalls.filter(isTerminalToolCall).map((toolCall) => {
    const parsedInput = parseToolInput(toolCall.input);
    const command = toolCall.terminal?.command || stringValue(parsedInput?.command) || stringValue(parsedInput?.cmd) || cleanInlineText(toolCall.detail ?? toolCall.label);
    const exitCode = toolCall.terminal?.exitCode;
    const timedOut = Boolean(toolCall.terminal?.timedOut);
    const failed = toolCall.status === "error" || timedOut || typeof exitCode === "number" && exitCode !== 0;

    return {
      command: limitText(command || toolCall.label, 220),
      failure: failed ? createTerminalFailure(toolCall, exitCode, timedOut) : "",
      id: toolCall.id,
      outputPreview: toolCall.output ? limitBlock(toolCall.output, 420) : "",
      status: toolCall.status,
      workingDirectory: toolCall.terminal?.workingDirectory || stringValue(parsedInput?.cwd) || stringValue(parsedInput?.workingDirectory),
    };
  });

  return dedupeTerminalItems(items);
}

function collectRunBrowserItems(toolCalls: ChatToolCall[]): RunBrowserItem[] {
  return toolCalls.filter(isBrowserToolCall).map((toolCall) => {
    const parsedInput = parseToolInput(toolCall.input);
    const target = stringValue(parsedInput?.url) || stringValue(parsedInput?.target) || stringValue(parsedInput?.path);

    return {
      detail: cleanInlineText(toolCall.detail ?? toolCall.output ?? ""),
      id: toolCall.id,
      label: toolCall.label,
      status: toolCall.status,
      target,
    };
  });
}

function collectRunMcpItems(toolCalls: ChatToolCall[]): RunMcpItem[] {
  return toolCalls.filter(isMcpToolCall).map((toolCall) => {
    const parsedInput = parseToolInput(toolCall.input);
    const server = getMcpServerName(toolCall, parsedInput);
    const tool = getMcpToolName(toolCall, parsedInput);
    const detail = cleanInlineText(toolCall.detail || createMcpOutputPreview(toolCall.output));

    return {
      detail,
      id: toolCall.id,
      server,
      status: toolCall.status,
      tool,
    };
  });
}

function hasRealWebSearchRun(message: ChatMessage) {
  return Boolean(
    message.webSearch?.searchedAt ||
      message.webSearch?.status === "active" ||
      message.webSearch?.status === "complete" ||
      message.webSearch?.status === "error" ||
      typeof message.webSearch?.resultCount === "number" ||
      message.toolCalls?.some(isWebToolCall),
  );
}

function createWebLaneDetail(message: ChatMessage, sources: ChatSource[]) {
  if (message.webSearch?.status === "active") return "Search running";
  if (message.webSearch?.error) return message.webSearch.error;
  if (sources.length > 0) return `${sources.length} source${sources.length === 1 ? "" : "s"} recorded`;
  if (typeof message.webSearch?.resultCount === "number") return `${message.webSearch.resultCount} result${message.webSearch.resultCount === 1 ? "" : "s"} recorded`;
  return "Search activity recorded";
}

function getUniqueSources(sources: ChatSource[]) {
  const seen = new Set<string>();
  const unique: ChatSource[] = [];

  for (const source of sources) {
    const url = normalizeUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push({ ...source, url });
  }

  return unique.slice(0, 8);
}

function getInputPaths(input: Record<string, unknown> | null): string[] {
  if (!input) return [];

  const paths = [
    stringValue(input.path),
    stringValue(input.requestedPath),
    stringValue(input.file),
    stringValue(input.cwd),
    ...stringArrayValue(input.paths),
    ...stringArrayValue(input.files),
  ];
  const fromPath = stringValue(input.fromPath) || stringValue(input.sourcePath);
  const toPath = stringValue(input.toPath) || stringValue(input.destinationPath);

  if (fromPath && toPath) paths.push(`${fromPath} -> ${toPath}`);

  for (const key of ["items", "writes", "edits", "files"]) {
    for (const record of recordArrayValue(input[key])) {
      const path = stringValue(record.path);
      const fromRecordPath = stringValue(record.fromPath) || stringValue(record.sourcePath);
      const toRecordPath = stringValue(record.toPath) || stringValue(record.destinationPath);
      paths.push(path || (fromRecordPath && toRecordPath ? `${fromRecordPath} -> ${toRecordPath}` : ""));
    }
  }

  return paths.map((path) => path.trim()).filter(Boolean);
}

function getEditInputPaths(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  return recordArrayValue(input.edits).map((edit) => stringValue(edit.path)).filter(Boolean);
}

function recordArrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseToolInput(input: string | undefined): Record<string, unknown> | null {
  if (!input) return null;

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getMcpServerName(toolCall: ChatToolCall, input: Record<string, unknown> | null) {
  const server = stringValue(input?.server) ||
    stringValue(input?.serverId) ||
    stringValue(input?.server_id) ||
    stringValue(input?.mcpServer) ||
    stringValue(input?.mcp_server) ||
    stringValue(input?.connector) ||
    stringValue(input?.app);

  if (server) return cleanInlineText(server);

  const match = cleanInlineText(toolCall.label).match(/\b(?:MCP|server)\s+([A-Za-z0-9_.:-]+)/i);
  return match?.[1] ?? "";
}

function getMcpToolName(toolCall: ChatToolCall, input: Record<string, unknown> | null) {
  const explicit = stringValue(input?.tool) ||
    stringValue(input?.toolName) ||
    stringValue(input?.tool_name) ||
    stringValue(input?.name) ||
    stringValue(input?.method) ||
    stringValue(input?.action);

  if (explicit) return cleanInlineText(explicit);

  const toolId = toolCall.toolId?.replace(/^mcp[._-]/i, "").replace(/[._-]+/g, " ").trim();
  return cleanInlineText(toolId || toolCall.label || "MCP tool");
}

function createMcpOutputPreview(output: string | undefined) {
  if (!output) return "";
  return limitText(output, 120);
}

function isFileReadingToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return /\bfiles[._-](?:read|read_many|read_range|list|search|tree_summary|stat|count_lines)\b/.test(key)
    || /\b(read|search|list|scan|stat|count)\b[\s-]*(?:workspace|file|folder|directory|codebase)/.test(key);
}

function isFileEditingToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return /\bfiles[._-](?:append|apply_patch|copy|edit|edit_many|exact_replace|insert_at_line|move|replace_range|replace_span|write|write_many)\b/.test(key)
    || /\b(edit|write|copy|move|delete|create|patch|replace|append)\b[\s-]*(?:workspace|file|folder|directory|path)/.test(key);
}

function isWriteToolCall(toolCall: ChatToolCall) {
  return /\bwrite\b|\bfiles[._-]write/.test(getToolKey(toolCall));
}

function getBatchOperation(toolCall: ChatToolCall): NonNullable<ChatToolCall["batchSummary"]>["operation"] | undefined {
  if (toolCall.batchSummary?.operation) {
    return toolCall.batchSummary.operation;
  }

  const key = getToolKey(toolCall);
  if (/\bfiles[._-]write_many\b|\bwrite many workspace files\b|\bbatch write\b/.test(key)) {
    return "write";
  }

  if (/\bfiles[._-]edit_many\b|\bedit many workspace files\b|\bbatch edit\b/.test(key)) {
    return "edit";
  }

  return undefined;
}

function isCopyToolCall(toolCall: ChatToolCall) {
  return /\bcopy\b|\bfiles[._-]copy/.test(getToolKey(toolCall));
}

function isTerminalToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return !isTerminalSessionDiagnosticToolCall(toolCall) && (Boolean(toolCall.terminal) || /\bterminal[._-]run\b|\bterminal\b|\bshell\b|\bcommand\b/.test(key));
}

function isBrowserToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return /\bbrowser[._-]/.test(key) || /\bbrowser\b|\bpreview\b|\bscreenshot\b|\bconsole\b/.test(key);
}

function isWebToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return /\bweb[._-]search\b|\bduckduckgo\b|\bbrave\b|\bsearch web\b/.test(key);
}

function isMcpToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);
  return /^mcp[._-]/.test(toolCall.toolId ?? "") || /\bmcp\b|\bserver-backed\b|\bconnector\b/.test(key);
}

function getEditingAction(toolCall: ChatToolCall) {
  if (isCopyToolCall(toolCall)) return "copied";
  const key = getToolKey(toolCall);
  if (/\bmove\b/.test(key)) return "moved";
  if (/\bdelete\b/.test(key)) return "deleted";
  if (isWriteToolCall(toolCall)) return "wrote";
  return "edited";
}

function getToolKey(toolCall: ChatToolCall) {
  return `${toolCall.toolId ?? ""} ${toolCall.label} ${toolCall.detail ?? ""}`.toLowerCase();
}

export function isVisibleAssistantRunToolCall(toolCall: ChatToolCall) {
  return !isTerminalSessionDiagnosticToolCall(toolCall);
}

function isTerminalSessionDiagnosticToolCall(toolCall: ChatToolCall) {
  const key = getToolKey(toolCall);

  return (
    /\bterminal_(?:list_sessions|read_session|dev_server_status)\b/.test(key) ||
    /\b(?:list|read) terminal sessions?\b/.test(key) ||
    /\bterminal dev server status\b/.test(key) ||
    /\bcould not read that terminal session\b/.test(key)
  );
}

function dedupeTerminalItems(items: RunTerminalItem[]) {
  const byCommand = new Map<string, RunTerminalItem>();

  for (const item of items) {
    const key = item.command.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byCommand.get(key);

    if (!existing || getLaneStatusRank(item.status) > getLaneStatusRank(existing.status)) {
      byCommand.set(key || item.id, item);
    }
  }

  return [...byCommand.values()];
}

function getLaneStatusRank(status: RunLaneStatus) {
  if (status === "error") return 5;
  if (status === "waiting_approval") return 4;
  if (status === "active") return 3;
  if (status === "pending") return 2;
  if (status === "complete") return 1;
  return 0;
}

function createTerminalFailure(toolCall: ChatToolCall, exitCode: number | null | undefined, timedOut: boolean) {
  if (timedOut) return "Command timed out.";
  if (typeof exitCode === "number" && exitCode !== 0) return `Exited with code ${exitCode}.`;
  return cleanInlineText(toolCall.detail ?? toolCall.output ?? "Command failed.");
}

function formatStageDetail(key: RunStageKey) {
  if (key === "planning") return "Model planning and request setup";
  if (key === "reading") return "Workspace reads, searches, and scans";
  if (key === "editing") return "File writes, edits, copies, moves, and deletes";
  if (key === "terminal") return "Terminal commands and dev server work";
  if (key === "browser") return "Browser preview, screenshots, and console checks";
  if (key === "web") return "External web search and source gathering";
  if (key === "mcp") return "MCP server and connector tool calls";
  if (key === "approval") return "Human review gates";
  return "Final user-facing summary";
}

function formatApprovalTarget(approval: AgentApproval) {
  return approval.path || approval.command || approval.tool || approval.kind;
}

function formatInlineFileVerb(file: RunFileItem) {
  const active = file.status === "active" || file.status === "waiting_approval";

  switch (file.action) {
    case "created":
      return active ? "Creating" : "Created";
    case "wrote":
      return active ? "Writing" : "Wrote";
    case "edited":
      return active ? "Editing" : "Edited";
    case "deleted":
      return active ? "Deleting" : "Deleted";
    case "moved":
      return active ? "Moving" : "Moved";
    case "copied":
      return active ? "Copying" : "Copied";
    case "searched":
      return active ? "Searching" : "Searched";
    case "read":
      return active ? "Reading" : "Read";
    case "checked":
    case "unchanged":
      return active ? "Checking" : "Checked";
    case "skipped":
      return "Skipped";
    default:
      return active ? "Working" : "Updated";
  }
}

function formatInlineMcpVerb(status: RunLaneStatus) {
  if (status === "active" || status === "waiting_approval") return "Calling";
  if (status === "error") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Called";
}

function formatRiskLabel(risk: AgentApproval["risk"]) {
  if (risk === "high") return "High risk";
  if (risk === "medium") return "Medium risk";
  return "Low risk";
}

function formatSourceDetail(source: ChatSource) {
  const host = formatSourceHost(source.url);
  const detail = cleanInlineText(source.detail ?? "");
  return detail && detail !== host ? `${host} - ${detail}` : host;
}

function formatSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function normalizeUrl(url: string) {
  try {
    return new URL(url.trim()).href;
  } catch {
    return "";
  }
}

function formatActivityPath(path: string): string {
  const cleaned = cleanInlineText(path).replace(/\\/g, "/");
  if (!cleaned || cleaned === "." || cleaned === "./") return "workspace";
  if (cleaned.includes(" -> ")) return cleaned.split(" -> ").map(formatActivityPath).join(" -> ");

  const srcIndex = cleaned.lastIndexOf("/src/");
  if (srcIndex >= 0) return cleaned.slice(srcIndex + 1);

  const segments = cleaned.split("/").filter(Boolean);
  return segments.length > 4 ? segments.slice(-4).join("/") : cleaned;
}

function cleanInlineText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function countTextLines(content: string) {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed ? trimmed.split("\n").length : 0;
}

function limitText(value: string, maxChars: number) {
  const cleaned = cleanInlineText(value);
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function limitBlock(value: string, maxChars: number) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 4)).trimEnd()}\n...`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
