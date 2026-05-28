import {
  listComputerDirectory,
  readComputerTextFileRange,
  readComputerTextFile,
  searchComputerFiles,
  searchComputerTextFiles,
} from "../../../localWorkspace/files";
import type {
  ComputerDirectoryListing,
  ComputerReadFileResult,
  ComputerReadFileRangeResult,
  ComputerSearchResult,
  ComputerTextSearchRequest,
  ComputerTextSearchResponse,
} from "../../../types/localWorkspace";

// Filesystem operations used by read-only file tools, abstracted for tests and future hardening.
export interface FilesBackend {
  listDirectory: (path: string, limit?: number) => Promise<ComputerDirectoryListing>;
  readTextFileRange?: (path: string, startLine: number, endLine: number) => Promise<ComputerReadFileRangeResult>;
  readTextFile: (path: string, maxBytes?: number, offset?: number) => Promise<ComputerReadFileResult>;
  searchIndexedFiles?: (query: string, limit?: number, roots?: string[]) => Promise<ComputerSearchResult[]>;
  searchTextFiles?: (request: ComputerTextSearchRequest) => Promise<ComputerTextSearchResponse>;
}

// Production backend wired to local workspace helpers; tests inject their own mock.
export const defaultFilesBackend: FilesBackend = {
  listDirectory: (path, limit) => listComputerDirectory(path, limit),
  readTextFileRange: (path, startLine, endLine) => readComputerTextFileRange(path, startLine, endLine),
  readTextFile: (path, maxBytes, offset) => readComputerTextFile(path, maxBytes, offset),
  searchIndexedFiles: (query, limit, roots) => searchComputerFiles(query, limit, roots),
  searchTextFiles: (request) => searchComputerTextFiles(request),
};
