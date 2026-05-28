import {
  copyComputerPath,
  createComputerDirectory,
  moveComputerPath,
  readComputerTextFile,
  writeComputerTextFiles,
  writeComputerTextFile,
  type WriteComputerTextFileItem,
  type WriteComputerTextFileOptions,
} from "../../../localWorkspace/files";
import type {
  ComputerMovePathResult,
  ComputerCopyPathResult,
  ComputerReadFileResult,
  ComputerCreateDirectoryResult,
  ComputerWriteFileResult,
  ComputerWriteFilesResult,
} from "../../../types/localWorkspace";

export interface EditingBackend {
  copyPath?: (
    fromPath: string,
    toPath: string,
    roots: string[],
    options?: { createParentDirs?: boolean; overwrite?: boolean },
  ) => Promise<ComputerCopyPathResult>;
  createDirectory?: (
    path: string,
    roots: string[],
    options?: { recursive?: boolean },
  ) => Promise<ComputerCreateDirectoryResult>;
  movePath?: (
    fromPath: string,
    toPath: string,
    roots: string[],
    options?: { createParentDirs?: boolean },
  ) => Promise<ComputerMovePathResult>;
  readTextFile: (path: string, maxBytes?: number) => Promise<ComputerReadFileResult>;
  writeTextFile: (
    path: string,
    content: string,
    roots: string[],
    options?: WriteComputerTextFileOptions,
  ) => Promise<ComputerWriteFileResult>;
  writeTextFiles?: (
    files: WriteComputerTextFileItem[],
    roots: string[],
  ) => Promise<ComputerWriteFilesResult>;
}

export const defaultEditingBackend: EditingBackend = {
  copyPath: (fromPath, toPath, roots, options) => copyComputerPath(fromPath, toPath, roots, options),
  createDirectory: (path, roots, options) => createComputerDirectory(path, roots, options),
  movePath: (fromPath, toPath, roots, options) => moveComputerPath(fromPath, toPath, roots, options),
  readTextFile: (path, maxBytes) => readComputerTextFile(path, maxBytes),
  writeTextFile: (path, content, roots, options) => writeComputerTextFile(path, content, roots, options),
  writeTextFiles: (files, roots) => writeComputerTextFiles(files, roots),
};
