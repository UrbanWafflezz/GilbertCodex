import { describe, expect, it } from "vitest";
import { PathResolutionError, resolveAllowedPath, tryResolveAllowedPath } from "../paths";

describe("resolveAllowedPath", () => {
  it("rejects empty paths as invalid", () => {
    expect(() => resolveAllowedPath({ workspaceRoots: ["/home/u/project"] }, "")).toThrowError(PathResolutionError);
    try {
      resolveAllowedPath({ workspaceRoots: ["/home/u/project"] }, "   ");
    } catch (error) {
      expect((error as PathResolutionError).kind).toBe("invalid");
    }
  });

  it("rejects when no workspace roots are configured", () => {
    expect.assertions(2);
    try {
      resolveAllowedPath({ workspaceRoots: [] }, "/anywhere");
    } catch (error) {
      expect(error).toBeInstanceOf(PathResolutionError);
      expect((error as PathResolutionError).kind).toBe("no-workspace");
    }
  });

  it("resolves an absolute POSIX path inside its root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["/home/u/project"] },
      "/home/u/project/src/foo.ts",
    );
    expect(resolved.resolved).toBe("/home/u/project/src/foo.ts");
    expect(resolved.root).toBe("/home/u/project");
  });

  it("resolves an absolute Windows path inside its drive root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["C:\\Users\\Kobe\\project"] },
      "C:\\Users\\Kobe\\project\\src\\foo.ts",
    );
    expect(resolved.resolved).toBe("C:\\Users\\Kobe\\project\\src\\foo.ts");
    expect(resolved.root).toBe("C:\\Users\\Kobe\\project");
  });

  it("treats Windows drive-letter casing as equivalent", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["C:\\Users\\Kobe\\project"] },
      "c:\\Users\\Kobe\\project\\readme.md",
    );
    expect(resolved.root).toBe("C:\\Users\\Kobe\\project");
  });

  it("accepts sibling project paths when a full drive root is configured", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["C:\\Users\\Kobe\\project", "C:\\"] },
      "C:\\Users\\Kobe\\sibling\\public\\logo.png",
    );
    expect(resolved.root).toBe("C:\\");
    expect(resolved.resolved).toBe("C:\\Users\\Kobe\\sibling\\public\\logo.png");
  });

  it("resolves a relative path against the first workspace root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["/home/u/project", "/tmp/scratch"] },
      "src/index.ts",
    );
    expect(resolved.resolved).toBe("/home/u/project/src/index.ts");
    expect(resolved.root).toBe("/home/u/project");
  });

  it("collapses '.' and '..' segments that stay inside the root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["/home/u/project"] },
      "/home/u/project/src/./sub/../foo.ts",
    );
    expect(resolved.resolved).toBe("/home/u/project/src/foo.ts");
  });

  it("rejects '..' traversal that escapes the root", () => {
    expect.assertions(2);
    try {
      resolveAllowedPath({ workspaceRoots: ["/home/u/project"] }, "/home/u/project/../../etc/passwd");
    } catch (error) {
      expect(error).toBeInstanceOf(PathResolutionError);
      expect((error as PathResolutionError).kind).toBe("external-path");
    }
  });

  it("rejects an absolute path outside every configured root", () => {
    expect.assertions(2);
    try {
      resolveAllowedPath({ workspaceRoots: ["/home/u/project"] }, "/etc/shadow");
    } catch (error) {
      expect(error).toBeInstanceOf(PathResolutionError);
      expect((error as PathResolutionError).kind).toBe("external-path");
    }
  });

  it("accepts a path that exactly equals the root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["/home/u/project"] },
      "/home/u/project",
    );
    expect(resolved.resolved).toBe("/home/u/project");
  });

  it("ignores trailing slashes during the membership check", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["/home/u/project/"] },
      "/home/u/project/src/",
    );
    expect(resolved.root).toBe("/home/u/project/");
    expect(resolved.resolved).toBe("/home/u/project/src");
  });

  it("normalizes Windows paths with mixed separators", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["C:\\Users\\Kobe\\project"] },
      "C:\\Users\\Kobe\\project/src\\foo.ts",
    );
    expect(resolved.resolved).toBe("C:\\Users\\Kobe\\project\\src\\foo.ts");
  });

  it("accepts browser-folder paths inside the matching browser root", () => {
    const resolved = resolveAllowedPath(
      { workspaceRoots: ["browser-folder://Project"] },
      "browser-folder://Project/src/foo.ts",
    );
    expect(resolved.resolved).toBe("browser-folder://Project/src/foo.ts");
  });

  it("rejects browser-folder paths inside a different browser root", () => {
    expect.assertions(1);
    try {
      resolveAllowedPath(
        { workspaceRoots: ["browser-folder://ProjectA"] },
        "browser-folder://ProjectB/src/foo.ts",
      );
    } catch (error) {
      expect((error as PathResolutionError).kind).toBe("external-path");
    }
  });

  it("does not case-fold browser-folder URLs (segments are case-sensitive)", () => {
    expect.assertions(1);
    try {
      resolveAllowedPath(
        { workspaceRoots: ["browser-folder://ProjectA"] },
        "browser-folder://projecta/file.ts",
      );
    } catch (error) {
      expect((error as PathResolutionError).kind).toBe("external-path");
    }
  });

  it("rejects a near-prefix match like /root vs /root-extra", () => {
    expect.assertions(1);
    try {
      resolveAllowedPath({ workspaceRoots: ["/home/u/project"] }, "/home/u/project-other/file.ts");
    } catch (error) {
      expect((error as PathResolutionError).kind).toBe("external-path");
    }
  });
});

describe("tryResolveAllowedPath", () => {
  it("returns ok=true for valid inputs", () => {
    const result = tryResolveAllowedPath({ workspaceRoots: ["/r"] }, "/r/a.txt");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.resolved).toBe("/r/a.txt");
    }
  });

  it("returns ok=false with a typed PathResolutionError for invalid inputs", () => {
    const result = tryResolveAllowedPath({ workspaceRoots: [] }, "/r/a.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PathResolutionError);
      expect(result.error.kind).toBe("no-workspace");
    }
  });
});
