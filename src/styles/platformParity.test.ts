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

  it("keeps macOS platform styling isolated to chrome and the macOS platform layer", () => {
    const platformSpecificFiles = Object.entries(styleFiles)
      .filter(([, text]) => text.includes('data-platform="macos"'))
      .map(([fileName]) => fileName)
      .sort();

    expect(platformSpecificFiles).toEqual(["chrome.css", "platform-macos.css"]);
  });

  it("keeps animation rules platform-neutral and reduce-motion global", () => {
    expect(readStyle("motion.css")).not.toContain("data-platform=");
    expect(readStyle("platform-macos.css")).toContain('data-platform="macos"');
    expect(readStyle("global.css")).toContain('@import "./platform-macos.css";');
    expect(readStyle("tokens.css")).toContain(':root[data-reduce-motion="on"] *');
    expect(readStyle("tokens.css")).toContain(':root[data-reduce-motion="system"] *');
  });

  it("keeps macOS Liquid Glass effects on navigation and control surfaces", () => {
    const macosStyle = readStyle("platform-macos.css");
    const backdropBlock = macosStyle.match(/@supports \(\(backdrop-filter:[\s\S]+?@media \(prefers-reduced-motion/)?.[0] ?? "";

    expect(macosStyle).toContain("--macos-content-shadow");
    expect(macosStyle).toContain("--macos-control-shadow-active");
    expect(macosStyle).toContain("--macos-scroll-edge-bg");
    expect(macosStyle).toContain(".desktop-root[data-runtime=\"desktop\"][data-platform=\"macos\"] .shell-sidebar");
    expect(macosStyle).toContain(".desktop-root[data-runtime=\"desktop\"][data-platform=\"macos\"] .composer-shell");
    expect(macosStyle).toContain(".chat-thread-shell[data-scroll-top=\"false\"]::before");
    expect(macosStyle).toContain(".chat-thread-shell[data-scroll-bottom=\"false\"]::after");
    expect(backdropBlock).not.toContain(".conversation-frame");
    expect(backdropBlock).not.toContain(".settings-page");
  });
});
