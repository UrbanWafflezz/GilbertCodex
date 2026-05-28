import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getFirebaseStorageBucket } from "./firebaseAuth.js";

const STORAGE_PREFIX = "nine-router-tenants";

export async function restoreTenantData(tenantId, dataDir) {
  const bucket = getFirebaseStorageBucket();
  const prefix = `${STORAGE_PREFIX}/${tenantId}/`;
  const [files] = await bucket.getFiles({ prefix });

  if (files.length === 0) {
    return { fileCount: 0 };
  }

  await mkdir(dataDir, { recursive: true });
  let fileCount = 0;

  for (const file of files) {
    const relativePath = file.name.slice(prefix.length);
    if (!relativePath || relativePath.endsWith("/")) {
      continue;
    }

    const destination = path.join(dataDir, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await file.download({ destination });
    fileCount += 1;
  }

  return { fileCount };
}

export async function persistTenantData(tenantId, dataDir) {
  const bucket = getFirebaseStorageBucket();
  const prefix = `${STORAGE_PREFIX}/${tenantId}/`;
  const localFiles = await listLocalFiles(dataDir);
  const localNames = new Set(localFiles.map((file) => file.relativeName));

  await Promise.all(localFiles.map((file) => {
    return bucket.upload(file.absolutePath, {
      destination: `${prefix}${file.relativeName}`,
      resumable: false,
    });
  }));

  const [remoteFiles] = await bucket.getFiles({ prefix });
  await Promise.all(remoteFiles.map((file) => {
    const relativeName = file.name.slice(prefix.length);
    if (!relativeName || localNames.has(relativeName)) {
      return Promise.resolve();
    }

    return file.delete({ ignoreNotFound: true });
  }));

  return { fileCount: localFiles.length };
}

async function listLocalFiles(rootDir) {
  const files = [];

  async function walk(currentDir, relativeDir) {
    let entries = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile() || shouldSkipFile(entry.name)) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      if (fileStat.size === 0) {
        continue;
      }

      files.push({
        absolutePath,
        relativeName: relativePath.split(path.sep).join("/"),
      });
    }
  }

  await walk(rootDir, "");
  return files;
}

function shouldSkipFile(name) {
  return name.endsWith("-journal") || name.endsWith(".tmp") || name.endsWith(".lock");
}
