import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const candidates = [
  process.env.GCLOUD_BIN,
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd")
    : "",
  "gcloud",
].filter(Boolean);

const command = candidates.find((candidate) => candidate === "gcloud" || existsSync(candidate));
if (!command) {
  console.error("Could not find gcloud. Install Google Cloud SDK or set GCLOUD_BIN.");
  process.exit(1);
}

const result = process.platform === "win32"
  ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `call "${command}" ${args.map(quoteCmdArg).join(" ")}`], {
    stdio: "inherit",
    windowsVerbatimArguments: true,
  })
  : spawnSync(command, args, {
    stdio: "inherit",
  });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(value)) {
    return value;
  }

  return `"${String(value).replace(/"/g, "\\\"")}"`;
}
