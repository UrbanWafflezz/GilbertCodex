import {
  commitComputerGitChanges,
  createComputerGitBranch,
  diffComputerGitChanges,
  getComputerGitStatus,
  initComputerGitRepository,
  pullComputerGitBranch,
  pushComputerGitBranch,
  stageComputerGitChanges,
} from "../../../localWorkspace/files";
import {
  commitGithubFiles,
  createGithubBranch,
  createGithubPullRequest,
  createGithubRelease,
  dispatchGithubWorkflow,
  generateGithubReleaseNotes,
  getGithubRepository,
  getGithubState,
  listGithubBranches,
  listGithubReleases,
  listGithubRepositories,
  listGithubTree,
  listGithubWorkflowRuns,
  listGithubWorkflows,
  readGithubFile,
  requestGithubApi,
  searchGithubCode,
  summarizeGithubCodeSearchItems,
  type GithubCommitFilesRequest,
  type GithubCreateBranchRequest,
  type GithubCreatePullRequestRequest,
  type GithubCreateReleaseRequest,
  type GithubDispatchWorkflowRequest,
  type GithubGenerateReleaseNotesRequest,
  type GithubListBranchesRequest,
  type GithubListReleasesRequest,
  type GithubListRepositoriesRequest,
  type GithubListTreeRequest,
  type GithubListWorkflowRunsRequest,
  type GithubListWorkflowsRequest,
  type GithubReadFileRequest,
  type GithubRepositoryRequest,
  type GithubSearchCodeRequest,
} from "../../../app/githubClient";
import type {
  ComputerGitActionResult,
  ComputerGitDiffResult,
  ComputerGitStatus,
} from "../../../types/localWorkspace";
import type {
  GithubApiRequest,
  GithubApiResponse,
  GithubBranch,
  GithubCommitFilesResponse,
  GithubConnectionState,
  GithubDispatchWorkflowResponse,
  GithubPullRequestResponse,
  GithubReadFileResponse,
  GithubReleaseNotesResponse,
  GithubReleaseResponse,
  GithubRepository,
  GithubSearchCodeResponse,
  GithubTreeResponse,
  GithubWorkflowListResponse,
  GithubWorkflowRunListResponse,
} from "../../../types/github";

export interface LocalGitBackend {
  branch: (path: string, name: string) => Promise<ComputerGitActionResult>;
  commit: (path: string, message: string, stageAll?: boolean) => Promise<ComputerGitActionResult>;
  diff: (
    path: string,
    options?: {
      includeUntracked?: boolean;
      maxBytes?: number;
      paths?: string[];
      staged?: boolean;
    },
  ) => Promise<ComputerGitDiffResult>;
  init: (path: string, initialBranch?: string) => Promise<ComputerGitActionResult>;
  pull: (path: string, options?: { branch?: string; remote?: string }) => Promise<ComputerGitActionResult>;
  push: (path: string, remote?: string) => Promise<ComputerGitActionResult>;
  stage: (path: string, paths?: string[]) => Promise<ComputerGitActionResult>;
  status: (path: string, options?: { force?: boolean; includeDiffPreview?: boolean }) => Promise<ComputerGitStatus>;
}

export interface GithubBackend {
  account: () => Promise<GithubConnectionState>;
  api: (request: GithubApiRequest) => Promise<GithubApiResponse>;
  commitFiles: (request: GithubCommitFilesRequest) => Promise<GithubCommitFilesResponse>;
  createBranch: (request: GithubCreateBranchRequest) => Promise<GithubBranch>;
  createPullRequest: (request: GithubCreatePullRequestRequest) => Promise<GithubPullRequestResponse>;
  createRelease: (request: GithubCreateReleaseRequest) => Promise<GithubReleaseResponse>;
  dispatchWorkflow: (request: GithubDispatchWorkflowRequest) => Promise<GithubDispatchWorkflowResponse>;
  generateReleaseNotes: (request: GithubGenerateReleaseNotesRequest) => Promise<GithubReleaseNotesResponse>;
  getRepository: (request: GithubRepositoryRequest) => Promise<GithubRepository>;
  listBranches: (request: GithubListBranchesRequest) => Promise<GithubBranch[]>;
  listReleases: (request: GithubListReleasesRequest) => Promise<GithubReleaseResponse[]>;
  listRepositories: (request?: GithubListRepositoriesRequest) => Promise<GithubRepository[]>;
  listTree: (request: GithubListTreeRequest) => Promise<GithubTreeResponse>;
  listWorkflowRuns: (request: GithubListWorkflowRunsRequest) => Promise<GithubWorkflowRunListResponse>;
  listWorkflows: (request: GithubListWorkflowsRequest) => Promise<GithubWorkflowListResponse>;
  readFile: (request: GithubReadFileRequest) => Promise<GithubReadFileResponse>;
  searchCode: (request: GithubSearchCodeRequest) => Promise<GithubSearchCodeResponse>;
  summarizeCodeSearchItems: typeof summarizeGithubCodeSearchItems;
}

export interface GitToolBackends {
  github: GithubBackend;
  local: LocalGitBackend;
}

export const defaultLocalGitBackend: LocalGitBackend = {
  branch: (path, name) => createComputerGitBranch(path, name),
  commit: (path, message, stageAll) => commitComputerGitChanges(path, message, stageAll),
  diff: (path, options) => diffComputerGitChanges(path, options),
  init: (path, initialBranch) => initComputerGitRepository(path, initialBranch),
  pull: (path, options) => pullComputerGitBranch(path, options),
  push: (path, remote) => pushComputerGitBranch(path, remote),
  stage: (path, paths) => stageComputerGitChanges(path, paths),
  status: (path, options) => getComputerGitStatus(path, options),
};

export const defaultGithubBackend: GithubBackend = {
  account: () => getGithubState(),
  api: (request) => requestGithubApi(request),
  commitFiles: (request) => commitGithubFiles(request),
  createBranch: (request) => createGithubBranch(request),
  createPullRequest: (request) => createGithubPullRequest(request),
  createRelease: (request) => createGithubRelease(request),
  dispatchWorkflow: (request) => dispatchGithubWorkflow(request),
  generateReleaseNotes: (request) => generateGithubReleaseNotes(request),
  getRepository: (request) => getGithubRepository(request),
  listBranches: (request) => listGithubBranches(request),
  listReleases: (request) => listGithubReleases(request),
  listRepositories: (request) => listGithubRepositories(request),
  listTree: (request) => listGithubTree(request),
  listWorkflowRuns: (request) => listGithubWorkflowRuns(request),
  listWorkflows: (request) => listGithubWorkflows(request),
  readFile: (request) => readGithubFile(request),
  searchCode: (request) => searchGithubCode(request),
  summarizeCodeSearchItems: summarizeGithubCodeSearchItems,
};

export const defaultGitToolBackends: GitToolBackends = {
  github: defaultGithubBackend,
  local: defaultLocalGitBackend,
};
