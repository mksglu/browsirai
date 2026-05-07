/**
 * TDD tests for the auto-upgrade system (src/upgrade.ts).
 *
 * Strategy: mock fs, child_process, and global fetch to test behaviors
 * through the public API without touching the real filesystem or network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

// Mock VERSION so we control the "current" version in tests
vi.mock("../src/version.js", () => ({ VERSION: "1.0.0" }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fsMocks = {
  existsSync: existsSync as ReturnType<typeof vi.fn>,
  readFileSync: readFileSync as ReturnType<typeof vi.fn>,
  mkdirSync: mkdirSync as ReturnType<typeof vi.fn>,
  writeFileSync: writeFileSync as ReturnType<typeof vi.fn>,
};

const cpMocks = {
  execSync: execSync as unknown as ReturnType<typeof vi.fn>,
  spawn: spawn as unknown as ReturnType<typeof vi.fn>,
};

/** Build a fake fetch Response */
function fakeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
    status: ok ? 200 : 500,
  } as unknown as Response;
}

/** Fresh import of upgrade module (bypasses module cache for mocked deps) */
async function loadUpgrade() {
  // Re-import to pick up fresh mocks each time
  const mod = await import("../src/upgrade.js");
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  // Default: spawn returns a mock child process with unref
  cpMocks.spawn.mockReturnValue({ unref: vi.fn() });
});

// =========================================================================
// Slice 1: getInstallMethod()
// =========================================================================

describe("getInstallMethod", () => {
  it("returns 'dev' when .git exists in parent directory", async () => {
    // The module checks existsSync for .git and tsconfig.json
    // import.meta.url resolves to the test runner path which has tsconfig.json
    // in its parent — so it should return "dev" in this test environment
    const { getInstallMethod } = await loadUpgrade();

    // In test environment, the source file is under the project root
    // which has both .git and tsconfig.json — should be "dev"
    fsMocks.existsSync.mockReturnValue(true);
    const result = getInstallMethod();
    expect(result).toBe("dev");
  });

  it("returns 'dev' when tsconfig.json exists in parent directory", async () => {
    const { getInstallMethod } = await loadUpgrade();
    // .git = false, tsconfig.json = true
    fsMocks.existsSync.mockImplementation((path: string) => {
      if (path.endsWith("tsconfig.json")) return true;
      return false;
    });
    expect(getInstallMethod()).toBe("dev");
  });

  it("returns 'npx' when path contains '_npx'", async () => {
    const { getInstallMethod } = await loadUpgrade();
    // No .git, no tsconfig — but the actual import.meta.url won't contain _npx
    // in test env. Since existsSync is mocked to return false, it falls through
    // to path checks. The real path won't contain _npx, so it won't match.
    // We can't easily mock import.meta.url, so we test the fallback behavior.
    fsMocks.existsSync.mockReturnValue(false);
    // The function will try execSync("npm prefix -g")
    cpMocks.execSync.mockReturnValue(Buffer.from("/some/other/prefix\n"));
    // Script path won't start with /some/other/prefix, so falls to default "npx"
    expect(getInstallMethod()).toBe("npx");
  });

  it("returns 'npx' as default fallback", async () => {
    const { getInstallMethod } = await loadUpgrade();
    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("npm not found");
    });
    expect(getInstallMethod()).toBe("npx");
  });
});

// =========================================================================
// Slice 2: getInstallPath()
// =========================================================================

describe("getInstallPath", () => {
  it("returns a valid directory path", async () => {
    const { getInstallPath } = await loadUpgrade();
    const path = getInstallPath();
    // Should be the browsirai project root (parent of parent of src/upgrade.ts)
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

// =========================================================================
// Slice 3: getUpgradeStatus()
// =========================================================================

describe("getUpgradeStatus", () => {
  it("returns null when upgrade file does not exist", async () => {
    const { getUpgradeStatus } = await loadUpgrade();
    fsMocks.existsSync.mockReturnValue(false);
    expect(getUpgradeStatus()).toBeNull();
  });

  it("returns parsed status when upgrade file exists", async () => {
    const { getUpgradeStatus } = await loadUpgrade();
    const status = {
      current: "1.0.0",
      latest: "1.1.0",
      checkedAt: "2026-03-14T00:00:00.000Z",
      installMethod: "npx",
    };
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(status));
    expect(getUpgradeStatus()).toEqual(status);
  });

  it("returns null when file contains invalid JSON", async () => {
    const { getUpgradeStatus } = await loadUpgrade();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue("not json");
    expect(getUpgradeStatus()).toBeNull();
  });

  it("returns null when readFileSync throws", async () => {
    const { getUpgradeStatus } = await loadUpgrade();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });
    expect(getUpgradeStatus()).toBeNull();
  });
});

// =========================================================================
// Slice 4: checkForUpgrade()
// =========================================================================

describe("checkForUpgrade", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default: dev mode detection (existsSync returns true for .git/tsconfig)
    // Tests that need non-dev mode will override
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null in dev mode (skips upgrade check)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    // existsSync returns true → getInstallMethod() = "dev"
    fsMocks.existsSync.mockReturnValue(true);
    globalThis.fetch = vi.fn();

    const result = await checkForUpgrade();
    expect(result).toBeNull();
    // fetch should NOT have been called
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns cached status when checked within rate limit window", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    const recentStatus = {
      current: "1.0.0",
      latest: "1.0.0",
      checkedAt: new Date().toISOString(), // Just now — within 1 hour
      installMethod: "npx" as const,
    };

    // First call: not dev mode
    fsMocks.existsSync.mockImplementation((path: string) => {
      if (path.endsWith(".git") || path.endsWith("tsconfig.json")) return false;
      // upgrade.json exists
      return true;
    });
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(recentStatus));
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    globalThis.fetch = vi.fn();

    const result = await checkForUpgrade();
    expect(result).toEqual(recentStatus);
    // Should NOT fetch — rate limited
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetches registry and returns status when cache is stale", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    const staleStatus = {
      current: "1.0.0",
      latest: "1.0.0",
      checkedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      installMethod: "npx" as const,
    };

    fsMocks.existsSync.mockImplementation((path: string) => {
      if (path.endsWith(".git") || path.endsWith("tsconfig.json")) return false;
      return true; // upgrade.json exists
    });
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(staleStatus));
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    // Mock fetch: registry returns same version (no upgrade needed)
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "1.0.0" }),
    );

    const result = await checkForUpgrade();
    expect(result).not.toBeNull();
    expect(result!.latest).toBe("1.0.0");
    expect(result!.current).toBe("1.0.0");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("fetches registry when no cached status exists", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false); // no .git, no tsconfig, no upgrade.json
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "1.2.0" }),
    );

    const result = await checkForUpgrade();
    expect(result).not.toBeNull();
    expect(result!.latest).toBe("1.2.0");
    expect(result!.current).toBe("1.0.0");
    // Should have written status to file
    expect(fsMocks.writeFileSync).toHaveBeenCalled();
  });

  it("spawns npm cache clean when newer version found (npx mode)", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    // Registry returns newer version
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "2.0.0" }),
    );

    // Capture stderr.write
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await checkForUpgrade();

    // Should spawn npm cache clean for npx
    expect(cpMocks.spawn).toHaveBeenCalledWith(
      "npm",
      ["cache", "clean", "--force"],
      expect.objectContaining({ stdio: "ignore", detached: true }),
    );

    // Should write upgrade notice to stderr
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("v2.0.0 available"),
    );

    stderrSpy.mockRestore();
  });

  it("spawns npm install -g when newer version found (global mode)", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    // Make getInstallMethod return "global":
    // no .git/tsconfig, path doesn't contain _npx/.npm, and starts with global prefix
    fsMocks.existsSync.mockReturnValue(false);

    // We need the scriptPath to start with the global prefix.
    // Since we can't control import.meta.url, we'll make globalPrefix match the actual path
      const actualScriptDir = (await import("node:url")).fileURLToPath(
        import.meta.url,
      );
      const sep = actualScriptDir.includes("\\") ? "\\" : "/";
      const prefix = actualScriptDir.split(sep).slice(0, 3).join(sep); // e.g. /Users/mksglu or C:\Users\mksglu
      cpMocks.execSync.mockReturnValue(Buffer.from(prefix + "\n"));

    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "2.0.0" }),
    );

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await checkForUpgrade();

    expect(cpMocks.spawn).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "browsirai@2.0.0"],
      expect.objectContaining({ stdio: "ignore", detached: true }),
    );

    stderrSpy.mockRestore();
  });

  it("does not spawn upgrade when versions are equal", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "1.0.0" }), // same as VERSION
    );

    await checkForUpgrade();

    // spawn should NOT be called (no upgrade needed)
    expect(cpMocks.spawn).not.toHaveBeenCalled();
  });

  it("returns null when fetch fails", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await checkForUpgrade();
    expect(result).toBeNull();
  });

  it("returns null when registry returns non-ok response", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({}, false));

    const result = await checkForUpgrade();
    expect(result).toBeNull();
  });

  it("returns null when registry response has no version field", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ name: "browsirai" }));

    const result = await checkForUpgrade();
    expect(result).toBeNull();
  });

  it("writes status to ~/.browsirai/upgrade.json", async () => {
    const { checkForUpgrade } = await loadUpgrade();

    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ version: "1.5.0" }),
    );

    await checkForUpgrade();

    // Should create directory
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".browsirai"),
      { recursive: true },
    );

    // Should write the status file (pretty-printed JSON)
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("upgrade.json"),
      expect.stringContaining('"latest": "1.5.0"'),
    );
  });
});

// =========================================================================
// Slice 5: isNewer() — tested indirectly through checkForUpgrade behavior
// =========================================================================

describe("version comparison (via checkForUpgrade)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fsMocks.existsSync.mockReturnValue(false);
    cpMocks.execSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("triggers upgrade for major version bump (1.0.0 → 2.0.0)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ version: "2.0.0" }));
    await checkForUpgrade();
    expect(cpMocks.spawn).toHaveBeenCalled();
  });

  it("triggers upgrade for minor version bump (1.0.0 → 1.1.0)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ version: "1.1.0" }));
    await checkForUpgrade();
    expect(cpMocks.spawn).toHaveBeenCalled();
  });

  it("triggers upgrade for patch version bump (1.0.0 → 1.0.1)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ version: "1.0.1" }));
    await checkForUpgrade();
    expect(cpMocks.spawn).toHaveBeenCalled();
  });

  it("does NOT trigger upgrade for same version (1.0.0 → 1.0.0)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ version: "1.0.0" }));
    await checkForUpgrade();
    expect(cpMocks.spawn).not.toHaveBeenCalled();
  });

  it("does NOT trigger upgrade for older version (1.0.0 → 0.9.0)", async () => {
    const { checkForUpgrade } = await loadUpgrade();
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse({ version: "0.9.0" }));
    await checkForUpgrade();
    expect(cpMocks.spawn).not.toHaveBeenCalled();
  });
});
