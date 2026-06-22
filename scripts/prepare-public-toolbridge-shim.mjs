import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const toolBridgeRoot = path.join(repoRoot, "src", "toolBridge");
const indexPath = path.join(toolBridgeRoot, "index.ts");
const markerPath = path.join(toolBridgeRoot, ".public-shim");
const parsersPath = path.join(toolBridgeRoot, "parsers.ts");
const powerShellSourcePath = path.join(scriptDir, "prepare-public-toolbridge-shim.ps1");
const force = process.argv.includes("--force");
const markerVersion = "gilbert-codex-public-toolbridge-shim-v2";
const legacyMarkerVersion = "gilbert-codex-public-toolbridge-shim-v1";

const existingIndex = await fileExists(indexPath);
const powerShellSource = await readFile(powerShellSourcePath, "utf8");
const shimFiles = parseShimFiles(powerShellSource);
const existingPublicShim = await markerMatchesManagedFiles()
  || await looksLikeLegacyPublicShim();

if (!force && existingIndex && !existingPublicShim) {
  console.log("Existing local tool bridge found; public shim not needed.");
  process.exit(0);
}

if (shimFiles.length === 0) {
  throw new Error(`No shim files found in ${powerShellSourcePath}.`);
}

await mkdir(toolBridgeRoot, { recursive: true });

for (const shimFile of shimFiles) {
  const target = resolveShimPath(shimFile.relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, shimFile.content, "utf8");
}

await writeFile(markerPath, createMarkerContent(shimFiles), "utf8");

console.log("Generated public-safe tool bridge shim for CI/release builds.");

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function markerMatchesManagedFiles() {
  const marker = await readTextFile(markerPath);
  if (!marker) {
    return false;
  }

  if (marker.replace(/^\uFEFF/, "").trim() === legacyMarkerVersion) {
    return true;
  }

  try {
    const parsed = JSON.parse(marker.replace(/^\uFEFF/, ""));
    if (parsed.version !== markerVersion || !Array.isArray(parsed.files)) {
      return false;
    }

    for (const file of parsed.files) {
      if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string") {
        return false;
      }
      const content = await readTextFile(resolveShimPath(file.path));
      if (content === undefined || sha256(content) !== file.sha256) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function looksLikeLegacyPublicShim() {
  if (!existingIndex || !(await fileExists(parsersPath))) {
    return false;
  }

  const parsers = await readFile(parsersPath, "utf8");
  const index = await readFile(indexPath, "utf8");
  const hasLegacyParserStubs = /export function parseAnthropicToolCalls\([^)]*\)[^{]*\{\s*return \[\];\s*\}/m.test(
    parsers,
  ) && /export function parseResponsesToolCalls\([^)]*\)[^{]*\{\s*return \[\];\s*\}/m.test(
    parsers,
  );
  const hasLegacyIndexStub = index.includes("Provider tool bridge is not bundled in this public build.")
    && /export function selectAdvertisedBridgeTools\([^)]*\)[^{]*\{\s*return \[\] as ToolDefinition\[\];\s*\}/m.test(index);
  return hasLegacyParserStubs && hasLegacyIndexStub;
}

function createMarkerContent(files) {
  return `${JSON.stringify({
    files: files.map((file) => ({
      path: file.relativePath,
      sha256: sha256(file.content),
    })),
    version: markerVersion,
  }, null, 2)}\n`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseShimFiles(source) {
  const files = [];
  const shimFilePattern = /Write-ShimFile\s+"([^"]+)"\s+@'\r?\n([\s\S]*?)\r?\n'@/g;

  for (const match of source.matchAll(shimFilePattern)) {
    files.push({
      relativePath: match[1],
      content: match[2],
    });
  }

  return files;
}

function resolveShimPath(relativePath) {
  const target = path.resolve(toolBridgeRoot, ...relativePath.split(/[\\/]+/));
  const rootWithSeparator = `${toolBridgeRoot}${path.sep}`;

  if (target !== toolBridgeRoot && !target.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to write shim file outside src/toolBridge: ${relativePath}`);
  }

  return target;
}
