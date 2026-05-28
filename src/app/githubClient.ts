import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime, openExternalUrl } from "./tauriClient";
import {
  cloudConnectorApi,
  disconnectCloudConnector,
  getCloudConnectorAccount,
  isCloudConnectorEnabled,
  pollCloudConnectorOAuth,
  startCloudConnectorOAuth,
  waitForCloudConnectorOAuth,
} from "../services/cloudConnectorClient";
import type {
  GithubBranch,
  GithubApiRequest,
  GithubApiResponse,
  GithubCodeSearchItem,
  GithubCommitFileInput,
  GithubCommitFilesResponse,
  GithubConnectionState,
  GithubDispatchWorkflowResponse,
  GithubDeviceLoginPollResponse,
  GithubDeviceLoginSession,
  GithubPullRequestResponse,
  GithubReadFileResponse,
  GithubReleaseNotesResponse,
  GithubReleaseResponse,
  GithubRepository,
  GithubSearchCodeResponse,
  GithubTreeResponse,
  GithubWorkflowListResponse,
  GithubWorkflowRunListResponse,
} from "../types/github";

export interface GithubListRepositoriesRequest {
  affiliation?: string;
  page?: number;
  perPage?: number;
  query?: string;
  sort?: string;
  visibility?: string;
}

export interface GithubRepositoryRequest {
  owner: string;
  repo: string;
}

export interface GithubListBranchesRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubListTreeRequest extends GithubRepositoryRequest {
  branch?: string;
  limit?: number;
  recursive?: boolean;
}

export interface GithubReadFileRequest extends GithubRepositoryRequest {
  branch?: string;
  maxBytes?: number;
  path: string;
}

export interface GithubSearchCodeRequest {
  branch?: string;
  owner?: string;
  page?: number;
  perPage?: number;
  query: string;
  repo?: string;
}

export interface GithubCreateBranchRequest extends GithubRepositoryRequest {
  baseBranch?: string;
  newBranch: string;
}

export interface GithubCommitFilesRequest extends GithubRepositoryRequest {
  branch?: string;
  files: GithubCommitFileInput[];
  message: string;
}

export interface GithubCreatePullRequestRequest extends GithubRepositoryRequest {
  base: string;
  body?: string;
  draft?: boolean;
  head: string;
  title: string;
}

export interface GithubGenerateReleaseNotesRequest extends GithubRepositoryRequest {
  configurationFilePath?: string;
  previousTagName?: string;
  tagName: string;
  targetCommitish?: string;
}

export interface GithubCreateReleaseRequest extends GithubRepositoryRequest {
  body?: string;
  draft?: boolean;
  generateReleaseNotes?: boolean;
  makeLatest?: "false" | "legacy" | "true" | string;
  name?: string;
  prerelease?: boolean;
  tagName: string;
  targetCommitish?: string;
}

export interface GithubListReleasesRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubListWorkflowsRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubDispatchWorkflowRequest extends GithubRepositoryRequest {
  inputs?: Record<string, unknown>;
  ref: string;
  workflowId: string;
}

export interface GithubListWorkflowRunsRequest extends GithubRepositoryRequest {
  branch?: string;
  event?: string;
  page?: number;
  perPage?: number;
  status?: string;
  workflowId: string;
}

export interface GithubBeginDeviceLoginRequest {
  clientId: string;
  scope?: string;
}

export interface GithubPollDeviceLoginRequest {
  clientId: string;
  deviceCode: string;
}

// Broad GitHub OAuth scope bundle keeps integration actions usable while GitHub still enforces account policy.
export const GITHUB_FULL_ACCESS_OAUTH_SCOPES = [
  "repo",
  "workflow",
  "delete_repo",
  "admin:repo_hook",
  "admin:org",
  "admin:public_key",
  "admin:org_hook",
  "gist",
  "notifications",
  "user",
  "project",
  "write:packages",
  "read:packages",
  "delete:packages",
  "admin:gpg_key",
  "codespace",
  "read:audit_log",
  "security_events",
] as const;

const DEFAULT_GITHUB_OAUTH_SCOPE = GITHUB_FULL_ACCESS_OAUTH_SCOPES.join(" ");

/** Returns true when GitHub API actions can route through the Tauri command layer. */
export function githubDesktopAvailable() {
  return githubCloudAvailable() || isTauriDesktopRuntime();
}

/** Returns true when hosted GitHub OAuth/API routing is configured. */
export function githubCloudAvailable() {
  return isCloudConnectorEnabled("github");
}

/** Returns the initial OAuth App client ID used by device-flow sign-in. */
export function getDefaultGithubOAuthClientId() {
  return "";
}

/** Returns the space-delimited scope string sent to GitHub's device-flow endpoint. */
export function getDefaultGithubOAuthScope() {
  return DEFAULT_GITHUB_OAUTH_SCOPE;
}

/** Returns the app's preferred full-access scope list as individual tokens. */
export function getRequiredGithubOAuthScopes() {
  return [...GITHUB_FULL_ACCESS_OAUTH_SCOPES];
}

/** Compares granted token scopes against the app's preferred full-access bundle. */
export function getMissingRequiredGithubOAuthScopes(scopes: string[]) {
  const grantedScopes = new Set(scopes.map(normalizeGithubOAuthScope));

  return getRequiredGithubOAuthScopes().filter((scope) => !isGithubOAuthScopeGranted(scope, grantedScopes));
}

/** Handles GitHub's implied-scope behavior when deciding whether a reconnect is needed. */
export function isGithubOAuthScopeGranted(scope: string, grantedScopesInput: Iterable<string>) {
  const normalizedScope = normalizeGithubOAuthScope(scope);
  const grantedScopes = grantedScopesInput instanceof Set
    ? grantedScopesInput
    : new Set([...grantedScopesInput].map(normalizeGithubOAuthScope));

  if (grantedScopes.has(normalizedScope)) {
    return true;
  }

  if ((normalizedScope === "admin:repo_hook" || normalizedScope === "security_events") && grantedScopes.has("repo")) {
    return true;
  }

  // GitHub may return a normalized OAuth scope list with implied scopes omitted.
  if (normalizedScope === "read:packages" && grantedScopes.has("write:packages")) {
    return true;
  }

  return false;
}

function normalizeGithubOAuthScope(scope: string) {
  return scope.trim().toLowerCase();
}

export async function getGithubState(): Promise<GithubConnectionState> {
  if (githubCloudAvailable()) {
    return normalizeCloudGithubConnection(await getCloudConnectorAccount<CloudGithubAccount>("github"));
  }

  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_get_state");
}

/** Marks the first-party GitHub plugin installed locally without changing the account token. */
export async function installGithubPlugin(): Promise<GithubConnectionState> {
  if (githubCloudAvailable()) {
    const state = await getGithubState();
    return state.connected ? state : { ...state, pluginInstalled: true, pluginInstalledAt: Date.now() };
  }

  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_install_plugin");
}

/** Starts hosted OAuth sign-in and waits until the cloud callback stores the token. */
export async function connectGithubCloudOAuth(scope = DEFAULT_GITHUB_OAUTH_SCOPE): Promise<GithubConnectionState> {
  if (!githubCloudAvailable()) {
    throw new Error("Hosted GitHub sign-in is not configured.");
  }

  const session = await startCloudConnectorOAuth("github", { scope });
  await openExternalUrl(session.authorizationUrl);
  return normalizeCloudGithubConnection(await waitForCloudConnectorOAuth<CloudGithubAccount>("github", session));
}

/** Starts GitHub OAuth device flow and returns the user-code session to show in Settings. */
export async function beginGithubDeviceLogin(request: GithubBeginDeviceLoginRequest): Promise<GithubDeviceLoginSession> {
  if (githubCloudAvailable()) {
    const session = await startCloudConnectorOAuth("github", {
      scope: request.scope || DEFAULT_GITHUB_OAUTH_SCOPE,
    });
    return {
      deviceCode: session.state,
      expiresIn: Math.max(1, Math.round((session.expiresAt - Date.now()) / 1000)),
      interval: session.interval,
      scope: request.scope || DEFAULT_GITHUB_OAUTH_SCOPE,
      userCode: session.userCode || "BROWSER",
      verificationUri: session.verificationUri || session.authorizationUrl,
    };
  }

  assertGithubDesktop();
  return invoke<GithubDeviceLoginSession>("github_begin_device_login", {
    request: {
      clientId: request.clientId,
      scope: request.scope || DEFAULT_GITHUB_OAUTH_SCOPE,
    },
  });
}

/** Opens the verified GitHub device authorization URL in the user's browser. */
export async function openGithubDeviceLogin(verificationUri?: string): Promise<void> {
  if (githubCloudAvailable()) {
    await openExternalUrl(verificationUri || "https://github.com/login/oauth/authorize");
    return;
  }

  assertGithubDesktop();
  return invoke<void>("github_open_device_login", {
    request: {
      verificationUri,
    },
  });
}

/** Polls GitHub device flow; pending authorization is returned as data. */
export async function pollGithubDeviceLogin(request: GithubPollDeviceLoginRequest): Promise<GithubDeviceLoginPollResponse> {
  if (githubCloudAvailable()) {
    const status = await pollCloudConnectorOAuth<CloudGithubAccount>("github", request.deviceCode);
    return {
      connection: status.account ? normalizeCloudGithubConnection(status.account) : undefined,
      error: status.error,
      message: status.message,
      status: status.status === "authorized" ? "authorized" : status.status === "expired" ? "expired" : status.status === "error" ? "error" : "pending",
    };
  }

  assertGithubDesktop();
  return invoke<GithubDeviceLoginPollResponse>("github_poll_device_login", {
    request: {
      clientId: request.clientId,
      deviceCode: request.deviceCode,
    },
  });
}

/** Connects with a token pasted by the user and returns the persisted account state. */
export async function connectGithubWithToken(token: string): Promise<GithubConnectionState> {
  if (githubCloudAvailable()) {
    throw new Error("Hosted GitHub uses browser sign-in. Personal access tokens are not accepted by managed sign-in.");
  }

  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_connect_token", {
    request: {
      token,
    },
  });
}

/** Disconnects GitHub and clears the local token store. */
export async function disconnectGithub(): Promise<GithubConnectionState> {
  if (githubCloudAvailable()) {
    return normalizeCloudGithubConnection(await disconnectCloudConnector<CloudGithubAccount>("github"));
  }

  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_disconnect");
}

/** Lists repositories visible to the connected account, with optional local filtering. */
export async function listGithubRepositories(request: GithubListRepositoriesRequest = {}): Promise<GithubRepository[]> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<unknown[]>({
      method: "GET",
      path: "/user/repos",
      query: {
        affiliation: request.affiliation || "owner,collaborator,organization_member",
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
        sort: request.sort || "updated",
        visibility: request.visibility,
      },
    });
    const repos = Array.isArray(response.data) ? response.data.map(normalizeGithubRepository).filter(Boolean) as GithubRepository[] : [];
    const search = request.query?.trim().toLowerCase();
    return search ? repos.filter((repo) => `${repo.fullName}\n${repo.description ?? ""}\n${repo.language ?? ""}`.toLowerCase().includes(search)) : repos;
  }

  assertGithubDesktop();
  return invoke<GithubRepository[]>("github_list_repositories", { request });
}

/** Reads normalized metadata for a single repository. */
export async function getGithubRepository(request: GithubRepositoryRequest): Promise<GithubRepository> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<unknown>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}`,
    });
    return requireGithubRepository(response.data);
  }

  assertGithubDesktop();
  return invoke<GithubRepository>("github_get_repository", { request });
}

/** Lists branch heads for a repository. */
export async function listGithubBranches(request: GithubListBranchesRequest): Promise<GithubBranch[]> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<unknown[]>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/branches`,
      query: {
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
      },
    });
    return Array.isArray(response.data) ? response.data.map(normalizeGithubBranch).filter(Boolean) as GithubBranch[] : [];
  }

  assertGithubDesktop();
  return invoke<GithubBranch[]>("github_list_branches", { request });
}

/** Lists a capped branch tree for remote file discovery. */
export async function listGithubTree(request: GithubListTreeRequest): Promise<GithubTreeResponse> {
  if (githubCloudAvailable()) {
    const repo = await getGithubRepository(request);
    const branch = request.branch?.trim() || repo.defaultBranch;
    const response = await cloudGithubApi<{ tree?: unknown[]; truncated?: boolean }>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/trees/${encodeGithubPathSegment(branch)}`,
      query: {
        recursive: request.recursive ? "1" : undefined,
      },
    });
    const allEntries = Array.isArray(response.data.tree) ? response.data.tree : [];
    const limit = Math.max(1, request.limit ?? 1000);
    const entries = allEntries.slice(0, limit).map(normalizeGithubTreeEntry).filter(Boolean) as GithubTreeResponse["entries"];
    return {
      branch,
      commitSha: branch,
      entries,
      truncated: Boolean(response.data.truncated) || entries.length < allEntries.length,
    };
  }

  assertGithubDesktop();
  return invoke<GithubTreeResponse>("github_list_tree", { request });
}

/** Reads one text file from a repository branch. */
export async function readGithubFile(request: GithubReadFileRequest): Promise<GithubReadFileResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<Record<string, unknown>>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/contents/${encodeGithubRepoPath(request.path)}`,
      query: {
        ref: request.branch,
      },
    });
    return normalizeGithubFileResponse(response.data, request);
  }

  assertGithubDesktop();
  return invoke<GithubReadFileResponse>("github_read_file", { request });
}

/** Searches code through GitHub's API and returns normalized source links. */
export async function searchGithubCode(request: GithubSearchCodeRequest): Promise<GithubSearchCodeResponse> {
  if (githubCloudAvailable()) {
    const qualifiers = [
      request.query.trim(),
      request.owner && request.repo ? `repo:${request.owner}/${request.repo}` : request.owner ? `user:${request.owner}` : "",
      request.branch ? `ref:${request.branch}` : "",
    ].filter(Boolean).join(" ");
    const response = await cloudGithubApi<{ incomplete_results?: boolean; items?: unknown[]; total_count?: number }>({
      method: "GET",
      path: "/search/code",
      query: {
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
        q: qualifiers,
      },
    });
    return {
      incompleteResults: response.data.incomplete_results === true,
      items: Array.isArray(response.data.items) ? response.data.items.map(normalizeGithubCodeSearchItem).filter(Boolean) as GithubCodeSearchItem[] : [],
      totalCount: Number(response.data.total_count || 0),
    };
  }

  assertGithubDesktop();
  return invoke<GithubSearchCodeResponse>("github_search_code", { request });
}

/** Creates a branch from the default or selected base branch. */
export async function createGithubBranch(request: GithubCreateBranchRequest): Promise<GithubBranch> {
  if (githubCloudAvailable()) {
    const repo = await getGithubRepository(request);
    const baseBranch = request.baseBranch?.trim() || repo.defaultBranch;
    const baseRef = await cloudGithubApi<{ object?: { sha?: string } }>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/ref/heads/${encodeGithubRepoPath(baseBranch)}`,
    });
    const baseSha = stringField(baseRef.data.object?.sha);
    if (!baseSha) {
      throw new Error("GitHub base branch did not return a commit SHA.");
    }

    const created = await cloudGithubApi<{ object?: { sha?: string } }>({
      body: {
        ref: `refs/heads/${request.newBranch}`,
        sha: baseSha,
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/refs`,
    });
    return {
      commitSha: stringField(created.data.object?.sha) || baseSha,
      name: request.newBranch,
      protected: false,
    };
  }

  assertGithubDesktop();
  return invoke<GithubBranch>("github_create_branch", { request });
}

/** Commits one or more file changes directly through GitHub's Git database API. */
export async function commitGithubFiles(request: GithubCommitFilesRequest): Promise<GithubCommitFilesResponse> {
  if (githubCloudAvailable()) {
    return commitGithubFilesViaCloud(request);
  }

  assertGithubDesktop();
  return invoke<GithubCommitFilesResponse>("github_commit_files", { request });
}

/** Opens a pull request, defaulting to draft behavior in the Rust command. */
export async function createGithubPullRequest(request: GithubCreatePullRequestRequest): Promise<GithubPullRequestResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<Record<string, unknown>>({
      body: {
        base: request.base,
        body: request.body,
        draft: request.draft ?? true,
        head: request.head,
        title: request.title,
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/pulls`,
    });
    return normalizeGithubPullRequest(response.data);
  }

  assertGithubDesktop();
  return invoke<GithubPullRequestResponse>("github_create_pull_request", { request });
}

/** Generates release notes through GitHub without creating a release. */
export async function generateGithubReleaseNotes(request: GithubGenerateReleaseNotesRequest): Promise<GithubReleaseNotesResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<Record<string, unknown>>({
      body: {
        configuration_file_path: request.configurationFilePath,
        previous_tag_name: request.previousTagName,
        tag_name: request.tagName,
        target_commitish: request.targetCommitish,
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/releases/generate-notes`,
    });
    return {
      body: stringField(response.data.body),
      name: stringField(response.data.name) || request.tagName,
    };
  }

  assertGithubDesktop();
  return invoke<GithubReleaseNotesResponse>("github_generate_release_notes", { request });
}

/** Creates a GitHub release through the connected account. */
export async function createGithubRelease(request: GithubCreateReleaseRequest): Promise<GithubReleaseResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<Record<string, unknown>>({
      body: {
        body: request.body,
        draft: request.draft,
        generate_release_notes: request.generateReleaseNotes,
        make_latest: request.makeLatest,
        name: request.name,
        prerelease: request.prerelease,
        tag_name: request.tagName,
        target_commitish: request.targetCommitish,
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/releases`,
    });
    return requireGithubRelease(response.data);
  }

  assertGithubDesktop();
  return invoke<GithubReleaseResponse>("github_create_release", { request });
}

/** Lists releases visible to the connected account. */
export async function listGithubReleases(request: GithubListReleasesRequest): Promise<GithubReleaseResponse[]> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<unknown[]>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/releases`,
      query: {
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
      },
    });
    return Array.isArray(response.data) ? response.data.map(normalizeGithubRelease).filter(Boolean) as GithubReleaseResponse[] : [];
  }

  assertGithubDesktop();
  return invoke<GithubReleaseResponse[]>("github_list_releases", { request });
}

/** Lists GitHub Actions workflows for a repository. */
export async function listGithubWorkflows(request: GithubListWorkflowsRequest): Promise<GithubWorkflowListResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<{ total_count?: number; workflows?: unknown[] }>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/actions/workflows`,
      query: {
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
      },
    });
    return {
      totalCount: Number(response.data.total_count || 0),
      workflows: Array.isArray(response.data.workflows) ? response.data.workflows.map(normalizeGithubWorkflow).filter(Boolean) as GithubWorkflowListResponse["workflows"] : [],
    };
  }

  assertGithubDesktop();
  return invoke<GithubWorkflowListResponse>("github_list_workflows", { request });
}

/** Dispatches a workflow_dispatch workflow for a ref and optional inputs. */
export async function dispatchGithubWorkflow(request: GithubDispatchWorkflowRequest): Promise<GithubDispatchWorkflowResponse> {
  if (githubCloudAvailable()) {
    await cloudGithubApi<unknown>({
      body: {
        inputs: request.inputs,
        ref: request.ref,
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/actions/workflows/${encodeGithubPathSegment(request.workflowId)}/dispatches`,
    });
    return {
      refName: request.ref,
      workflowId: request.workflowId,
    };
  }

  assertGithubDesktop();
  return invoke<GithubDispatchWorkflowResponse>("github_dispatch_workflow", { request });
}

/** Lists recent runs for a selected workflow. */
export async function listGithubWorkflowRuns(request: GithubListWorkflowRunsRequest): Promise<GithubWorkflowRunListResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<{ total_count?: number; workflow_runs?: unknown[] }>({
      method: "GET",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/actions/workflows/${encodeGithubPathSegment(request.workflowId)}/runs`,
      query: {
        branch: request.branch,
        event: request.event,
        page: request.page,
        per_page: clampGithubPerPage(request.perPage),
        status: request.status,
      },
    });
    return {
      runs: Array.isArray(response.data.workflow_runs) ? response.data.workflow_runs.map(normalizeGithubWorkflowRun).filter(Boolean) as GithubWorkflowRunListResponse["runs"] : [],
      totalCount: Number(response.data.total_count || 0),
    };
  }

  assertGithubDesktop();
  return invoke<GithubWorkflowRunListResponse>("github_list_workflow_runs", { request });
}

/** Uses the connected account for advanced GitHub REST API resources not covered by a specific wrapper. */
export async function requestGithubApi(request: GithubApiRequest): Promise<GithubApiResponse> {
  if (githubCloudAvailable()) {
    const response = await cloudGithubApi<unknown>({
      body: request.body,
      method: request.method,
      path: request.path,
      query: request.query,
    });
    return {
      data: response.data,
      message: response.message,
      method: response.method as GithubApiRequest["method"],
      path: response.path,
      status: response.status,
    };
  }

  assertGithubDesktop();
  return invoke<GithubApiResponse>("github_api", { request });
}

/** Formats search hits for model-visible output without leaking raw API JSON. */
export function summarizeGithubCodeSearchItems(items: GithubCodeSearchItem[]) {
  return items.map((item, index) => `${index + 1}. ${item.repositoryFullName}:${item.path} (${item.sha.slice(0, 7)})\n${item.htmlUrl}`).join("\n");
}

function assertGithubDesktop() {
  if (!githubDesktopAvailable()) {
    throw new Error("GitHub integration is available in the desktop app or the hosted GitHub connector.");
  }
}

interface CloudGithubAccount {
  connected?: boolean;
  connectedAt?: number;
  pluginInstalled?: boolean;
  pluginInstalledAt?: number;
  scopes?: string[];
  user?: {
    avatarUrl?: string;
    htmlUrl?: string;
    id?: number;
    login?: string;
    name?: string;
  };
}

async function cloudGithubApi<TData>(request: GithubApiRequest) {
  return cloudConnectorApi<TData>("github", request);
}

function normalizeCloudGithubConnection(account: CloudGithubAccount): GithubConnectionState {
  return {
    connected: account.connected === true,
    connectedAt: normalizeNumber(account.connectedAt),
    pluginInstalled: account.pluginInstalled === true || account.connected === true,
    pluginInstalledAt: normalizeNumber(account.pluginInstalledAt),
    scopes: Array.isArray(account.scopes) ? account.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    user: account.user?.login
      ? {
          avatarUrl: account.user.avatarUrl || undefined,
          htmlUrl: account.user.htmlUrl || `https://github.com/${account.user.login}`,
          id: Number(account.user.id || 0),
          login: account.user.login,
          name: account.user.name || undefined,
        }
      : undefined,
  };
}

function normalizeGithubRepository(value: unknown): GithubRepository | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const repo = value as Record<string, any>;
  const fullName = stringField(repo.full_name);
  const name = stringField(repo.name);
  const ownerLogin = stringField(repo.owner?.login) || fullName.split("/")[0] || "";
  if (!fullName || !name || !ownerLogin) {
    return null;
  }

  return {
    archived: boolOrUndefined(repo.archived),
    defaultBranch: stringField(repo.default_branch) || "main",
    description: optionalString(repo.description),
    disabled: boolOrUndefined(repo.disabled),
    fork: boolOrUndefined(repo.fork),
    forksCount: optionalNumber(repo.forks_count),
    fullName,
    htmlUrl: stringField(repo.html_url),
    language: optionalString(repo.language),
    name,
    openIssuesCount: optionalNumber(repo.open_issues_count),
    ownerLogin,
    permissions: {
      admin: repo.permissions?.admin === true,
      pull: repo.permissions?.pull !== false,
      push: repo.permissions?.push === true,
    },
    private: repo.private === true,
    pushedAt: optionalString(repo.pushed_at),
    stargazersCount: optionalNumber(repo.stargazers_count),
    updatedAt: optionalString(repo.updated_at),
    watchersCount: optionalNumber(repo.watchers_count),
  };
}

function requireGithubRepository(value: unknown): GithubRepository {
  const repo = normalizeGithubRepository(value);
  if (!repo) {
    throw new Error("GitHub repository response was incomplete.");
  }
  return repo;
}

function normalizeGithubBranch(value: unknown): GithubBranch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const branch = value as Record<string, any>;
  const name = stringField(branch.name);
  const sha = stringField(branch.commit?.sha);
  return name && sha ? { commitSha: sha, name, protected: branch.protected === true } : null;
}

function normalizeGithubTreeEntry(value: unknown): GithubTreeResponse["entries"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, any>;
  const path = stringField(entry.path);
  const sha = stringField(entry.sha);
  const kind = stringField(entry.type || entry.kind);
  return path && sha && kind
    ? {
        kind,
        mode: optionalString(entry.mode),
        path,
        sha,
        size: optionalNumber(entry.size),
        url: optionalString(entry.url),
      }
    : null;
}

function normalizeGithubFileResponse(value: Record<string, unknown>, request: GithubReadFileRequest): GithubReadFileResponse {
  const content = typeof value.content === "string" ? value.content.replace(/[\r\n]/g, "") : "";
  const size = optionalNumber(value.size) ?? 0;
  const maxBytes = request.maxBytes ?? 512_000;
  const bytes = decodeGithubBase64(content);
  const truncated = bytes.length > maxBytes;
  const displayBytes = truncated ? bytes.slice(0, maxBytes) : bytes;

  return {
    branch: request.branch,
    content: new TextDecoder().decode(displayBytes),
    downloadUrl: optionalString(value.download_url),
    encoding: optionalString(value.encoding) || "base64",
    htmlUrl: optionalString(value.html_url),
    name: stringField(value.name),
    path: stringField(value.path) || request.path,
    sha: stringField(value.sha),
    size,
    truncated,
  };
}

function normalizeGithubCodeSearchItem(value: unknown): GithubCodeSearchItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, any>;
  const repositoryFullName = stringField(item.repository?.full_name);
  const path = stringField(item.path);
  const sha = stringField(item.sha);
  return repositoryFullName && path && sha
    ? {
        htmlUrl: stringField(item.html_url),
        name: stringField(item.name),
        path,
        repositoryFullName,
        score: Number(item.score || 0),
        sha,
      }
    : null;
}

async function commitGithubFilesViaCloud(request: GithubCommitFilesRequest): Promise<GithubCommitFilesResponse> {
  const repo = await getGithubRepository(request);
  const branch = request.branch?.trim() || repo.defaultBranch;
  const branchRefPath = `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/ref/heads/${encodeGithubRepoPath(branch)}`;
  const branchRef = await cloudGithubApi<{ object?: { sha?: string } }>({ method: "GET", path: branchRefPath });
  const parentSha = stringField(branchRef.data.object?.sha);
  if (!parentSha) {
    throw new Error("GitHub branch ref did not return a parent commit SHA.");
  }

  const parentCommit = await cloudGithubApi<{ tree?: { sha?: string } }>({
    method: "GET",
    path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/commits/${encodeGithubPathSegment(parentSha)}`,
  });
  const baseTree = stringField(parentCommit.data.tree?.sha);
  if (!baseTree) {
    throw new Error("GitHub parent commit did not return a tree SHA.");
  }

  const tree = [];
  for (const file of request.files) {
    const path = normalizeGithubCommitPath(file.path);
    const operation = (file.operation || "upsert").toLowerCase();
    if (operation === "delete" || operation === "remove") {
      tree.push({ mode: "100644", path, sha: null, type: "blob" });
      continue;
    }

    const blob = await cloudGithubApi<{ sha?: string }>({
      body: {
        content: file.content ?? "",
        encoding: "utf-8",
      },
      method: "POST",
      path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/blobs`,
    });
    const blobSha = stringField(blob.data.sha);
    if (!blobSha) {
      throw new Error(`GitHub did not return a blob SHA for ${path}.`);
    }
    tree.push({ mode: "100644", path, sha: blobSha, type: "blob" });
  }

  const createdTree = await cloudGithubApi<{ sha?: string }>({
    body: {
      base_tree: baseTree,
      tree,
    },
    method: "POST",
    path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/trees`,
  });
  const treeSha = stringField(createdTree.data.sha);
  if (!treeSha) {
    throw new Error("GitHub did not return the new tree SHA.");
  }

  const commit = await cloudGithubApi<{ html_url?: string; sha?: string }>({
    body: {
      message: request.message,
      parents: [parentSha],
      tree: treeSha,
    },
    method: "POST",
    path: `/repos/${encodeGithubPathSegment(request.owner)}/${encodeGithubPathSegment(request.repo)}/git/commits`,
  });
  const commitSha = stringField(commit.data.sha);
  if (!commitSha) {
    throw new Error("GitHub did not return the new commit SHA.");
  }

  await cloudGithubApi<unknown>({
    body: { sha: commitSha },
    method: "PATCH",
    path: branchRefPath,
  });

  return {
    branch,
    commitHtmlUrl: stringField(commit.data.html_url) || `https://github.com/${request.owner}/${request.repo}/commit/${commitSha}`,
    commitSha,
    filesChanged: request.files.length,
    parentSha,
  };
}

function normalizeGithubPullRequest(value: Record<string, unknown>): GithubPullRequestResponse {
  return {
    htmlUrl: stringField(value.html_url),
    number: Number(value.number || 0),
    state: stringField(value.state),
    title: stringField(value.title),
  };
}

function normalizeGithubRelease(value: unknown): GithubReleaseResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const release = value as Record<string, unknown>;
  const tagName = stringField(release.tag_name);
  const htmlUrl = stringField(release.html_url);
  if (!tagName || !htmlUrl) {
    return null;
  }

  return {
    body: optionalString(release.body),
    draft: release.draft === true,
    htmlUrl,
    id: Number(release.id || 0),
    name: optionalString(release.name),
    prerelease: release.prerelease === true,
    publishedAt: optionalString(release.published_at),
    tagName,
  };
}

function requireGithubRelease(value: unknown): GithubReleaseResponse {
  const release = normalizeGithubRelease(value);
  if (!release) {
    throw new Error("GitHub release response was incomplete.");
  }
  return release;
}

function normalizeGithubWorkflow(value: unknown): GithubWorkflowListResponse["workflows"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const workflow = value as Record<string, unknown>;
  const id = Number(workflow.id || 0);
  const name = stringField(workflow.name);
  return id && name
    ? {
        badgeUrl: stringField(workflow.badge_url),
        createdAt: stringField(workflow.created_at),
        htmlUrl: stringField(workflow.html_url),
        id,
        name,
        path: stringField(workflow.path),
        state: stringField(workflow.state),
        updatedAt: stringField(workflow.updated_at),
      }
    : null;
}

function normalizeGithubWorkflowRun(value: unknown): GithubWorkflowRunListResponse["runs"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const run = value as Record<string, unknown>;
  const id = Number(run.id || 0);
  return id
    ? {
        branch: optionalString(run.head_branch),
        conclusion: optionalString(run.conclusion),
        createdAt: stringField(run.created_at),
        event: stringField(run.event),
        headSha: stringField(run.head_sha),
        htmlUrl: stringField(run.html_url),
        id,
        name: optionalString(run.name),
        runNumber: Number(run.run_number || 0),
        status: optionalString(run.status),
        updatedAt: stringField(run.updated_at),
      }
    : null;
}

function decodeGithubBase64(content: string) {
  if (!content) {
    return new Uint8Array();
  }

  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeGithubCommitPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized.includes("\0")) {
    throw new Error("GitHub file path must stay inside the repository.");
  }
  return normalized;
}

function encodeGithubRepoPath(path: string) {
  return path.split("/").map(encodeGithubPathSegment).join("/");
}

function encodeGithubPathSegment(segment: string) {
  return encodeURIComponent(segment.trim()).replace(/%2F/gi, "/");
}

function clampGithubPerPage(value: number | undefined) {
  return Math.max(1, Math.min(100, value ?? 30));
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}
