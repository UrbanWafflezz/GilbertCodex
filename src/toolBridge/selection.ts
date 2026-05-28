import type { ToolDefinition } from "./types";
import { DEPLOYMENT_HOSTING_PROMPT_PATTERN, MCP_SERVICE_PROMPT_PATTERN } from "./mcpServicePatterns";

export interface SelectAdvertisedBridgeToolsOptions {
  browserPreviewEnabled?: boolean;
  editingEnabled?: boolean;
  fileToolsEnabled?: boolean;
  gitEnabled?: boolean;
  imageGenerationEnabled?: boolean;
  includeDiagnostics?: boolean;
  mcpServersEnabled?: boolean;
  memoryEnabled?: boolean;
  prompt: string;
  terminalEnabled?: boolean;
  webSearchEnabled?: boolean;
}

const FILE_PATH_PATTERN = /(?:^|[\s"'`])[\w./\\-]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i;
const FILE_CONTEXT_PATTERN = /\b(app|avatar|camera|canvas|code|codebase|component|config(?:uration)?|controls?|crafting|debug|dir|directory|file|folder|gameplay|hud|input|instruction|inventory|levels?|line|local|map|model|physics|player|plugin|plugins|prompt|prompts|providers?|registry|render(?:er|ing)?|resources?|runtime|scene|selector|service|settings?|simulation|source|support(?:ed)?|tool|tools|bridge|project|read|repo|repository|three(?:\.js|js)?|voxel|webgl|world|workspace)\b/i;
const INSPECT_PROMPT_PATTERN = /\b(audit|check|count|find|find out|figure out|grep|inspect|list|look at|look into|read|review|search|show|trace|tree|where)\b/i;
const EDIT_PROMPT_PATTERN = /\b(add|append|apply|change|copy|delete|edit|fix|implement|improve|insert|modi(?:fy|fy|y)|patch|polish|refactor|remove|replace|restyle|revamp|style|tweak|update|upgrade|write)\b/i;
const DESIGN_EDIT_PROMPT_PATTERN = /\b(?:better|cleaner|clearer|design|layout|party|polished?|readable|readability|theme|ui|visual)\b/i;
const APP_BEHAVIOR_CHANGE_PROMPT_PATTERN =
  /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|shouldn['’]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b|\b(?:should|shouldn['’]?t|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:go\s+to|navigate|route|open|show|display|render|switch|send|land|take|work|create|start)\b/i;
const GAME_BEHAVIOR_CHANGE_PROMPT_PATTERN =
  /\b(?:when|if|after|on)\b[\s\S]{0,220}\b(?:should|should\s+not|needs?\s+to|must|has\s+to|have\s+to)\b[\s\S]{0,220}\b(?:pause|resume|lock|unlock|play|stop|open|show|display|render|switch|work|start)\b/i;
const LOCAL_UI_BEHAVIOR_TARGET_PATTERN =
  /\b(?:app|avatar|canvas|chat|component|flow|game|gameplay|ghome|home|hud|ide|layout|level|navigation|page|player|route|screen|scene|ui|user|world|workspace|workplace)\b/i;
const MAKE_BETTER_PROMPT_PATTERN = /\bmake\s+(?:it|this|that|the\s+app|the\s+game|the\s+page|the\s+site|the\s+ui|the\s+design|the\s+world|the\s+scene|the\s+hud|the\s+canvas|the\s+player|the\s+level)?\s*(?:look\s+|feel\s+|more\s+)?(?:better|cleaner|clearer|fun|party|playable|polished|readable)\b/i;
const MAKE_LOCAL_TARGET_WORK_PATTERN =
  /\b(?:make|making|harden|improve|optimi[sz]e|upgrade)\b[\s\S]{0,180}\b(?:app|code|codebase|game|gameplay|project|repo|repository|runtime|tool|tools|tooling|workspace|world)\b[\s\S]{0,180}\b(?:bugs?|claude\s+code|codex|competition|correct(?:ly)?|fast(?:er)?|fun|playable|powerful|reliable|work(?:ing)?)\b|\b(?:tool|tools|tooling|tool[-\s]?bridge|runtime)\b[\s\S]{0,180}\b(?:bugs?|correct(?:ly)?|fast(?:er)?|powerful|reliable|work(?:ing)?)\b/i;
const CREATE_FOLDER_PATTERN = /\b(create|make|add)\s+(?:a\s+|an\s+|the\s+)?(?:dir|directory|folder)\b|\bmkdir\b/i;
const MOVE_PROMPT_PATTERN = /\b(move|rename)\b/i;
const TERMINAL_PROMPT_PATTERN = /\b(build|cargo|clone|compile|deploy|dev server|download|firebase-tools|git\s+clone|hosting|install|netlify|npm|npx|pnpm|publish|run|script|serve|start|terminal|test|tsc|vercel|vite|yarn)\b/i;
const RUN_DIAGNOSTIC_PROMPT_PATTERN = /\b(browser error|debug browser|dev server|localhost|open preview|preview|run app|serve|start|vite)\b/i;
const LOCAL_GIT_PROMPT_PATTERN = /\b(branch|commit|diff|git|pull|push|stage|status)\b/i;
const LOCAL_GIT_CHANGE_REVIEW_PATTERN =
  /\b(?:what(?:'s| is| all)?|which|show|list|summari[sz]e|explain|review|audit|check|tell(?: me)?)\b[\s\S]{0,180}\b(?:changed|changes|modified|uncommitted|dirty\s+tree|working[-\s]?tree|worktree|diff|status|done\s+so\s+far|files?\s+changed)\b/i;
const GITHUB_PROMPT_PATTERN = /\b(github|pull requests?|prs?|issues?|stars?|forks?|tags?|remote branches?|github releases?|releases? on github|workflow|actions?|remote repos?|repository on github)\b/i;
const GMAIL_PROMPT_PATTERN =
  /\b(?:gmail|inbox|mailbox|email(?:s| messages?| thread| threads)?|mail(?: messages?| thread| threads)?|draft repl(?:y|ies)|reply to (?:an )?email|send (?:an )?email|read my email|check my email|labels? in gmail)\b/i;
const GMAIL_LOCAL_CODE_ONLY_PATTERN =
  /\b(?:email field|email input|email validation|email signup|email form|email template|email regex|email component)\b/i;
const GMAIL_DRAFT_PROMPT_PATTERN = /\b(?:compose|draft|forward|reply|respond|write (?:an )?email)\b/i;
const GMAIL_LABEL_PROMPT_PATTERN = /\b(?:archive|folder|folders|label|labels|mark (?:as )?(?:read|unread|important)|star|unstar|organize)\b/i;
const GMAIL_TRASH_PROMPT_PATTERN = /\b(?:delete|permanently delete|remove|trash|untrash|restore)\b/i;
const GMAIL_SEND_PROMPT_PATTERN = /\b(?:send|sent|deliver|email\s+\S+@\S+)\b/i;
const GMAIL_CONTEXT_COMPOSITION_PATTERN =
  /\b(?:current|this|that|our|local)\s+(?:app|branch|bug|change|changes|code|codebase|diff|feature|implementation|integration|plugin|project|repo|repository|runtime|source|tool|tools|workspace)\b|\b(?:branch|changed files?|codebase|commits?|diff|dirty\s+tree|git|implementation|integration|local changes?|plugin|project|pull request|repo|repository|runtime|source code|tool integration|uncommitted|working[-\s]?tree|workspace)\b/i;
const CALENDAR_PROMPT_PATTERN =
  /\b(?:google calendar|google tasks?|calendar|agenda|schedule|scheduling|scehedule|scheduel|schedue|meeting(?:s)?|event(?:s)?|free[-\s]?busy|availability|available slot|open slot|book time|reschedule|invite(?:s|es)?|attendees?|task lists?|to-?dos?)\b/i;
const CALENDAR_LOCAL_CODE_ONLY_PATTERN =
  /\b(?:calendar component|calendar widget|calendar ui|calendar view|calendar library|date picker|datepicker|schedule component|event handler)\b/i;
const CALENDAR_WRITE_PROMPT_PATTERN =
  /\b(?:add|book|cancel|create|delete|move|rename|reschedule|schedule|share|update)\b[\s\S]{0,120}\b(?:calendar|event|meeting|invite|appointment|task list|task|to-?do)\b|\b(?:calendar|event|meeting|invite|appointment|task list|task|to-?do)\b[\s\S]{0,120}\b(?:add|book|cancel|create|delete|move|rename|reschedule|schedule|share|update)\b/i;
const CALENDAR_DELETE_PROMPT_PATTERN =
  /\b(?:cancel|clear|delete|remove)\b[\s\S]{0,120}\b(?:calendar|event|meeting|invite|appointment|task list|task|to-?do|completed tasks?)\b|\b(?:calendar|event|meeting|invite|appointment|task list|task|to-?do|completed tasks?)\b[\s\S]{0,120}\b(?:cancel|clear|delete|remove)\b/i;
const WEB_PROMPT_PATTERN = /\b(api docs?|browse|changelog|cite|citations?|current|date-sensitive|docs?|documentation|external|internet|latest|live web|look up|news|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|source-backed|source backed|sources|standard|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i;
const MCP_PROMPT_PATTERN =
  /\b(?:mcp|model context protocol|tool servers?|external tools?|connected apps?|connectors?|server tools?)\b/i;
const LOCAL_DOCS_ONLY_PATTERN = /\b(?:local|repo|repository|project|workspace)\s+(?:docs?|documentation|files?|source|source code|code)\b|\b(?:docs?|documentation)\s+(?:in|inside|from)\s+(?:the\s+)?(?:local|repo|repository|project|workspace)\b/i;
const EXTERNAL_WEB_EVIDENCE_PATTERN = /\b(api docs?|browse|changelog|cite|citations?|current|date-sensitive|external|internet|latest|live web|look up|news|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|source-backed|source backed|sources|standard|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i;
const IMAGE_GENERATION_PROMPT_PATTERN = /\b(?:generate|create|make|draw|render|design|produce)\b[\s\S]{0,120}\b(?:image|picture|photo|illustration|artwork|art|logo|icon|wallpaper|avatar|poster|thumbnail)\b|\b(?:image|picture|photo|illustration|artwork|logo|icon|wallpaper|avatar|poster|thumbnail)\s+(?:generation|generator)\b/i;
const BROWSER_PROMPT_PATTERN = /\b(browser|browser error|click|console|devtools|inspect|localhost|local site|open preview|page|preview|screenshot|site|ui|visual|webview|website)\b/i;
const DIAGNOSTIC_PROMPT_PATTERN = /\b(bridge_echo|bridge_sum|diagnostic|smoke test|tool_smoke_test|tool smoke)\b/i;
const TOOL_HEALTH_DIAGNOSTIC_PROMPT_PATTERN =
  /\b(?:audit|check|stress[-\s]?test|test|validate|verify)\b[\s\S]{0,160}\b(?:all\s+(?:of\s+)?(?:the\s+)?tools?|tools?|tool[-\s]?bridge|toolchain|tooling)\b|\b(?:all\s+(?:of\s+)?(?:the\s+)?tools?|tools?|tool[-\s]?bridge|toolchain|tooling)\b[\s\S]{0,160}\b(?:audit|check|health|smoke|stress[-\s]?test|test|validate|verify)\b/i;
const MEMORY_PROMPT_PATTERN = /\b(memory|remember|previous|prior|earlier|decision|lesson|preference|history|project context)\b/i;
const CONVERSATION_ONLY_PROMPT_PATTERN =
  /^\s*(?:thanks?|thank you|ok(?:ay)?|cool|nice|got it|sounds good|perfect|great|continue|go on|tell me more|explain that|summarize(?: this)?(?: conversation| chat| thread)?)\s*[.!?]*\s*$/i;
const LOCAL_CODE_CONTEXT_MARKER_PATTERN = /\bLocal-code conversation context for tool selection only:/i;
const TOOL_AVAILABILITY_PROBLEM_PATTERN =
  /\b(?:tools?|tool[-\s]?calling|provider tools?|workspace tools?)\b[\s\S]{0,220}\b(?:don't|do not|doesn't|does not|won't|will not|can't|cannot|not)\b[\s\S]{0,120}\b(?:work|call|attach|attached|available|enabled|remember|realize|know|show|use)\b|\b(?:don't|do not|doesn't|does not|won't|will not|can't|cannot|not)\b[\s\S]{0,120}\b(?:have|see|remember|realize|know|attach|attached|call|use)\b[\s\S]{0,160}\b(?:tools?|tool[-\s]?calling|provider tools?|workspace tools?)\b/i;
const CAPABILITY_INVENTORY_PROMPT_PATTERN =
  /\b(?:what|which|list|show|tell(?:\s+me)?|explain|describe)\b[\s\S]{0,180}\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b|\b(?:tools?|plugins?|apps?|skills?|capabilities?|connectors?)\b[\s\S]{0,180}\b(?:available|enabled|installed|connected|do\s+you\s+have|can\s+you\s+(?:access|call|use|do))\b/i;
const TERSE_ACTION_FOLLOWUP_PATTERN =
  /\b(?:do\s+(?:it|the\s+job|this)|continue|finish(?:\s+it)?|go\s+ahead|make\s+it\s+happen|apply\s+(?:it|that|the\s+change)|fix\s+(?:it|this|that)|run\s+(?:it|that)|test\s+(?:it|that)|use\s+the\s+tools?)\b/i;

const INSPECT_TOOL_IDS = new Set([
  "files_read",
  "files_read_many",
  "files_read_range",
  "files_list",
  "files_tree_summary",
  "files_search",
  "files_stat",
  "files_count_lines",
]);

const EDIT_TOOL_IDS = new Set([
  "files_edit_many",
  "files_exact_replace",
  "files_insert_at_line",
  "files_replace_range",
  "files_replace_span",
  "files_append",
  "files_apply_patch",
  "files_write_many",
  "files_copy",
]);

const LOCAL_GIT_TOOL_IDS = new Set([
  "git_status",
  "git_diff",
  "git_stage",
  "git_commit",
  "git_branch",
  "git_push",
  "git_pull",
  "git_init",
]);

const LOCAL_GIT_REVIEW_TOOL_IDS = new Set([
  "git_status",
  "git_diff",
]);

const GITHUB_READ_TOOL_IDS = new Set([
  "github_account",
  "github_list_repositories",
  "github_get_repository",
  "github_list_branches",
  "github_list_tags",
  "github_list_tree",
  "github_read_file",
  "github_search_code",
  "github_semantic_search",
  "github_search_issues",
  "github_list_issues",
  "github_list_completed_issues",
  "github_get_issue",
  "github_list_issue_comments",
  "github_list_milestones",
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_list_pull_request_files",
  "github_list_pull_request_commits",
  "github_list_pull_request_reviews",
  "github_search_repositories",
  "github_search_users",
  "github_list_commits",
  "github_get_commit",
  "github_compare_refs",
  "github_list_contributors",
  "github_list_stargazers",
  "github_list_forks",
  "github_generate_release_notes",
  "github_list_releases",
  "github_list_workflows",
  "github_list_workflow_runs",
  "github_get_workflow_run",
  "github_list_workflow_run_jobs",
  "github_list_workflow_run_artifacts",
  "github_get_pending_deployments",
  "github_list_code_scanning_alerts",
  "github_list_secret_scanning_alerts",
  "github_list_dependabot_alerts",
  "github_list_notifications",
  "github_api_read",
]);

const GITHUB_WRITE_TOOL_IDS = new Set([
  "github_create_branch",
  "github_commit_files",
  "github_create_pull_request",
  "github_create_issue",
  "github_update_issue",
  "github_close_issue",
  "github_reopen_issue",
  "github_mark_issue_duplicate",
  "github_comment_issue",
  "github_update_issue_comment",
  "github_delete_issue_comment",
  "github_set_issue_labels",
  "github_add_issue_labels",
  "github_remove_issue_label",
  "github_clear_issue_labels",
  "github_assign_issue",
  "github_unassign_issue",
  "github_lock_issue",
  "github_unlock_issue",
  "github_pin_issue",
  "github_unpin_issue",
  "github_transfer_issue",
  "github_create_milestone",
  "github_update_milestone",
  "github_delete_milestone",
  "github_update_pull_request",
  "github_merge_pull_request",
  "github_create_pull_request_review",
  "github_request_pull_request_reviewers",
  "github_remove_pull_request_reviewers",
  "github_update_pull_request_branch",
  "github_create_fork",
  "github_star_repository",
  "github_unstar_repository",
  "github_watch_repository",
  "github_unwatch_repository",
  "github_create_release",
  "github_dispatch_workflow",
  "github_approve_workflow_run",
  "github_rerun_workflow_run",
  "github_cancel_workflow_run",
  "github_force_cancel_workflow_run",
  "github_review_pending_deployments",
  "github_mark_notification_thread_read",
  "github_mark_all_notifications_read",
  "github_api_write",
  "github_api_delete",
]);

const GITHUB_ISSUE_READ_TOOL_IDS = new Set([
  "github_search_issues",
  "github_list_issues",
  "github_list_completed_issues",
  "github_get_issue",
  "github_list_issue_comments",
  "github_list_milestones",
]);

const GITHUB_ISSUE_WRITE_TOOL_IDS = new Set([
  "github_create_issue",
  "github_update_issue",
  "github_close_issue",
  "github_reopen_issue",
  "github_mark_issue_duplicate",
  "github_comment_issue",
  "github_update_issue_comment",
  "github_delete_issue_comment",
  "github_set_issue_labels",
  "github_add_issue_labels",
  "github_remove_issue_label",
  "github_clear_issue_labels",
  "github_assign_issue",
  "github_unassign_issue",
  "github_lock_issue",
  "github_unlock_issue",
  "github_pin_issue",
  "github_unpin_issue",
  "github_transfer_issue",
  "github_create_milestone",
  "github_update_milestone",
  "github_delete_milestone",
]);

const GITHUB_PULL_REQUEST_READ_TOOL_IDS = new Set([
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_list_pull_request_files",
  "github_list_pull_request_commits",
  "github_list_pull_request_reviews",
  "github_check_pull_request_merged",
]);

const GITHUB_PULL_REQUEST_WRITE_TOOL_IDS = new Set([
  "github_create_pull_request",
  "github_update_pull_request",
  "github_merge_pull_request",
  "github_create_pull_request_review",
  "github_request_pull_request_reviewers",
  "github_remove_pull_request_reviewers",
  "github_update_pull_request_branch",
]);

const GITHUB_WORKFLOW_READ_TOOL_IDS = new Set([
  "github_list_workflows",
  "github_list_workflow_runs",
  "github_get_workflow_run",
  "github_list_workflow_run_jobs",
  "github_list_workflow_run_artifacts",
  "github_get_pending_deployments",
]);

const GITHUB_WORKFLOW_WRITE_TOOL_IDS = new Set([
  "github_dispatch_workflow",
  "github_approve_workflow_run",
  "github_rerun_workflow_run",
  "github_cancel_workflow_run",
  "github_force_cancel_workflow_run",
  "github_review_pending_deployments",
]);

const GMAIL_READ_TOOL_IDS = new Set([
  "gmail_account",
  "gmail_search_messages",
  "gmail_semantic_search",
  "gmail_get_message",
  "gmail_read_full_message",
  "gmail_get_thread",
  "gmail_read_full_thread",
  "gmail_list_labels",
  "gmail_api_read",
]);

const GMAIL_DRAFT_TOOL_IDS = new Set([
  "gmail_create_draft",
]);

const GMAIL_SEND_TOOL_IDS = new Set([
  "gmail_send_message",
  "gmail_send_separate_messages",
  "gmail_send_draft",
]);

const GMAIL_LABEL_TOOL_IDS = new Set([
  "gmail_create_label",
  "gmail_modify_message_labels",
  "gmail_batch_modify_messages",
  "gmail_untrash_message",
  "gmail_api_write",
]);

const GMAIL_DESTRUCTIVE_TOOL_IDS = new Set([
  "gmail_api_delete",
  "gmail_delete_draft",
  "gmail_trash_message",
]);

const CALENDAR_READ_TOOL_IDS = new Set([
  "calendar_account",
  "calendar_list_calendars",
  "calendar_search_events",
  "calendar_get_event",
  "calendar_free_busy",
  "calendar_api_read",
  "calendar_list_task_lists",
  "calendar_list_tasks",
  "calendar_get_task",
]);

const CALENDAR_MUTATING_TOOL_IDS = new Set([
  "calendar_create_event",
  "calendar_update_event",
  "calendar_create_calendar",
  "calendar_update_calendar",
  "calendar_api_write",
  "calendar_create_task_list",
  "calendar_update_task_list",
  "calendar_create_task",
  "calendar_update_task",
  "calendar_move_task",
]);

const CALENDAR_DESTRUCTIVE_TOOL_IDS = new Set([
  "calendar_delete_event",
  "calendar_delete_calendar",
  "calendar_api_delete",
  "calendar_delete_task_list",
  "calendar_clear_completed_tasks",
  "calendar_delete_task",
]);

const MCP_TOOL_IDS = new Set([
  "mcp_list_servers",
  "mcp_list_tools",
  "mcp_call_tool",
]);

const BROWSER_TOOL_IDS = new Set([
  "browser_preview_open",
  "browser_console_read",
  "browser_screenshot_capture",
]);

export function selectAdvertisedBridgeTools(
  tools: ToolDefinition[],
  options: SelectAdvertisedBridgeToolsOptions,
) {
  const prompt = options.prompt.trim();
  const includeDiagnostics = options.includeDiagnostics === true || DIAGNOSTIC_PROMPT_PATTERN.test(prompt) || TOOL_HEALTH_DIAGNOSTIC_PROMPT_PATTERN.test(prompt);
  const explicitMcpRequest = MCP_PROMPT_PATTERN.test(prompt) || MCP_SERVICE_PROMPT_PATTERN.test(prompt);
  const mcpServersEnabled = options.mcpServersEnabled === true || explicitMcpRequest;
  const selectedToolIds = addContinuityFallbackToolIds(selectToolIds(prompt, {
    includeDiagnostics,
    mcpServersEnabled,
    memoryEnabled: options.memoryEnabled !== false,
    webSearchEnabled: options.webSearchEnabled === true,
  }), prompt, options);

  return tools.filter((tool) => {
    const family = tool.executorMetadata?.family;

    if (family === "diagnostic") {
      return includeDiagnostics && selectedToolIds.has(tool.id);
    }

    if (family === "web") {
      return options.webSearchEnabled === true && selectedToolIds.has(tool.id);
    }

    if (family === "media") {
      return options.imageGenerationEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "files") {
      return options.fileToolsEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "editing") {
      return options.editingEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "git") {
      return options.gitEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "github") {
      return options.gitEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "terminal") {
      return options.terminalEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "browser") {
      return options.browserPreviewEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "memory") {
      return options.memoryEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "gmail") {
      return selectedToolIds.has(tool.id);
    }

    if (family === "calendar") {
      return selectedToolIds.has(tool.id);
    }

    if (family === "mcp") {
      return mcpServersEnabled && selectedToolIds.has(tool.id);
    }

    if (!family) {
      return selectedToolIds.has(tool.id);
    }

    return selectedToolIds.has(tool.id);
  });
}

function selectToolIds(
  prompt: string,
  options: { includeDiagnostics: boolean; mcpServersEnabled: boolean; memoryEnabled: boolean; webSearchEnabled: boolean },
) {
  const ids = new Set<string>();
  const looksLikeMcpWork = MCP_PROMPT_PATTERN.test(prompt) || MCP_SERVICE_PROMPT_PATTERN.test(prompt);
  const looksLikeDeploymentHostingWork = DEPLOYMENT_HOSTING_PROMPT_PATTERN.test(prompt);
  const looksLikePureMcpWork = looksLikeMcpWork && !FILE_PATH_PATTERN.test(prompt) && !/\b(?:bridge|code|codebase|file|folder|local|project|repo|repository|runtime|selector|source|src[\\/]|workspace)\b/i.test(prompt);
  const looksLikeFileWork = !looksLikePureMcpWork && (FILE_PATH_PATTERN.test(prompt) || FILE_CONTEXT_PATTERN.test(prompt));
  const conversationOnlyPrompt = /\b(?:summarize|recap)\b.*\b(?:conversation|chat|thread)\b/i.test(prompt) && !looksLikeFileWork;
  const looksLikePureExternalWebWork = options.webSearchEnabled && shouldAttachWebSearch(prompt) && !looksLikeFileWork;
  const looksLikeInspectWork = !conversationOnlyPrompt && (looksLikeFileWork || (INSPECT_PROMPT_PATTERN.test(prompt) && !looksLikePureExternalWebWork && !looksLikePureMcpWork));
  const looksLikeGitHubWork = GITHUB_PROMPT_PATTERN.test(prompt);
  const looksLikeGmailWork = looksLikeGmailPrompt(prompt);
  const looksLikeContextAwareGmailComposition = looksLikeGmailWork && GMAIL_CONTEXT_COMPOSITION_PATTERN.test(prompt);
  const looksLikeCalendarWork = looksLikeCalendarPrompt(prompt);
  const looksLikePureConnectedAppWork =
    (looksLikeGmailWork || looksLikeCalendarWork) &&
    !looksLikeFileWork &&
    !looksLikeContextAwareGmailComposition;
  const looksLikeLocalGitReviewWork = LOCAL_GIT_CHANGE_REVIEW_PATTERN.test(prompt);
  const looksLikeLocalGitWork = LOCAL_GIT_PROMPT_PATTERN.test(prompt);
  const gitOnlyPrompt = looksLikeLocalGitWork && !FILE_PATH_PATTERN.test(prompt) && !/\b(code|file|folder|workspace|src|edit|fix|implement|refactor|test|build)\b/i.test(prompt);
  const looksLikeDesignEditWork = DESIGN_EDIT_PROMPT_PATTERN.test(prompt) && /\b(?:app|avatar|canvas|card|component|css|design|file|game|gameplay|hud|layout|level|page|player|screen|scene|style|theme|ui|visual|world|workspace|src[\\/]|\.css\b|\.jsx?\b|\.tsx?\b)\b/i.test(prompt);
  const looksLikeBehaviorEditWork = (APP_BEHAVIOR_CHANGE_PROMPT_PATTERN.test(prompt) || GAME_BEHAVIOR_CHANGE_PROMPT_PATTERN.test(prompt)) && LOCAL_UI_BEHAVIOR_TARGET_PATTERN.test(prompt);
  const looksLikeEditWork = !gitOnlyPrompt && !looksLikePureConnectedAppWork && (EDIT_PROMPT_PATTERN.test(prompt) || looksLikeDesignEditWork || looksLikeBehaviorEditWork || MAKE_BETTER_PROMPT_PATTERN.test(prompt) || MAKE_LOCAL_TARGET_WORK_PATTERN.test(prompt) || CREATE_FOLDER_PATTERN.test(prompt) || MOVE_PROMPT_PATTERN.test(prompt));

  if (options.memoryEnabled && (looksLikeInspectWork || looksLikeEditWork || looksLikeContextAwareGmailComposition || looksLikeLocalGitWork || looksLikeLocalGitReviewWork || TERMINAL_PROMPT_PATTERN.test(prompt) || MEMORY_PROMPT_PATTERN.test(prompt))) {
    ids.add("memory_search");
  }

  if (looksLikeInspectWork || looksLikeEditWork || looksLikeContextAwareGmailComposition || TERMINAL_PROMPT_PATTERN.test(prompt)) {
    addAll(ids, INSPECT_TOOL_IDS);
  }

  if (looksLikeEditWork) {
    addAll(ids, EDIT_TOOL_IDS);

    if (CREATE_FOLDER_PATTERN.test(prompt)) {
      ids.add("files_create_directory");
    }

    if (MOVE_PROMPT_PATTERN.test(prompt)) {
      ids.add("files_move");
    }

  }

  if (TERMINAL_PROMPT_PATTERN.test(prompt)) {
    ids.add("terminal_run");
    ids.add("terminal_list_sessions");
    ids.add("terminal_read_session");
    ids.add("terminal_dev_server_status");

    if (RUN_DIAGNOSTIC_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, BROWSER_TOOL_IDS);
    }
  }

  if (looksLikeLocalGitWork) {
    addAll(ids, LOCAL_GIT_TOOL_IDS);
  } else if (looksLikeLocalGitReviewWork) {
    addAll(ids, LOCAL_GIT_REVIEW_TOOL_IDS);
  }

  if (looksLikeContextAwareGmailComposition) {
    addAll(ids, LOCAL_GIT_REVIEW_TOOL_IDS);
  }

  if (looksLikeGmailWork) {
    addAll(ids, GMAIL_READ_TOOL_IDS);

    if (GMAIL_DRAFT_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, GMAIL_DRAFT_TOOL_IDS);
    }

    if (GMAIL_SEND_PROMPT_PATTERN.test(prompt)) {
      ids.add("gmail_create_draft");
      addAll(ids, GMAIL_SEND_TOOL_IDS);
    }

    if (GMAIL_LABEL_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, GMAIL_LABEL_TOOL_IDS);
    }

    if (GMAIL_TRASH_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, GMAIL_DESTRUCTIVE_TOOL_IDS);
    }
  }

  if (looksLikeCalendarWork) {
    addAll(ids, CALENDAR_READ_TOOL_IDS);

    if (CALENDAR_WRITE_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, CALENDAR_MUTATING_TOOL_IDS);
    }

    if (CALENDAR_DELETE_PROMPT_PATTERN.test(prompt)) {
      addAll(ids, CALENDAR_DESTRUCTIVE_TOOL_IDS);
    }
  }

  if (options.mcpServersEnabled && (looksLikeMcpWork || looksLikeDeploymentHostingWork)) {
    addAll(ids, MCP_TOOL_IDS);
  }

  if (options.mcpServersEnabled && CAPABILITY_INVENTORY_PROMPT_PATTERN.test(prompt)) {
    addAll(ids, MCP_TOOL_IDS);
  }

  if (BROWSER_PROMPT_PATTERN.test(prompt)) {
    addAll(ids, BROWSER_TOOL_IDS);
  }

  if (options.webSearchEnabled && shouldAttachWebSearch(prompt)) {
    ids.add("web_search");
  }

  if (IMAGE_GENERATION_PROMPT_PATTERN.test(prompt)) {
    ids.add("image_generate");
  }

  if (options.includeDiagnostics || DIAGNOSTIC_PROMPT_PATTERN.test(prompt) || TOOL_HEALTH_DIAGNOSTIC_PROMPT_PATTERN.test(prompt)) {
    ids.add("bridge_echo");
    ids.add("bridge_sum");
    ids.add("tool_smoke_test");
  }

  addGitHubToolIds(ids, prompt, looksLikeGitHubWork);

  return ids;
}

function addContinuityFallbackToolIds(
  selectedToolIds: Set<string>,
  prompt: string,
  options: SelectAdvertisedBridgeToolsOptions,
) {
  if (!shouldUseContinuityFallback(prompt)) {
    return selectedToolIds;
  }

  const ids = new Set(selectedToolIds);
  const workspaceToolsEnabled =
    options.fileToolsEnabled !== false ||
    options.editingEnabled !== false ||
    options.gitEnabled !== false ||
    options.terminalEnabled !== false ||
    options.browserPreviewEnabled !== false;

  if (!workspaceToolsEnabled && options.memoryEnabled === false && options.webSearchEnabled !== true) {
    return ids;
  }

  if (options.memoryEnabled !== false) {
    ids.add("memory_search");
  }

  if (options.fileToolsEnabled !== false) {
    addAll(ids, INSPECT_TOOL_IDS);
  }

  if (options.editingEnabled !== false && shouldAttachContinuityEditTools(prompt)) {
    addAll(ids, EDIT_TOOL_IDS);
  }

  if (options.gitEnabled !== false && shouldAttachContinuityGitTools(prompt)) {
    addAll(ids, LOCAL_GIT_REVIEW_TOOL_IDS);
  }

  if (options.gitEnabled !== false && shouldAttachContinuityGitHubTools(prompt)) {
    addAll(ids, GITHUB_READ_TOOL_IDS);

    if (/\b(?:close|complete|completed|resolve|resolved|reopen|duplicate|assign|label|comment|merge|review|approve|rerun|cancel|delete|write|update|create)\b/i.test(prompt)) {
      addAll(ids, GITHUB_WRITE_TOOL_IDS);
    }
  }

  if (options.terminalEnabled !== false && shouldAttachContinuityTerminalTools(prompt)) {
    ids.add("terminal_run");
    ids.add("terminal_list_sessions");
    ids.add("terminal_read_session");
    ids.add("terminal_dev_server_status");
  }

  if (options.browserPreviewEnabled !== false && shouldAttachContinuityBrowserTools(prompt)) {
    addAll(ids, BROWSER_TOOL_IDS);
  }

  if (options.webSearchEnabled === true && shouldAttachWebSearch(prompt)) {
    ids.add("web_search");
  }

  if ((options.mcpServersEnabled === true || MCP_PROMPT_PATTERN.test(prompt) || MCP_SERVICE_PROMPT_PATTERN.test(prompt)) && (MCP_PROMPT_PATTERN.test(prompt) || MCP_SERVICE_PROMPT_PATTERN.test(prompt) || DEPLOYMENT_HOSTING_PROMPT_PATTERN.test(prompt) || TOOL_AVAILABILITY_PROBLEM_PATTERN.test(prompt))) {
    addAll(ids, MCP_TOOL_IDS);
  }

  return ids;
}

function shouldUseContinuityFallback(prompt: string) {
  const trimmed = prompt.trim();

  if (!trimmed || trimmed.length > 4_000 || CONVERSATION_ONLY_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  return (
    TOOL_AVAILABILITY_PROBLEM_PATTERN.test(trimmed) ||
    LOCAL_CODE_CONTEXT_MARKER_PATTERN.test(trimmed) ||
    (
      TERSE_ACTION_FOLLOWUP_PATTERN.test(trimmed) &&
      /\b(?:app|canvas|code|codebase|component|config(?:uration)?|file|game|gameplay|hud|implementation|level|player|project|repo|repository|runtime|scene|service|settings?|source|tool|world|workspace|src[\\/]|\.tsx?\b|\.jsx?\b)\b/i.test(trimmed)
    )
  );
}

function shouldAttachContinuityEditTools(prompt: string) {
  return EDIT_PROMPT_PATTERN.test(prompt) || TERSE_ACTION_FOLLOWUP_PATTERN.test(prompt) || TOOL_AVAILABILITY_PROBLEM_PATTERN.test(prompt);
}

function shouldAttachContinuityGitTools(prompt: string) {
  return LOCAL_GIT_CHANGE_REVIEW_PATTERN.test(prompt) || /\b(?:git|diff|status|changed|changes|worktree|branch|commit|push|pull)\b/i.test(prompt);
}

function shouldAttachContinuityGitHubTools(prompt: string) {
  return GITHUB_PROMPT_PATTERN.test(prompt) || /\b(?:issues?|prs?|pull requests?|actions?|workflow|stars?|forks?|tags?|complete them|close them|mark them|resolve them)\b/i.test(prompt);
}

function shouldAttachContinuityTerminalTools(prompt: string) {
  return TERMINAL_PROMPT_PATTERN.test(prompt) || /\b(?:clone|command|deploy|dev server|download|run|serve|start|terminal|test|build)\b/i.test(prompt);
}

function shouldAttachContinuityBrowserTools(prompt: string) {
  return BROWSER_PROMPT_PATTERN.test(prompt) || /\b(?:preview|browser|localhost|website|page|visual|ui|console)\b/i.test(prompt);
}

function looksLikeGmailPrompt(prompt: string) {
  if (!GMAIL_PROMPT_PATTERN.test(prompt)) {
    return false;
  }

  return !GMAIL_LOCAL_CODE_ONLY_PATTERN.test(prompt) || /\bgmail\b/i.test(prompt);
}

function looksLikeCalendarPrompt(prompt: string) {
  if (!CALENDAR_PROMPT_PATTERN.test(prompt)) {
    return false;
  }

  return !CALENDAR_LOCAL_CODE_ONLY_PATTERN.test(prompt) || /\bgoogle calendar\b/i.test(prompt);
}

export function shouldAttachWebSearch(prompt: string) {
  if (!WEB_PROMPT_PATTERN.test(prompt)) {
    return false;
  }

  return !LOCAL_DOCS_ONLY_PATTERN.test(prompt) || EXTERNAL_WEB_EVIDENCE_PATTERN.test(prompt);
}

function addGitHubToolIds(ids: Set<string>, prompt: string, looksLikeGitHubWork: boolean) {
  if (!looksLikeGitHubWork) {
    return;
  }

  const hasGitHubWriteIntent = /\b(?:approve|assign|cancel|close|commit|complete|create|delete|dispatch|duplicate|edit|force[-\s]?cancel|label|lock|mark|merge|pin|publish|push|reopen|request changes|rerun|resolve|review|transfer|unlock|unpin|update|watch|write)\b/i.test(prompt);
  const hasGitHubRawApiWriteIntent = /\b(?:api|rest|advanced)\b[\s\S]{0,120}\b(?:post|put|patch|delete|write|mutate|update|create|remove)\b/i.test(prompt);

  ids.add("github_account");
  ids.add("github_semantic_search");

  if (/\b(repo|repository|repositories|github|stars?|forks?|watchers?|open issues?|language|private|public|archived)\b/i.test(prompt)) {
    ids.add("github_list_repositories");
    ids.add("github_get_repository");
    ids.add("github_search_repositories");
    ids.add("github_list_contributors");
    ids.add("github_list_stargazers");
    ids.add("github_list_forks");
  }

  if (/\b(branch|branches|tags?|pr|prs?|pull requests?|release|workflow|actions?|commit|file|tree|search|code|issues?)\b/i.test(prompt)) {
    ids.add("github_get_repository");
    ids.add("github_list_branches");
  }

  if (/\b(tags?|versions?)\b/i.test(prompt)) {
    ids.add("github_list_tags");
  }

  if (/\b(file|tree|search|code|semantic|fuzzy|find)\b/i.test(prompt)) {
    ids.add("github_list_tree");
    ids.add("github_read_file");
    ids.add("github_search_code");
    ids.add("github_semantic_search");
    ids.add("github_search_issues");
    ids.add("github_search_repositories");
    ids.add("github_search_users");
  }

  if (/\b(?:create|make|new)\b[\s\S]{0,80}\bbranch\b|\bbranch\b[\s\S]{0,80}\b(?:create|make|new)\b/i.test(prompt)) {
    ids.add("github_create_branch");
  }

  if (/\b(commit files|write files|update files)\b/i.test(prompt)) {
    ids.add("github_commit_files");
  }

  if (/\b(issues?|ticket|bug report|mark(?:ed)? complete|completed|complete them|close(?:d)?|resolve(?:d)?|reopen|duplicate|labels?|assignees?|assign|milestones?|pin|unpin|lock|unlock|transfer|comment)\b/i.test(prompt)) {
    addAll(ids, GITHUB_ISSUE_READ_TOOL_IDS);

    if (hasGitHubWriteIntent || /\b(?:complete them|close(?:d)?|resolve(?:d)?|reopen|duplicate|labels?|assignees?|assign|pin|unpin|lock|unlock|transfer|comment)\b/i.test(prompt)) {
      addAll(ids, GITHUB_ISSUE_WRITE_TOOL_IDS);
    }
  }

  if (/\b(pr|prs?|pull requests?|reviewers?|reviews?|approve|request changes|files changed|commits?|merged?|update branch)\b/i.test(prompt)) {
    addAll(ids, GITHUB_PULL_REQUEST_READ_TOOL_IDS);

    if (hasGitHubWriteIntent || /\b(?:approve|request changes|merge|reviewers?|update branch)\b/i.test(prompt)) {
      addAll(ids, GITHUB_PULL_REQUEST_WRITE_TOOL_IDS);
    }
  }

  if (/\brelease\b/i.test(prompt)) {
    ids.add("github_generate_release_notes");
    ids.add("github_list_releases");

    if (hasGitHubWriteIntent || /\b(?:publish|draft|upload|create)\b[\s\S]{0,80}\brelease\b/i.test(prompt)) {
      ids.add("github_create_release");
    }
  }

  if (/\b(workflow|actions?|runs?|rerun|cancel|force[-\s]?cancel|jobs?|artifacts?|approve|deployments?|pending deployment)\b/i.test(prompt)) {
    addAll(ids, GITHUB_WORKFLOW_READ_TOOL_IDS);

    if (hasGitHubWriteIntent || /\b(?:dispatch|rerun|cancel|force[-\s]?cancel|approve|review pending deployment)\b/i.test(prompt)) {
      addAll(ids, GITHUB_WORKFLOW_WRITE_TOOL_IDS);
    }
  }

  if (/\b(api|rest|advanced|webhook|hooks?|packages?|gists?|notifications?|projects?|security|code scanning|secret scanning|dependabot)\b/i.test(prompt)) {
    ids.add("github_list_code_scanning_alerts");
    ids.add("github_list_secret_scanning_alerts");
    ids.add("github_list_dependabot_alerts");
    ids.add("github_list_notifications");
    ids.add("github_api_read");

    if (hasGitHubWriteIntent || hasGitHubRawApiWriteIntent) {
      ids.add("github_mark_notification_thread_read");
      ids.add("github_mark_all_notifications_read");
      ids.add("github_api_write");
      ids.add("github_api_delete");
    }
  }

  if (/\b(?:everything|full|powerful|whatever else|all|full[-\s]?fledged)\b/i.test(prompt)) {
    addAll(ids, GITHUB_READ_TOOL_IDS);
  }

  if (/\b(?:full write access|all write tools|every github action|every github write|full github write)\b/i.test(prompt)) {
    addAll(ids, GITHUB_WRITE_TOOL_IDS);
  }
}

function addAll(ids: Set<string>, nextIds: Set<string>) {
  for (const id of nextIds) {
    ids.add(id);
  }
}
