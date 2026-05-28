import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BUCKET = "gilbertcodex-40428.firebasestorage.app";

const options = parseArgs(process.argv.slice(2));
const tag = normalizeTag(options.tag || process.env.GITHUB_REF_NAME || "");
const version = tag.replace(/^v/i, "");
const assetsDir = path.resolve(options.assetsDir || ".release-assets");
const outDir = path.resolve(options.outDir || ".firebase-release");
const bucket = options.bucket || process.env.FIREBASE_RELEASE_BUCKET || DEFAULT_BUCKET;
const storageBaseUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;

if (!tag) {
  fail("Missing release tag. Pass --tag v0.8.5.");
}

const releaseRoot = path.join(outDir, "releases");
const versionRoot = path.join(releaseRoot, tag);
await mkdir(versionRoot, { recursive: true });

const assetFiles = await listFiles(assetsDir);
if (!assetFiles.length) {
  fail(`No release assets were found in ${assetsDir}.`);
}

const latestAsset = assetFiles.find((file) => path.basename(file).toLowerCase() === "latest.json");
if (!latestAsset) {
  fail("The release assets did not include latest.json. Tauri updater releases must publish that file.");
}

const originalLatest = JSON.parse(await readFile(latestAsset, "utf8"));
const latest = rewriteLatestJson(originalLatest, assetFiles);
const manifest = await createWebsiteManifest(assetFiles, latest);

for (const file of assetFiles) {
  const name = path.basename(file);
  const targetName = name.toLowerCase() === "latest.json" ? "latest.github.json" : name;
  await copyFile(file, path.join(versionRoot, targetName));
}

const latestJson = `${JSON.stringify(latest, null, 2)}\n`;
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

await writeFile(path.join(releaseRoot, "latest.json"), latestJson);
await writeFile(path.join(versionRoot, "latest.json"), latestJson);
await writeFile(path.join(releaseRoot, "manifest.json"), manifestJson);
await writeFile(path.join(versionRoot, "manifest.json"), manifestJson);

console.log(`Prepared Firebase release feed for ${tag}`);
console.log(`Updater feed: ${storageUrl("releases/latest.json")}`);
console.log(`Website manifest: ${storageUrl("releases/manifest.json")}`);

function rewriteLatestJson(latestJsonValue, files) {
  const latestCopy = structuredClone(latestJsonValue);
  const platforms = latestCopy.platforms && typeof latestCopy.platforms === "object" ? latestCopy.platforms : {};
  const filesByName = new Map(files.map((file) => [path.basename(file), file]));

  for (const [platformKey, platform] of Object.entries(platforms)) {
    if (!platform || typeof platform !== "object") {
      fail(`latest.json platform ${platformKey} is not an object.`);
    }

    const currentUrl = typeof platform.url === "string" ? platform.url : "";
    const fileName = fileNameFromUrl(currentUrl);
    if (!fileName || !filesByName.has(fileName)) {
      fail(`latest.json platform ${platformKey} points to ${currentUrl}, but ${fileName || "that file"} was not downloaded.`);
    }

    platform.url = storageUrl(`releases/${tag}/${fileName}`);
  }

  latestCopy.version = latestCopy.version || tag;
  latestCopy.notes = latestCopy.notes || `Gilbert Codex ${tag}`;
  latestCopy.pub_date = latestCopy.pub_date || new Date().toISOString();

  return latestCopy;
}

async function createWebsiteManifest(files, latest) {
  const fileStats = await Promise.all(files.map(async (file) => {
    const name = path.basename(file);
    const info = await stat(file);
    return {
      name,
      size: info.size,
      url: storageUrl(`releases/${tag}/${name}`),
    };
  }));

  const assetsByName = new Map(fileStats.map((asset) => [asset.name, asset]));
  const downloadableAssets = fileStats
    .filter((asset) => !/\.sig$|\.sha256$|^latest\.json$/i.test(asset.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    tag,
    version,
    generatedAt: new Date().toISOString(),
    releaseNotesUrl: `https://gilbertcodex.com/releases/${tag}`,
    updateFeedUrl: storageUrl("releases/latest.json"),
    platforms: buildPlatformDownloads(downloadableAssets, assetsByName, latest),
    assets: downloadableAssets,
  };
}

function buildPlatformDownloads(downloadableAssets, assetsByName, latest) {
  const platformEntries = [
    {
      key: "windows",
      title: "Windows x64",
      cta: "Download for Windows",
      matcher: (name) => /setup\.exe$/i.test(name),
    },
    {
      key: "macos-apple-silicon",
      title: "macOS Apple Silicon",
      cta: "Download Apple Silicon",
      matcher: (name) => /macos-(?:aarch64|arm64)\.dmg$/i.test(name),
    },
    {
      key: "macos-intel",
      title: "macOS Intel",
      cta: "Download Intel Mac",
      matcher: (name) => /macos-x64\.dmg$/i.test(name),
    },
    {
      key: "linux-appimage",
      title: "Linux AppImage",
      cta: "Download AppImage",
      matcher: (name) => /\.AppImage$/i.test(name),
    },
    {
      key: "linux-deb",
      title: "Linux deb",
      cta: "Download deb",
      matcher: (name) => /\.deb$/i.test(name),
    },
  ];

  return platformEntries.map((entry) => {
    const asset = downloadableAssets.find((candidate) => entry.matcher(candidate.name));
    const updateBundle = findUpdateBundleForPlatform(entry.key, latest);
    const checksum = asset ? assetsByName.get(`${asset.name}.sha256`) : null;
    const signature = updateBundle ? assetsByName.get(`${updateBundle}.sig`) : null;

    return {
      key: entry.key,
      title: entry.title,
      cta: entry.cta,
      fileName: asset?.name ?? null,
      downloadUrl: asset?.url ?? null,
      size: asset?.size ?? null,
      checksumFile: checksum?.name ?? null,
      checksumUrl: checksum?.url ?? null,
      updaterBundleFile: updateBundle,
      signatureFile: signature?.name ?? null,
      signatureUrl: signature?.url ?? null,
    };
  });
}

function findUpdateBundleForPlatform(platformKey, latest) {
  const keysByPlatform = {
    windows: ["windows-x86_64"],
    "macos-apple-silicon": ["darwin-aarch64"],
    "macos-intel": ["darwin-x86_64"],
    "linux-appimage": ["linux-x86_64"],
    "linux-deb": ["linux-x86_64"],
  };

  for (const key of keysByPlatform[platformKey] ?? []) {
    const fileName = fileNameFromUrl(latest.platforms?.[key]?.url);
    if (fileName) {
      return fileName;
    }
  }

  return null;
}

function storageUrl(objectPath) {
  return `${storageBaseUrl}/${encodeURIComponent(objectPath)}?alt=media`;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name));
}

function fileNameFromUrl(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return path.basename(decodeURIComponent(new URL(value).pathname));
  } catch {
    return path.basename(value);
  }
}

function normalizeTag(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--assets-dir") {
      parsed.assetsDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--out-dir") {
      parsed.outDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--tag") {
      parsed.tag = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--bucket") {
      parsed.bucket = args[index + 1] ?? "";
      index += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
