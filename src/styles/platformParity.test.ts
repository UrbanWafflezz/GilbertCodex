import { describe, expect, it } from "vitest";

type TestFileSystem = {
  readFileSync: (path: URL, encoding: "utf8") => string;
  readdirSync: (path: URL) => string[];
};

const fs = (await import("node:fs")) as TestFileSystem;

const styleFiles = Object.fromEntries(
  fs
    .readdirSync(new URL(".", import.meta.url))
    .filter((fileName) => fileName.endsWith(".css"))
    .map((fileName) => [fileName, fs.readFileSync(new URL(fileName, import.meta.url), "utf8")]),
) as Record<string, string>;

function readStyle(fileName: string) {
  const text = styleFiles[fileName];

  if (text === undefined) {
    throw new Error(`Missing style fixture: ${fileName}`);
  }

  return text;
}

describe("platform CSS parity", () => {
  it("does not fork frontend styling for Linux or Windows", () => {
    const platformSpecificSelectors = Object.entries(styleFiles).flatMap(([fileName, text]) =>
      Array.from(text.matchAll(/data-platform=["'](linux|windows)["']/g)).map((match) => `${fileName}:${match[0]}`),
    );

    expect(platformSpecificSelectors).toEqual([]);
  });

  it("keeps macOS platform styling limited to desktop chrome spacing", () => {
    const platformSpecificFiles = Object.entries(styleFiles)
      .filter(([, text]) => text.includes('data-platform="macos"'))
      .map(([fileName]) => fileName);

    expect(platformSpecificFiles).toEqual(["chrome.css"]);
  });

  it("keeps animation rules platform-neutral and reduce-motion global", () => {
    expect(readStyle("motion.css")).not.toContain("data-platform=");
    expect(readStyle("tokens.css")).toContain(':root[data-reduce-motion="on"] *');
    expect(readStyle("tokens.css")).toContain(':root[data-reduce-motion="system"] *');
  });
});
