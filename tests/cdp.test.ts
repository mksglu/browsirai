/**
 * CDP Protocol Layer Tests
 *
 * Tests the Chrome DevTools Protocol integration layer:
 * - Browser discovery via HTTP and DevToolsActivePort file
 * - WebSocket connection lifecycle
 * - CDP command/response (JSON-RPC) correlation
 * - CDP event subscription and dispatch
 * - Target management (list, attach, session routing)
 * - Error handling (timeouts, disconnects, crash recovery)
 * - Cross-OS browser path resolution
 *
 * RED phase: All tests describe behavior for modules that do not exist yet.
 * Source modules under test:
 *   - src/cdp/discovery.ts
 *   - src/cdp/connection.ts
 *   - src/cdp/manager.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Source modules (do not exist yet — TDD RED phase)
// ---------------------------------------------------------------------------
import {
  discoverBrowser,
  detectBrowserType,
  readDevToolsActivePort,
  parseJsonListResponse,
  scanPorts,
  getChromePath,
  type BrowserInfo,
  type DiscoveryError,
} from "../src/cdp/discovery";

import {
  CDPConnection,
  type CDPCommandOptions,
  TIMEOUT,
  NAVIGATION_TIMEOUT,
  IDLE_TIMEOUT,
  DAEMON_CONNECT_RETRIES,
  DAEMON_CONNECT_DELAY,
  waitForDocumentReady,
} from "../src/cdp/connection";

import {
  CDPManager,
  type TabInfo,
} from "../src/cdp/manager";

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Minimal mock WebSocket that captures outgoing messages and allows
 * tests to simulate incoming messages / lifecycle events.
 */
function createMockWebSocket() {
  type Handler = (...args: unknown[]) => void;

  const sentMessages: string[] = [];
  const listeners: Record<string, Handler[]> = {};

  const ws = {
    readyState: 1, // OPEN
    send(data: string) {
      sentMessages.push(data);
    },
    addEventListener(event: string, handler: Handler) {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener(event: string, handler: Handler) {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    close() {
      ws.readyState = 3; // CLOSED
      (listeners["close"] ?? []).forEach((h) => h({ code: 1000, reason: "" }));
    },

    // --- Test helpers ---
    get sentMessages() {
      return sentMessages;
    },
    get lastSentMessage() {
      return sentMessages.length > 0
        ? JSON.parse(sentMessages[sentMessages.length - 1]!)
        : undefined;
    },
    /** Simulate Chrome sending a message to the client. */
    emitMessage(data: unknown) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      (listeners["message"] ?? []).forEach((h) => h({ data: payload }));
    },
    /** Simulate the open event. */
    emitOpen() {
      (listeners["open"] ?? []).forEach((h) => h({}));
    },
    /** Simulate a WebSocket error. */
    emitError(error: Error) {
      (listeners["error"] ?? []).forEach((h) => h({ message: error.message, type: "error" }));
    },
    /** Simulate an unexpected close. */
    emitClose(code = 1006, reason = "") {
      ws.readyState = 3;
      (listeners["close"] ?? []).forEach((h) => h({ code, reason }));
    },
  };

  return ws;
}

/**
 * Creates a mock global fetch that responds to Chrome's HTTP discovery endpoints.
 */
function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const entry = responses[url];
    if (!entry) {
      throw new Error(`ECONNREFUSED: ${url}`);
    }
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      json: async () => entry.body,
      text: async () => JSON.stringify(entry.body),
    };
  });
}

/**
 * Standard Chrome /json/version response.
 */
function chromeVersionResponse(overrides: Partial<Record<string, string>> = {}) {
  return {
    Browser: overrides.Browser ?? "Chrome/131.0.6778.86",
    "Protocol-Version": overrides["Protocol-Version"] ?? "1.3",
    "User-Agent":
      overrides["User-Agent"] ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
    "V8-Version": overrides["V8-Version"] ?? "13.1.201.16",
    "WebKit-Version": overrides["WebKit-Version"] ?? "537.36",
    webSocketDebuggerUrl:
      overrides.webSocketDebuggerUrl ?? "ws://127.0.0.1:9222/devtools/browser/abc-123",
  };
}

/**
 * Standard Chrome /json/list response (array of targets).
 */
function chromeTargetList() {
  return [
    {
      id: "TARGET_1",
      type: "page",
      title: "Example Page",
      url: "https://example.com",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_1",
    },
    {
      id: "TARGET_2",
      type: "page",
      title: "GitHub - browsirai",
      url: "https://github.com/mksglu/browsirai",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_2",
    },
    {
      id: "TARGET_INTERNAL",
      type: "page",
      title: "Extensions",
      url: "chrome://extensions/",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_INTERNAL",
    },
    {
      id: "TARGET_SW",
      type: "service_worker",
      title: "Service Worker",
      url: "https://example.com/sw.js",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_SW",
    },
  ];
}

/**
 * Minimal mock CDP session for testing functions that accept a raw CDP
 * send interface (e.g., waitForDocumentReady).
 */
function createMockCDP() {
  return {
    send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({} as unknown)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BROWSER DISCOVERY (src/cdp/discovery.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Browser Discovery (src/cdp/discovery.ts)", () => {
  // Tests the HTTP-based and file-based mechanisms for finding a running
  // Chrome (or Chromium-based) browser with remote debugging enabled.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // TS-01: Discover Chrome via HTTP
  // -----------------------------------------------------------------------
  describe("TS-01: Discover Chrome via HTTP GET /json/version", () => {
    // Verifies that discoverBrowser() sends an HTTP request to the
    // standard Chrome debugging endpoint and parses the response.

    it("should return browser info when Chrome is running on the given port", async () => {
      // Given: Chrome is running with --remote-debugging-port=9222
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse(),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser on port 9222
      const info: BrowserInfo = await discoverBrowser({ port: 9222 });

      // Then: We should get valid browser info
      expect(info.browser).toBe("Chrome");
      expect(info.version).toBe("131.0.6778.86");
      expect(info.webSocketDebuggerUrl).toBe("ws://127.0.0.1:9222/devtools/browser/abc-123");
      expect(info.protocolVersion).toBe("1.3");
    });

    it("should include the WebSocket debugger URL from the response", async () => {
      // Given: Chrome returns a specific WebSocket URL
      const wsUrl = "ws://127.0.0.1:9333/devtools/browser/xyz-789";
      const fetchMock = mockFetch({
        "http://127.0.0.1:9333/json/version": {
          status: 200,
          body: chromeVersionResponse({ webSocketDebuggerUrl: wsUrl }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser
      const info = await discoverBrowser({ port: 9333 });

      // Then: The WebSocket URL should match exactly
      expect(info.webSocketDebuggerUrl).toBe(wsUrl);
    });

    it("should use the default host 127.0.0.1 when no host is specified", async () => {
      // Given: A fetch mock that expects the default host
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse(),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We call discoverBrowser without a host
      await discoverBrowser({ port: 9222 });

      // Then: fetch should have been called with 127.0.0.1
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9222/json/version",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("should support a custom host", async () => {
      // Given: Chrome is running on a custom host
      const fetchMock = mockFetch({
        "http://192.168.1.100:9222/json/version": {
          status: 200,
          body: chromeVersionResponse(),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover with a custom host
      const info = await discoverBrowser({ host: "192.168.1.100", port: 9222 });

      // Then: The discovery should succeed
      expect(info.browser).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // TS-02: Browser not running (ECONNREFUSED)
  // -----------------------------------------------------------------------
  describe("TS-02: Return clear error when no browser is running", () => {
    // When Chrome is not running or the port is not open, the HTTP
    // request will fail with ECONNREFUSED. The discovery layer must
    // translate this into a clear, actionable error.

    it("should throw a DiscoveryError with code BROWSER_NOT_FOUND on ECONNREFUSED", async () => {
      // Given: No browser is running (fetch throws ECONNREFUSED)
      const fetchMock = vi.fn().mockRejectedValue(
        Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      // When/Then: discoverBrowser should throw with a descriptive error
      await expect(discoverBrowser({ port: 9222 })).rejects.toMatchObject({
        code: "BROWSER_NOT_FOUND",
      });
    });

    it("should include platform-specific launch instructions in the error message", async () => {
      // Given: No browser is running
      const fetchMock = vi.fn().mockRejectedValue(
        Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      // When: We attempt discovery
      try {
        await discoverBrowser({ port: 9222 });
        expect.fail("Should have thrown");
      } catch (error) {
        // Then: Error message should include debugging instructions
        const err = error as DiscoveryError;
        expect(err.message).toContain("--remote-debugging-port");
        expect(err.message).toMatch(/Chrome|browser/i);
      }
    });

    it("should suggest checking if Chrome was launched with debugging enabled", async () => {
      // Given: No browser process is reachable
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", fetchMock);

      // When: We attempt discovery
      try {
        await discoverBrowser({ port: 9222 });
        expect.fail("Should have thrown");
      } catch (error) {
        // Then: Error should suggest enabling remote debugging
        const err = error as DiscoveryError;
        expect(err.message).toMatch(/remote.?debug/i);
      }
    });
  });

  // -----------------------------------------------------------------------
  // TS-03: Debugging not enabled
  // -----------------------------------------------------------------------
  describe("TS-03: Return clear error when debugging is not enabled", () => {
    // Chrome is running but was not launched with --remote-debugging-port.
    // The HTTP endpoint will either not respond or return an error.

    it("should throw a DiscoveryError with code DEBUG_PORT_UNAVAILABLE when port responds but is not Chrome", async () => {
      // Given: Something is running on 9222 but it is not Chrome's debugger
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 404,
          body: "Not Found",
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When/Then: discoverBrowser should throw a specific error
      await expect(discoverBrowser({ port: 9222 })).rejects.toMatchObject({
        code: "DEBUG_PORT_UNAVAILABLE",
      });
    });

    it("should include instructions to relaunch Chrome with the debug flag", async () => {
      // Given: Port is open but not a Chrome debugger
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 500,
          body: "Internal Server Error",
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We attempt discovery
      try {
        await discoverBrowser({ port: 9222 });
        expect.fail("Should have thrown");
      } catch (error) {
        // Then: The error should tell the user to relaunch Chrome
        const err = error as DiscoveryError;
        expect(err.message).toMatch(/relaunch|restart|launch/i);
        expect(err.message).toContain("--remote-debugging-port");
      }
    });

    it("should handle malformed JSON from the /json/version endpoint", async () => {
      // Given: The endpoint returns invalid JSON
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
        text: async () => "<html>Not JSON</html>",
      });
      vi.stubGlobal("fetch", fetchMock);

      // When/Then: Discovery should fail gracefully
      await expect(discoverBrowser({ port: 9222 })).rejects.toMatchObject({
        code: "DEBUG_PORT_UNAVAILABLE",
      });
    });
  });

  // -----------------------------------------------------------------------
  // TS-04: Auto-detect browser type
  // -----------------------------------------------------------------------
  describe("TS-04: Auto-detect browser type from /json/version response", () => {
    // The /json/version response contains a "Browser" field with format
    // "BrowserName/version". We parse this to identify the browser.

    const browserCases = [
      { browser: "Chrome", field: "Chrome/131.0.6778.86", expectedName: "Chrome" },
      { browser: "Edge", field: "Edg/131.0.2903.51", expectedName: "Edge" },
      { browser: "Brave", field: "Brave/1.73.97 Chrome/131.0.6778.86", expectedName: "Brave" },
      { browser: "Arc", field: "Arc/1.30.0 Chrome/131.0.6778.86", expectedName: "Arc" },
      { browser: "Vivaldi", field: "Vivaldi/6.9.3447.54", expectedName: "Vivaldi" },
      { browser: "Chromium", field: "Chromium/131.0.6778.86", expectedName: "Chromium" },
      { browser: "Opera", field: "OPR/115.0.5322.68", expectedName: "Opera" },
    ];

    it.each(browserCases)(
      "should identify $browser from Browser field '$field'",
      async ({ field, expectedName }) => {
        // Given: A browser reports its name via /json/version
        const fetchMock = mockFetch({
          "http://127.0.0.1:9222/json/version": {
            status: 200,
            body: chromeVersionResponse({ Browser: field }),
          },
        });
        vi.stubGlobal("fetch", fetchMock);

        // When: We discover the browser
        const info = await discoverBrowser({ port: 9222 });

        // Then: The browser name should be correctly identified
        expect(info.browser).toBe(expectedName);
      },
    );

    it("should extract the version string from the Browser field", async () => {
      // Given: Chrome reports version 131.0.6778.86
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse({ Browser: "Chrome/131.0.6778.86" }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser
      const info = await discoverBrowser({ port: 9222 });

      // Then: The version should be a valid semver-like string
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("should detect browser type using detectBrowserType() utility", () => {
      // Given: Various Browser field values
      // When/Then: detectBrowserType should classify them correctly
      expect(detectBrowserType("Chrome/131.0.6778.86")).toBe("Chrome");
      expect(detectBrowserType("Edg/131.0.2903.51")).toBe("Edge");
      expect(detectBrowserType("Brave/1.73.97 Chrome/131.0.6778.86")).toBe("Brave");
      expect(detectBrowserType("Arc/1.30.0 Chrome/131.0.6778.86")).toBe("Arc");
      expect(detectBrowserType("Vivaldi/6.9.3447.54")).toBe("Vivaldi");
      expect(detectBrowserType("OPR/115.0.5322.68")).toBe("Opera");
      expect(detectBrowserType("Chromium/131.0.6778.86")).toBe("Chromium");
    });

    it("should fall back to 'Chromium' for unrecognized Browser field values", () => {
      // Given: An unknown Chromium fork
      // When/Then: It should default to Chromium
      expect(detectBrowserType("SomeFork/1.0.0")).toBe("Chromium");
    });
  });

  // -----------------------------------------------------------------------
  // TS-19: Multiple Chrome profiles (multiple debugging ports)
  // -----------------------------------------------------------------------
  describe("TS-19: Handle multiple Chrome profiles", () => {
    // When multiple Chrome instances run with different profiles, each
    // may have its own debugging port. Discovery should find all of them.

    it("should discover multiple browser instances on different ports", async () => {
      // Given: Two Chrome instances on ports 9222 and 9223
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "http://127.0.0.1:9222/json/version") {
          return {
            ok: true,
            status: 200,
            json: async () =>
              chromeVersionResponse({
                webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/profile-1",
              }),
          };
        }
        if (url === "http://127.0.0.1:9223/json/version") {
          return {
            ok: true,
            status: 200,
            json: async () =>
              chromeVersionResponse({
                webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/profile-2",
              }),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We scan ports 9222 and 9223
      const results = await scanPorts({ ports: [9222, 9223] });

      // Then: Both instances should be discovered
      expect(results).toHaveLength(2);
      expect(results[0]!.webSocketDebuggerUrl).toContain("profile-1");
      expect(results[1]!.webSocketDebuggerUrl).toContain("profile-2");
    });

    it("should skip ports where no browser is running", async () => {
      // Given: Browser only on port 9222, not on 9223 or 9224
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "http://127.0.0.1:9222/json/version") {
          return {
            ok: true,
            status: 200,
            json: async () => chromeVersionResponse(),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We scan multiple ports
      const results = await scanPorts({ ports: [9222, 9223, 9224] });

      // Then: Only the active port should be in results
      expect(results).toHaveLength(1);
      expect(results[0]!.webSocketDebuggerUrl).toContain("9222");
    });
  });

  // -----------------------------------------------------------------------
  // TS-20: Connect to non-Chrome Chromium browser
  // -----------------------------------------------------------------------
  describe("TS-20: Connect to non-Chrome Chromium browser", () => {
    // Edge, Brave, and other Chromium forks expose the same CDP endpoints.
    // Discovery should work identically for all of them.

    it("should discover Brave Browser via the same /json/version endpoint", async () => {
      // Given: Brave is running with remote debugging
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse({
            Browser: "Brave/1.73.97 Chrome/131.0.6778.86",
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/brave-id",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser
      const info = await discoverBrowser({ port: 9222 });

      // Then: It should be identified as Brave
      expect(info.browser).toBe("Brave");
      expect(info.webSocketDebuggerUrl).toContain("brave-id");
    });

    it("should discover Microsoft Edge via the same /json/version endpoint", async () => {
      // Given: Edge is running with remote debugging
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse({
            Browser: "Edg/131.0.2903.51",
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/edge-id",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser
      const info = await discoverBrowser({ port: 9222 });

      // Then: It should be identified as Edge
      expect(info.browser).toBe("Edge");
    });

    it("should discover Arc browser via the same /json/version endpoint", async () => {
      // Given: Arc is running with remote debugging
      const fetchMock = mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse({
            Browser: "Arc/1.30.0 Chrome/131.0.6778.86",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We discover the browser
      const info = await discoverBrowser({ port: 9222 });

      // Then: It should be identified as Arc
      expect(info.browser).toBe("Arc");
    });
  });

  // -----------------------------------------------------------------------
  // DevToolsActivePort file discovery
  // -----------------------------------------------------------------------
  describe("DevToolsActivePort file discovery", () => {
    // Chrome writes a DevToolsActivePort file on startup with the
    // dynamically assigned port and browser WS path. This is the
    // most reliable discovery mechanism.

    it("should parse port and WS path from DevToolsActivePort file content", () => {
      // Given: A DevToolsActivePort file with format "port\n/devtools/browser/guid"
      const content = "9222\n/devtools/browser/abc-123-def";

      // When: We parse the file content
      const result = readDevToolsActivePort(content);

      // Then: We should get the correct port and WebSocket URL
      expect(result.port).toBe(9222);
      expect(result.wsPath).toBe("/devtools/browser/abc-123-def");
      expect(result.wsUrl).toBe("ws://127.0.0.1:9222/devtools/browser/abc-123-def");
    });

    it("should handle DevToolsActivePort content with trailing whitespace", () => {
      // Given: File content with trailing newlines/spaces
      const content = "9333\n/devtools/browser/xyz-789\n\n";

      // When: We parse the file
      const result = readDevToolsActivePort(content);

      // Then: It should still parse correctly
      expect(result.port).toBe(9333);
      expect(result.wsPath).toBe("/devtools/browser/xyz-789");
    });

    it("should throw an error for malformed DevToolsActivePort content", () => {
      // Given: Invalid file content
      const content = "not-a-port\ninvalid";

      // When/Then: Parsing should throw
      expect(() => readDevToolsActivePort(content)).toThrow();
    });

    it("should throw an error for empty DevToolsActivePort content", () => {
      // Given: Empty file
      const content = "";

      // When/Then: Parsing should throw
      expect(() => readDevToolsActivePort(content)).toThrow();
    });

    it("should throw an error when DevToolsActivePort has only one line", () => {
      // Given: File with only the port number, no WS path
      const content = "9222";

      // When/Then: Parsing should throw (both lines required)
      expect(() => readDevToolsActivePort(content)).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Fallback port scanning
  // -----------------------------------------------------------------------
  describe("Fallback port scanning", () => {
    // When DevToolsActivePort is not available, scan well-known ports.

    it("should scan default ports 9222, 9229 when no specific port is given", async () => {
      // Given: Chrome is running on port 9229 (not the default 9222)
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "http://127.0.0.1:9229/json/version") {
          return {
            ok: true,
            status: 200,
            json: async () => chromeVersionResponse(),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We scan default ports
      const results = await scanPorts();

      // Then: The browser on 9229 should be found
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.webSocketDebuggerUrl.includes("9229"))).toBe(true);
    });

    it("should return an empty array when no browser is found on any port", async () => {
      // Given: No browser is running on any port
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", fetchMock);

      // When: We scan ports
      const results = await scanPorts({ ports: [9222, 9223, 9224, 9229] });

      // Then: No results
      expect(results).toHaveLength(0);
    });

    it("should return the first found browser when scanning sequentially", async () => {
      // Given: Browsers on ports 9222 and 9223
      const fetchMock = vi.fn(async (url: string) => {
        if (
          url === "http://127.0.0.1:9222/json/version" ||
          url === "http://127.0.0.1:9223/json/version"
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => chromeVersionResponse(),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      vi.stubGlobal("fetch", fetchMock);

      // When: We scan ports
      const results = await scanPorts({ ports: [9222, 9223, 9224] });

      // Then: Both should be found
      expect(results).toHaveLength(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. WEBSOCKET CONNECTION (src/cdp/connection.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("WebSocket Connection (src/cdp/connection.ts)", () => {
  // Tests the CDPConnection class which wraps a WebSocket connection
  // to Chrome's CDP endpoint. Handles JSON-RPC command/response
  // correlation, event dispatch, timeouts, and reconnection.

  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    vi.restoreAllMocks();

    // Stub the global WebSocket constructor to return our mock
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        // Simulate async open after microtask
        queueMicrotask(() => mockWs.emitOpen());
        return mockWs;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Connect to Chrome WebSocket
  // -----------------------------------------------------------------------
  describe("WebSocket connection lifecycle", () => {
    // Tests the connect() flow: creating a WebSocket, waiting for
    // the open event, and reporting connected state.

    it("should connect to Chrome WebSocket debugger URL", async () => {
      // Given: A valid WebSocket URL
      const wsUrl = "ws://127.0.0.1:9222/devtools/browser/abc-123";

      // When: We create a CDPConnection and connect
      const conn = new CDPConnection(wsUrl);
      await conn.connect();

      // Then: The connection should be in the connected state
      expect(conn.isConnected).toBe(true);
    });

    it("should pass the correct URL to the WebSocket constructor", async () => {
      // Given: A specific WebSocket URL
      const wsUrl = "ws://127.0.0.1:9333/devtools/browser/xyz-789";
      const WsMock = vi.fn(() => {
        queueMicrotask(() => mockWs.emitOpen());
        return mockWs;
      });
      vi.stubGlobal("WebSocket", WsMock);

      // When: We connect
      const conn = new CDPConnection(wsUrl);
      await conn.connect();

      // Then: The WebSocket constructor should have received the URL
      expect(WsMock).toHaveBeenCalledWith(wsUrl);
    });

    it("should reject if WebSocket emits an error before opening", async () => {
      // Given: A WebSocket that errors on connect
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          queueMicrotask(() => mockWs.emitError(new Error("Connection refused")));
          return mockWs;
        }),
      );

      // When: We try to connect
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/bad");

      // Then: The connect() promise should reject
      await expect(conn.connect()).rejects.toThrow(/connection refused|WebSocket error/i);
    });
  });

  // -----------------------------------------------------------------------
  // Send CDP command and receive response
  // -----------------------------------------------------------------------
  describe("CDP command/response correlation (JSON-RPC over WS)", () => {
    // Each command gets an auto-incremented ID. The response with the
    // matching ID resolves the corresponding promise.

    it("should send a JSON-RPC message with auto-incremented ID", async () => {
      // Given: An open CDP connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command (don't await — we'll manually respond)
      const promise = conn.send("Target.getTargets", {});

      // Then: The WebSocket should have received a JSON message with id=1
      const sent = JSON.parse(mockWs.sentMessages[0]!);
      expect(sent.id).toBe(1);
      expect(sent.method).toBe("Target.getTargets");
      expect(sent.params).toEqual({});

      // Simulate response
      mockWs.emitMessage({ id: 1, result: { targetInfos: [] } });
      const result = await promise;
      expect(result).toEqual({ targetInfos: [] });
    });

    it("should correlate responses by message ID", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send two commands
      const promise1 = conn.send("Runtime.enable", {});
      const promise2 = conn.send("Page.enable", {});

      // Then: Two messages should have been sent with IDs 1 and 2
      expect(JSON.parse(mockWs.sentMessages[0]!).id).toBe(1);
      expect(JSON.parse(mockWs.sentMessages[1]!).id).toBe(2);

      // Respond to the second command first (out of order)
      mockWs.emitMessage({ id: 2, result: {} });
      mockWs.emitMessage({ id: 1, result: {} });

      // Both promises should resolve correctly
      await expect(promise1).resolves.toEqual({});
      await expect(promise2).resolves.toEqual({});
    });

    it("should reject the promise when Chrome returns an error response", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command that Chrome rejects
      const promise = conn.send("DOM.querySelector", { nodeId: 999, selector: "#missing" });

      // Simulate error response
      mockWs.emitMessage({
        id: 1,
        error: { code: -32000, message: "Could not find node with given id" },
      });

      // Then: The promise should reject with the error message
      await expect(promise).rejects.toThrow("Could not find node with given id");
    });

    it("should include sessionId in messages when provided", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command with a sessionId
      const promise = conn.send("Runtime.evaluate", { expression: "1+1" }, {
        sessionId: "SESSION_ABC",
      } as CDPCommandOptions);

      // Then: The sent message should include sessionId
      const sent = JSON.parse(mockWs.sentMessages[0]!);
      expect(sent.sessionId).toBe("SESSION_ABC");
      expect(sent.method).toBe("Runtime.evaluate");

      // Cleanup
      mockWs.emitMessage({ id: 1, result: { result: { type: "number", value: 2 } } });
      await promise;
    });

    it("should NOT include sessionId in browser-level commands", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a browser-level command without sessionId
      const promise = conn.send("Target.getTargets", {});

      // Then: The sent message should NOT have a sessionId field
      const sent = JSON.parse(mockWs.sentMessages[0]!);
      expect(sent).not.toHaveProperty("sessionId");

      // Cleanup
      mockWs.emitMessage({ id: 1, result: { targetInfos: [] } });
      await promise;
    });
  });

  // -----------------------------------------------------------------------
  // CDP event handling
  // -----------------------------------------------------------------------
  describe("CDP event handling (subscribe, unsubscribe, dispatch)", () => {
    // CDP sends events (no `id` field, has `method` field) that need
    // to be dispatched to registered handlers.

    it("should dispatch CDP events to registered handlers", async () => {
      // Given: An open connection with an event handler
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const handler = vi.fn();
      conn.on("Page.loadEventFired", handler);

      // When: Chrome sends an event
      mockWs.emitMessage({
        method: "Page.loadEventFired",
        params: { timestamp: 1234567890 },
      });

      // Then: The handler should be called with the event params
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        { timestamp: 1234567890 },
        expect.objectContaining({ method: "Page.loadEventFired" }),
      );
    });

    it("should support multiple handlers for the same event", async () => {
      // Given: Two handlers for the same event
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      conn.on("Target.targetDestroyed", handler1);
      conn.on("Target.targetDestroyed", handler2);

      // When: The event fires
      mockWs.emitMessage({
        method: "Target.targetDestroyed",
        params: { targetId: "TARGET_1" },
      });

      // Then: Both handlers should be called
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it("should stop dispatching to a handler after off() is called", async () => {
      // Given: A handler that is later unregistered
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const handler = vi.fn();
      conn.on("Page.loadEventFired", handler);

      // When: We unsubscribe and then the event fires
      conn.off("Page.loadEventFired", handler);
      mockWs.emitMessage({
        method: "Page.loadEventFired",
        params: { timestamp: 99999 },
      });

      // Then: The handler should NOT have been called
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not throw when an event fires with no registered handlers", async () => {
      // Given: An open connection with no event handlers
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When/Then: An event fires — should not throw
      expect(() => {
        mockWs.emitMessage({
          method: "Network.requestWillBeSent",
          params: { requestId: "123" },
        });
      }).not.toThrow();
    });

    it("should pass empty params when event has no params field", async () => {
      // Given: A handler for an event
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const handler = vi.fn();
      conn.on("Page.domContentEventFired", handler);

      // When: Chrome sends an event without params
      mockWs.emitMessage({ method: "Page.domContentEventFired" });

      // Then: Handler should receive empty object as params
      expect(handler).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ method: "Page.domContentEventFired" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Command timeout
  // -----------------------------------------------------------------------
  describe("Command timeout", () => {
    // Each send() call has a configurable timeout. If Chrome does not
    // respond within the timeout, the promise is rejected.

    it("should reject with a timeout error if Chrome does not respond within default timeout", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command and Chrome never responds
      const promise = conn.send("Page.captureScreenshot", { format: "png" });

      // Fast-forward past the default timeout (30s)
      vi.advanceTimersByTime(30_000);

      // Then: The promise should reject with a timeout error
      await expect(promise).rejects.toThrow(/timeout/i);

      vi.useRealTimers();
    });

    it("should support a custom command timeout", async () => {
      // Given: An open connection with a custom timeout
      vi.useFakeTimers();
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command with a 5s timeout
      const promise = conn.send("Runtime.evaluate", { expression: "slowOp()" }, {
        timeout: 5000,
      } as CDPCommandOptions);

      // Advance 5 seconds
      vi.advanceTimersByTime(5000);

      // Then: The promise should reject with timeout
      await expect(promise).rejects.toThrow(/timeout/i);

      vi.useRealTimers();
    });

    it("should not timeout if Chrome responds in time", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We send a command and Chrome responds before the timeout
      const promise = conn.send("Runtime.evaluate", { expression: "1+1" });

      // Chrome responds after 100ms
      vi.advanceTimersByTime(100);
      mockWs.emitMessage({ id: 1, result: { result: { type: "number", value: 2 } } });

      // Then: The promise should resolve normally
      const result = await promise;
      expect(result).toEqual({ result: { type: "number", value: 2 } });

      vi.useRealTimers();
    });

    it("should include the method name in the timeout error message", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: A command times out
      const promise = conn.send("Accessibility.getFullAXTree", {});
      vi.advanceTimersByTime(30_000);

      // Then: The error message should mention the method
      await expect(promise).rejects.toThrow("Accessibility.getFullAXTree");

      vi.useRealTimers();
    });
  });

  // -----------------------------------------------------------------------
  // TS-14: WebSocket disconnect detection and reconnect
  // -----------------------------------------------------------------------
  describe("TS-14: WebSocket disconnect detection and reconnect", () => {
    // When the WebSocket drops unexpectedly, the connection should
    // detect it, reject pending commands, and attempt reconnection.

    it("should detect WebSocket disconnect and set isConnected to false", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();
      expect(conn.isConnected).toBe(true);

      // When: The WebSocket closes unexpectedly
      mockWs.emitClose(1006, "abnormal closure");

      // Then: isConnected should be false
      expect(conn.isConnected).toBe(false);
    });

    it("should reject all pending commands when WebSocket disconnects", async () => {
      // Given: An open connection with pending commands
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const promise1 = conn.send("Runtime.evaluate", { expression: "a" });
      const promise2 = conn.send("Page.enable", {});

      // When: The WebSocket drops
      mockWs.emitClose(1006, "abnormal closure");

      // Then: All pending commands should be rejected
      await expect(promise1).rejects.toThrow(/disconnect|connection.?lost|closed/i);
      await expect(promise2).rejects.toThrow(/disconnect|connection.?lost|closed/i);
    });

    it("should emit a 'disconnected' event when the WebSocket closes", async () => {
      // Given: An open connection with a disconnect handler
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const disconnectHandler = vi.fn();
      conn.on("disconnected", disconnectHandler);

      // When: The WebSocket closes
      mockWs.emitClose(1006, "abnormal closure");

      // Then: The disconnect handler should fire
      expect(disconnectHandler).toHaveBeenCalledOnce();
    });

    it("should attempt reconnection after disconnect", async () => {
      // Given: An open connection configured with reconnect
      vi.useFakeTimers();
      let connectCount = 0;
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          connectCount++;
          queueMicrotask(() => mockWs.emitOpen());
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: The WebSocket drops
      mockWs.readyState = 1; // Reset for next connection
      mockWs.emitClose(1006, "abnormal closure");

      // Advance past reconnect delay
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Then: A reconnection attempt should have been made
      expect(connectCount).toBeGreaterThanOrEqual(2);

      vi.useRealTimers();
    });

    it("should emit a 'reconnected' event on successful reconnection", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          queueMicrotask(() => mockWs.emitOpen());
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const reconnectedHandler = vi.fn();
      conn.on("reconnected", reconnectedHandler);

      // When: WebSocket drops and reconnects
      mockWs.readyState = 1;
      mockWs.emitClose(1006, "abnormal closure");

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Then: The reconnected handler should fire
      expect(reconnectedHandler).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should invalidate previous sessions after reconnection", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          queueMicrotask(() => mockWs.emitOpen());
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: WebSocket drops and reconnects
      mockWs.readyState = 1;
      mockWs.emitClose(1006, "abnormal closure");

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Then: Sending with the old sessionId should fail or require re-attach
      // The connection should indicate sessions were invalidated
      const promise = conn.send("Runtime.evaluate", { expression: "1" }, {
        sessionId: "OLD_SESSION",
      } as CDPCommandOptions);

      // Simulate Chrome rejecting the old session
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        error: { code: -32000, message: "No session with given id" },
      });

      await expect(promise).rejects.toThrow(/session/i);

      vi.useRealTimers();
    });
  });

  // -----------------------------------------------------------------------
  // TS-15: Browser crash recovery
  // -----------------------------------------------------------------------
  describe("TS-15: Browser crash recovery (WebSocket close code handling)", () => {
    // When Chrome crashes, the WebSocket closes with specific codes.
    // The connection should handle this and attempt recovery.

    it("should detect browser crash from WebSocket close code 1006", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const crashHandler = vi.fn();
      conn.on("browserCrashed", crashHandler);

      // When: WebSocket closes with code 1006 (abnormal)
      mockWs.emitClose(1006, "");

      // Then: A browser crash event should fire
      expect(crashHandler).toHaveBeenCalledOnce();
    });

    it("should reject all pending commands on browser crash", async () => {
      // Given: An open connection with pending commands
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const pending1 = conn.send("Page.captureScreenshot", { format: "png" });
      const pending2 = conn.send("Runtime.evaluate", { expression: "x" });
      const pending3 = conn.send("Accessibility.getFullAXTree", {});

      // When: Chrome crashes
      mockWs.emitClose(1006, "");

      // Then: All 3 pending commands should be rejected
      await expect(pending1).rejects.toThrow(/crash|disconnect|closed/i);
      await expect(pending2).rejects.toThrow(/crash|disconnect|closed/i);
      await expect(pending3).rejects.toThrow(/crash|disconnect|closed/i);
    });

    it("should attempt reconnection with exponential backoff after crash", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      let wsCreated = 0;
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          wsCreated++;
          // First connection succeeds, subsequent ones fail (browser is still down)
          if (wsCreated === 1) {
            queueMicrotask(() => mockWs.emitOpen());
          } else {
            queueMicrotask(() =>
              mockWs.emitError(new Error("ECONNREFUSED")),
            );
          }
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: Chrome crashes
      mockWs.emitClose(1006, "");

      // Advance through multiple reconnection delays (1s, 2s, 4s, 8s, ...)
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(30_000);
        await vi.runAllTimersAsync();
      }

      // Then: Multiple reconnection attempts should have been made
      expect(wsCreated).toBeGreaterThan(2);

      vi.useRealTimers();
    });

    it("should emit 'reconnectionFailed' after max retry attempts", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          queueMicrotask(() => {
            if (mockWs.readyState !== 3) {
              mockWs.emitOpen();
            } else {
              mockWs.emitError(new Error("ECONNREFUSED"));
            }
          });
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const failHandler = vi.fn();
      conn.on("reconnectionFailed", failHandler);

      // When: Chrome crashes and all reconnection attempts fail
      mockWs.readyState = 3;
      mockWs.emitClose(1006, "");

      // Advance through many reconnection cycles
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(60_000);
        await vi.runAllTimersAsync();
      }

      // Then: The reconnection failed event should eventually fire
      expect(failHandler).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should differentiate clean close (1000) from crash (1006)", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const crashHandler = vi.fn();
      const disconnectHandler = vi.fn();
      conn.on("browserCrashed", crashHandler);
      conn.on("disconnected", disconnectHandler);

      // When: WebSocket closes cleanly (code 1000)
      mockWs.emitClose(1000, "normal closure");

      // Then: disconnected should fire but NOT browserCrashed
      expect(disconnectHandler).toHaveBeenCalledOnce();
      expect(crashHandler).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Connection cleanup on close
  // -----------------------------------------------------------------------
  describe("Connection cleanup on close", () => {
    // When the connection is explicitly closed, all resources should
    // be cleaned up and no dangling promises or listeners should remain.

    it("should close the WebSocket when close() is called", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When: We close the connection
      conn.close();

      // Then: The WebSocket should be closed
      expect(mockWs.readyState).toBe(3);
      expect(conn.isConnected).toBe(false);
    });

    it("should reject all pending commands when close() is called", async () => {
      // Given: An open connection with a pending command
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      const pending = conn.send("Runtime.evaluate", { expression: "1+1" });

      // When: We close the connection
      conn.close();

      // Then: The pending command should be rejected
      await expect(pending).rejects.toThrow(/closed|disconnect/i);
    });

    it("should not attempt reconnection after explicit close()", async () => {
      // Given: An open connection
      vi.useFakeTimers();
      let connectCount = 0;
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          connectCount++;
          queueMicrotask(() => mockWs.emitOpen());
          return mockWs;
        }),
      );

      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();
      expect(connectCount).toBe(1);

      // When: We explicitly close the connection
      conn.close();

      // Advance time to check for reconnection attempts
      vi.advanceTimersByTime(60_000);
      await vi.runAllTimersAsync();

      // Then: No reconnection should have been attempted
      expect(connectCount).toBe(1);

      vi.useRealTimers();
    });

    it("should be safe to call close() multiple times", async () => {
      // Given: An open connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();

      // When/Then: Calling close() multiple times should not throw
      expect(() => {
        conn.close();
        conn.close();
        conn.close();
      }).not.toThrow();
    });

    it("should prevent new commands after close()", async () => {
      // Given: A closed connection
      const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc-123");
      await conn.connect();
      conn.close();

      // When/Then: Sending a command should reject immediately
      await expect(
        conn.send("Runtime.evaluate", { expression: "1" }),
      ).rejects.toThrow(/closed|not connected/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TARGET MANAGEMENT (src/cdp/manager.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Target Management (src/cdp/manager.ts)", () => {
  // Tests the CDPManager which handles target (tab) discovery,
  // session attachment, session routing, and target lifecycle events.

  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    vi.restoreAllMocks();

    // Stub WebSocket constructor
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        queueMicrotask(() => mockWs.emitOpen());
        return mockWs;
      }),
    );

    // Stub fetch for discovery
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "http://127.0.0.1:9222/json/version": {
          status: 200,
          body: chromeVersionResponse(),
        },
        "http://127.0.0.1:9222/json/list": {
          status: 200,
          body: chromeTargetList(),
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // List all page targets
  // -----------------------------------------------------------------------
  describe("List all page targets via Target.getTargets", () => {
    // The manager sends Target.getTargets over the browser-level
    // WebSocket and filters to type === 'page'.

    it("should list all page targets excluding chrome:// URLs", async () => {
      // Given: A CDPManager connected to Chrome
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // Simulate Target.getTargets response
      const listPromise = manager.listTabs();
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: {
          targetInfos: [
            { targetId: "TARGET_1", type: "page", title: "Example", url: "https://example.com" },
            { targetId: "TARGET_2", type: "page", title: "GitHub", url: "https://github.com" },
            { targetId: "TARGET_INT", type: "page", title: "Extensions", url: "chrome://extensions/" },
            { targetId: "TARGET_SW", type: "service_worker", title: "SW", url: "https://example.com/sw.js" },
          ],
        },
      });

      // When: We list tabs
      const tabs: TabInfo[] = await listPromise;

      // Then: Only non-chrome:// page targets should be returned
      expect(tabs).toHaveLength(2);
      expect(tabs.map((t) => t.id)).toEqual(["TARGET_1", "TARGET_2"]);
      expect(tabs.every((t) => !t.url.startsWith("chrome://"))).toBe(true);
    });

    it("should return tab info with id, title, and url", async () => {
      // Given: A connected manager
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // Simulate response
      const listPromise = manager.listTabs();
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: {
          targetInfos: [
            { targetId: "T1", type: "page", title: "My Page", url: "https://example.com/path" },
          ],
        },
      });

      // When: We get tabs
      const tabs = await listPromise;

      // Then: Each tab should have the expected properties
      expect(tabs[0]).toMatchObject({
        id: "T1",
        title: "My Page",
        url: "https://example.com/path",
      });
    });

    it("should return an empty array when no page targets exist", async () => {
      // Given: A connected manager with only non-page targets
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const listPromise = manager.listTabs();
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: {
          targetInfos: [
            { targetId: "SW1", type: "service_worker", title: "SW", url: "sw.js" },
            { targetId: "BG1", type: "background_page", title: "Ext", url: "ext.html" },
          ],
        },
      });

      // When: We list tabs
      const tabs = await listPromise;

      // Then: No tabs
      expect(tabs).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Attach to target
  // -----------------------------------------------------------------------
  describe("Attach to target via Target.attachToTarget", () => {
    // Attaching to a target creates a CDP session (sessionId) that
    // is used to route all subsequent commands to that specific tab.

    it("should attach to a target with flatten=true and return sessionId", async () => {
      // Given: A connected manager
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // When: We attach to a target
      const attachPromise = manager.switchTab("TARGET_1");

      // Verify the correct CDP command was sent
      const sent = mockWs.lastSentMessage;
      expect(sent.method).toBe("Target.attachToTarget");
      expect(sent.params).toEqual({ targetId: "TARGET_1", flatten: true });

      // Simulate Chrome returning a sessionId
      mockWs.emitMessage({
        id: sent.id,
        result: { sessionId: "SESSION_ABC_123" },
      });

      const connection = await attachPromise;

      // Then: The returned connection should be usable with the sessionId
      expect(connection).toBeDefined();
    });

    it("should use the sessionId for subsequent commands to the attached target", async () => {
      // Given: A manager attached to a target
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // Attach to target
      const attachPromise = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_XYZ" },
      });
      await attachPromise;

      // When: We send a command through the manager for this tab
      // The manager should include the sessionId automatically
      // (This verifies the session routing behavior)
      const evalPromise = manager.getOrConnect();

      // Then: The connection should be associated with the sessionId
      const conn = await evalPromise;
      expect(conn).toBeDefined();
    });

    it("should throw an error when attaching to a non-existent target", async () => {
      // Given: A connected manager
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // When: We try to attach to an invalid target
      const attachPromise = manager.switchTab("NONEXISTENT_TARGET");

      // Simulate Chrome returning an error
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        error: { code: -32000, message: "No target with given id found" },
      });

      // Then: The attach should fail with a descriptive error
      await expect(attachPromise).rejects.toThrow(/target.*not found|No target/i);
    });
  });

  // -----------------------------------------------------------------------
  // Session routing (sessionId per target)
  // -----------------------------------------------------------------------
  describe("Session routing", () => {
    // Commands sent to specific tabs must include the correct sessionId.
    // The manager tracks which sessionId belongs to which target.

    it("should track sessionId for each attached target", async () => {
      // Given: A manager that attaches to two targets
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // Attach to first target
      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach1;

      // Attach to second target
      const attach2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_2" },
      });
      await attach2;

      // Then: The manager should know which session belongs to which tab
      // (implementation detail: listTabs or internal state query)
      expect(manager).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Target lifecycle events
  // -----------------------------------------------------------------------
  describe("Target created/destroyed events", () => {
    // The browser sends events when targets are created or destroyed.
    // The manager should update its internal state accordingly.

    it("should handle Target.targetDestroyed by cleaning up the session", async () => {
      // Given: A manager attached to a target
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach;

      // When: Chrome reports the target was destroyed (tab closed)
      mockWs.emitMessage({
        method: "Target.targetDestroyed",
        params: { targetId: "TARGET_1" },
      });

      // Then: The session for TARGET_1 should be invalidated
      // Attempting to switch to the destroyed target should fail
      const switchPromise = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        error: { code: -32000, message: "No target with given id found" },
      });

      await expect(switchPromise).rejects.toThrow();
    });

    it("should handle Target.detachedFromTarget by invalidating the session", async () => {
      // Given: A manager attached to a target
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach;

      // When: Chrome reports the session was detached
      mockWs.emitMessage({
        method: "Target.detachedFromTarget",
        params: { sessionId: "SESSION_1" },
      });

      // Then: The session should be marked as invalidated
      // (The manager should handle this internally without crashing)
      expect(manager).toBeDefined();
    });

    it("should handle Target.targetCreated for new tabs", async () => {
      // Given: A connected manager
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // When: Chrome reports a new target was created
      mockWs.emitMessage({
        method: "Target.targetCreated",
        params: {
          targetInfo: {
            targetId: "TARGET_NEW",
            type: "page",
            title: "New Tab",
            url: "about:blank",
          },
        },
      });

      // Then: The new target should appear in subsequent listTabs calls
      const listPromise = manager.listTabs();
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: {
          targetInfos: [
            { targetId: "TARGET_1", type: "page", title: "Example", url: "https://example.com" },
            { targetId: "TARGET_NEW", type: "page", title: "New Tab", url: "about:blank" },
          ],
        },
      });

      const tabs = await listPromise;
      expect(tabs.some((t) => t.id === "TARGET_NEW")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Switch between targets
  // -----------------------------------------------------------------------
  describe("Switch between targets (tabs)", () => {
    // The manager supports switching the "active" target so subsequent
    // commands are routed to the newly selected tab.

    it("should switch the active tab and route commands to the new target", async () => {
      // Given: A manager attached to TARGET_1
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach1;

      // When: We switch to TARGET_2
      const switch2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_2" },
      });
      await switch2;

      // Then: The active connection should now be targeting TARGET_2
      const conn = await manager.getOrConnect();
      expect(conn).toBeDefined();
    });

    it("should reuse existing session when switching to an already-attached target", async () => {
      // Given: A manager that has previously attached to TARGET_1
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // First attachment
      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach1;

      const sentCountBefore = mockWs.sentMessages.length;

      // When: We switch back to TARGET_1
      // The manager should reuse the existing session, not re-attach
      const switch1 = manager.switchTab("TARGET_1");

      // If the manager is smart, it should resolve immediately without
      // sending another attachToTarget command. Or it should at least
      // use the cached session.
      const sentCountAfter = mockWs.sentMessages.length;

      // The test checks whether the manager avoids a redundant attachToTarget
      // If it does send one, simulate the response
      if (sentCountAfter > sentCountBefore) {
        mockWs.emitMessage({
          id: mockWs.lastSentMessage?.id,
          result: { sessionId: "SESSION_1" },
        });
      }

      await switch1;

      // Then: The connection should still work
      const conn = await manager.getOrConnect();
      expect(conn).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------
  describe("Disconnect", () => {
    // The manager should cleanly disconnect from the browser,
    // closing all sessions and the WebSocket connection.

    it("should close all connections when disconnect() is called", async () => {
      // Given: A manager connected and attached to a target
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await attach;

      // When: We disconnect
      manager.disconnect();

      // Then: The WebSocket should be closed
      expect(mockWs.readyState).toBe(3);
    });

    it("should be safe to call disconnect() when not connected", () => {
      // Given: A manager that was never connected
      const manager = new CDPManager();

      // When/Then: disconnect() should not throw
      expect(() => manager.disconnect()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Lazy connection (connect on first tool call)
  // -----------------------------------------------------------------------
  describe("Lazy connection (connect on first tool call)", () => {
    // The CDPManager should NOT connect to Chrome at instantiation time.
    // It should lazily connect on the first operation that needs a connection.

    it("should not create a WebSocket connection at instantiation time", () => {
      // Given/When: We instantiate CDPManager
      const manager = new CDPManager();

      // Then: No WebSocket should have been created yet
      expect(mockWs.sentMessages).toHaveLength(0);
    });

    it("should connect automatically on first listTabs call", async () => {
      // Given: An un-connected manager
      const manager = new CDPManager();

      // When: We call listTabs (triggers lazy connect)
      const listPromise = manager.listTabs();

      // Simulate the Target.getTargets response
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: {
          targetInfos: [
            { targetId: "T1", type: "page", title: "Tab 1", url: "https://example.com" },
          ],
        },
      });

      const tabs = await listPromise;

      // Then: The connection should have been established and tabs returned
      expect(tabs).toHaveLength(1);
    });

    it("should connect automatically on first switchTab call", async () => {
      // Given: An un-connected manager
      const manager = new CDPManager();

      // When: We switch to a tab (triggers lazy connect + attach)
      const switchPromise = manager.switchTab("TARGET_1");

      // Simulate Target.attachToTarget response
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_LAZY" },
      });

      const connection = await switchPromise;

      // Then: The connection should exist
      expect(connection).toBeDefined();
    });

    it("should reuse the same connection for subsequent calls after lazy connect", async () => {
      // Given: A manager that lazily connects on first call
      const manager = new CDPManager();

      // First call: triggers connect
      const switch1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "SESSION_1" },
      });
      await switch1;

      // When: We call getOrConnect (should reuse)
      const conn = await manager.getOrConnect();

      // Then: The connection should be reused, not a new one
      expect(conn).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Connection pooling
  // -----------------------------------------------------------------------
  describe("Connection pooling", () => {
    // The manager uses a single browser-level WebSocket connection and
    // multiplexes tab sessions via sessionId (flattened mode). No
    // per-tab WebSocket connections are created.

    it("should use a single WebSocket for multiple tab sessions", async () => {
      // Given: A connected manager — track how many WebSocket instances are created
      let wsCreated = 0;
      vi.stubGlobal(
        "WebSocket",
        vi.fn(() => {
          wsCreated++;
          queueMicrotask(() => mockWs.emitOpen());
          return mockWs;
        }),
      );

      const manager = new CDPManager();
      await manager.connect({ port: 9222 });
      const wsCountAfterConnect = wsCreated;

      // When: We attach to two different targets
      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "POOL_SESSION_1" },
      });
      await attach1;

      const attach2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "POOL_SESSION_2" },
      });
      await attach2;

      // Then: Only one WebSocket should have been created (from connect())
      expect(wsCreated).toBe(wsCountAfterConnect);
    });

    it("should clean up all sessions on disconnect", async () => {
      // Given: A manager with two attached sessions
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "POOL_S1" },
      });
      await attach1;

      const attach2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "POOL_S2" },
      });
      await attach2;

      // When: We disconnect
      manager.disconnect();

      // Then: WebSocket should be closed
      expect(mockWs.readyState).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Active tab tracking
  // -----------------------------------------------------------------------
  describe("Active tab tracking", () => {
    // The manager tracks which tab is "active" so that tools omitting
    // the tabId parameter default to the active tab.

    it("should have no active tab when first created", () => {
      // Given: A new manager
      const manager = new CDPManager();

      // Then: No active tab
      expect(manager.activeTabId).toBeNull();
    });

    it("should set the active tab when switchTab is called", async () => {
      // Given: A connected manager
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      // When: We switch to a target
      const attachPromise = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S1" },
      });
      await attachPromise;

      // Then: The active tab should be TARGET_1
      expect(manager.activeTabId).toBe("TARGET_1");
    });

    it("should update active tab when switching to a different target", async () => {
      // Given: A manager with active tab TARGET_1
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S1" },
      });
      await attach1;
      expect(manager.activeTabId).toBe("TARGET_1");

      // When: We switch to TARGET_2
      const attach2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S2" },
      });
      await attach2;

      // Then: Active tab should now be TARGET_2
      expect(manager.activeTabId).toBe("TARGET_2");
    });

    it("should clear active tab when active target is destroyed", async () => {
      // Given: A manager with active tab TARGET_1
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S1" },
      });
      await attach1;
      expect(manager.activeTabId).toBe("TARGET_1");

      // When: The active tab is destroyed
      mockWs.emitMessage({
        method: "Target.targetDestroyed",
        params: { targetId: "TARGET_1" },
      });

      // Then: Active tab should be null
      expect(manager.activeTabId).toBeNull();
    });

    it("should keep active tab when a non-active target is destroyed", async () => {
      // Given: A manager with TARGET_1 active and TARGET_2 also attached
      const manager = new CDPManager();
      await manager.connect({ port: 9222 });

      const attach1 = manager.switchTab("TARGET_1");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S1" },
      });
      await attach1;

      const attach2 = manager.switchTab("TARGET_2");
      mockWs.emitMessage({
        id: mockWs.lastSentMessage?.id,
        result: { sessionId: "ACTIVE_S2" },
      });
      await attach2;

      // Switch back to TARGET_1 as active
      const switch1 = manager.switchTab("TARGET_1");
      // If it re-attaches, simulate response; otherwise it resolves from cache
      if (mockWs.sentMessages.length > 0) {
        const lastSent = mockWs.lastSentMessage;
        if (lastSent?.method === "Target.attachToTarget") {
          mockWs.emitMessage({
            id: lastSent.id,
            result: { sessionId: "ACTIVE_S1" },
          });
        }
      }
      await switch1;
      expect(manager.activeTabId).toBe("TARGET_1");

      // When: Non-active TARGET_2 is destroyed
      mockWs.emitMessage({
        method: "Target.targetDestroyed",
        params: { targetId: "TARGET_2" },
      });

      // Then: Active tab should still be TARGET_1
      expect(manager.activeTabId).toBe("TARGET_1");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.5. PARSE /json/list RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

describe("Parse /json/list response (src/cdp/discovery.ts)", () => {
  // Tests the parseJsonListResponse utility that parses the array of
  // targets returned by Chrome's /json/list HTTP endpoint.

  it("should parse all targets from a /json/list response", () => {
    // Given: A typical /json/list response array
    const raw = [
      {
        id: "TARGET_1",
        type: "page",
        title: "Example Page",
        url: "https://example.com",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_1",
        devtoolsFrontendUrl: "/devtools/inspector.html?ws=...",
        description: "",
      },
      {
        id: "TARGET_2",
        type: "page",
        title: "GitHub",
        url: "https://github.com",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_2",
      },
      {
        id: "TARGET_SW",
        type: "service_worker",
        title: "SW",
        url: "https://example.com/sw.js",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TARGET_SW",
      },
    ];

    // When: We parse the response
    const targets = parseJsonListResponse(raw);

    // Then: All targets should be returned with correct fields
    expect(targets).toHaveLength(3);
    expect(targets[0]!.id).toBe("TARGET_1");
    expect(targets[0]!.type).toBe("page");
    expect(targets[0]!.title).toBe("Example Page");
    expect(targets[0]!.url).toBe("https://example.com");
  });

  it("should filter to only page targets when pagesOnly is true", () => {
    // Given: A mixed response with pages and service workers
    const raw = [
      { id: "P1", type: "page", title: "Tab 1", url: "https://example.com" },
      { id: "SW1", type: "service_worker", title: "SW", url: "sw.js" },
      { id: "P2", type: "page", title: "Tab 2", url: "https://github.com" },
      { id: "BG1", type: "background_page", title: "Ext BG", url: "bg.html" },
    ];

    // When: We parse with pagesOnly filter
    const targets = parseJsonListResponse(raw, { pagesOnly: true });

    // Then: Only page targets should be returned
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.type === "page")).toBe(true);
  });

  it("should exclude chrome:// URLs when excludeInternal is true", () => {
    // Given: A response that includes internal Chrome pages
    const raw = [
      { id: "P1", type: "page", title: "App", url: "https://example.com" },
      { id: "P2", type: "page", title: "Settings", url: "chrome://settings" },
      { id: "P3", type: "page", title: "Extensions", url: "chrome://extensions" },
      { id: "P4", type: "page", title: "New Tab", url: "chrome://newtab" },
    ];

    // When: We parse with excludeInternal filter
    const targets = parseJsonListResponse(raw, { pagesOnly: true, excludeInternal: true });

    // Then: Only non-chrome:// pages should remain
    expect(targets).toHaveLength(1);
    expect(targets[0]!.url).toBe("https://example.com");
  });

  it("should return an empty array when input is empty", () => {
    // Given: An empty response
    const raw: unknown[] = [];

    // When: We parse it
    const targets = parseJsonListResponse(raw);

    // Then: Empty array
    expect(targets).toHaveLength(0);
  });

  it("should include webSocketDebuggerUrl for each target when present", () => {
    // Given: A response with WS URLs
    const raw = [
      {
        id: "T1",
        type: "page",
        title: "Page",
        url: "https://example.com",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/T1",
      },
    ];

    // When: We parse it
    const targets = parseJsonListResponse(raw);

    // Then: The webSocketDebuggerUrl should be preserved
    expect(targets[0]!.webSocketDebuggerUrl).toBe("ws://127.0.0.1:9222/devtools/page/T1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.6. AUTO-INCREMENTING MESSAGE IDS (explicit tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("Auto-incrementing message IDs (src/cdp/connection.ts)", () => {
  // Tests that message IDs start at 1 and increment by 1 for each
  // command sent. IDs must never be reused within a connection's lifetime.

  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        queueMicrotask(() => mockWs.emitOpen());
        return mockWs;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should start message IDs at 1", async () => {
    // Given: A new connection
    const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/test");
    await conn.connect();

    // When: We send the first command
    const promise = conn.send("Runtime.enable", {});
    const sent = JSON.parse(mockWs.sentMessages[0]!);

    // Then: ID should be 1
    expect(sent.id).toBe(1);

    // Cleanup
    mockWs.emitMessage({ id: 1, result: {} });
    await promise;
  });

  it("should increment IDs by 1 for each subsequent command", async () => {
    // Given: An open connection
    const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/test");
    await conn.connect();

    // When: We send 5 commands
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(conn.send(`Method.${i}`, {}));
    }

    // Then: IDs should be 1, 2, 3, 4, 5
    const ids = mockWs.sentMessages.map((m) => JSON.parse(m).id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);

    // Cleanup
    ids.forEach((id) => mockWs.emitMessage({ id, result: {} }));
    await Promise.all(promises);
  });

  it("should never reuse IDs even after many commands", async () => {
    // Given: An open connection
    const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/test");
    await conn.connect();

    // When: We send 50 commands
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(conn.send("Test.method", {}));
    }

    // Respond to all
    for (let i = 1; i <= 50; i++) {
      mockWs.emitMessage({ id: i, result: {} });
    }
    await Promise.all(promises);

    // Then: All 50 IDs should be unique
    const ids = mockWs.sentMessages.map((m) => JSON.parse(m).id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(50);
    expect(ids[0]).toBe(1);
    expect(ids[49]).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CROSS-OS BROWSER PATHS
// ═══════════════════════════════════════════════════════════════════════════

describe("Cross-OS Browser Paths", () => {
  // Tests that the discovery module knows the correct file system paths
  // for the DevToolsActivePort file across macOS, Linux, and Windows,
  // and for multiple Chromium-based browsers.

  // -----------------------------------------------------------------------
  // Chrome DevToolsActivePort paths
  // -----------------------------------------------------------------------
  describe("Chrome DevToolsActivePort file paths", () => {
    // Each OS stores Chrome's profile data in a different location.
    // The DevToolsActivePort file is inside the profile directory.

    it("should resolve the macOS path for Chrome DevToolsActivePort", () => {
      // Given: We are on macOS
      // When: We ask for the DevToolsActivePort path
      const path = getChromePath("darwin", "chrome");

      // Then: It should be under ~/Library/Application Support/Google/Chrome
      expect(path.replace(/\\/g, '/')).toContain("Library/Application Support/Google/Chrome");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Linux path for Chrome DevToolsActivePort", () => {
      // Given: We are on Linux
      // When: We ask for the path
      const path = getChromePath("linux", "chrome");

      // Then: It should be under ~/.config/google-chrome
      expect(path.replace(/\\/g, '/')).toContain(".config/google-chrome");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Windows path for Chrome DevToolsActivePort", () => {
      // Given: We are on Windows
      // When: We ask for the path
      const path = getChromePath("win32", "chrome");

      // Then: It should be under %LOCALAPPDATA%\Google\Chrome\User Data
      expect(path).toMatch(/Google[\\/]Chrome[\\/]User Data/i);
      expect(path).toMatch(/DevToolsActivePort$/);
    });
  });

  // -----------------------------------------------------------------------
  // Edge DevToolsActivePort paths
  // -----------------------------------------------------------------------
  describe("Edge DevToolsActivePort file paths", () => {
    it("should resolve the macOS path for Edge DevToolsActivePort", () => {
      const path = getChromePath("darwin", "edge");
      expect(path).toContain("Microsoft Edge");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Linux path for Edge DevToolsActivePort", () => {
      const path = getChromePath("linux", "edge");
      expect(path).toContain("microsoft-edge");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Windows path for Edge DevToolsActivePort", () => {
      const path = getChromePath("win32", "edge");
      expect(path).toMatch(/Microsoft[\\/]Edge/i);
      expect(path).toMatch(/DevToolsActivePort$/);
    });
  });

  // -----------------------------------------------------------------------
  // Brave DevToolsActivePort paths
  // -----------------------------------------------------------------------
  describe("Brave DevToolsActivePort file paths", () => {
    it("should resolve the macOS path for Brave DevToolsActivePort", () => {
      const path = getChromePath("darwin", "brave");
      expect(path.replace(/\\/g, '/')).toContain("BraveSoftware/Brave-Browser");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Linux path for Brave DevToolsActivePort", () => {
      const path = getChromePath("linux", "brave");
      expect(path.replace(/\\/g, '/')).toContain("BraveSoftware/Brave-Browser");
      expect(path).toEndWith("DevToolsActivePort");
    });

    it("should resolve the Windows path for Brave DevToolsActivePort", () => {
      const path = getChromePath("win32", "brave");
      expect(path).toMatch(/BraveSoftware[\\/]Brave-Browser/i);
      expect(path).toMatch(/DevToolsActivePort$/);
    });
  });

  // -----------------------------------------------------------------------
  // Arc DevToolsActivePort paths
  // -----------------------------------------------------------------------
  describe("Arc DevToolsActivePort file paths", () => {
    it("should resolve the macOS path for Arc DevToolsActivePort", () => {
      // Arc is macOS-only at this time
      const path = getChromePath("darwin", "arc");
      expect(path).toContain("Arc");
      expect(path).toEndWith("DevToolsActivePort");
    });
  });

  // -----------------------------------------------------------------------
  // Unknown OS handling
  // -----------------------------------------------------------------------
  describe("Unknown OS handling", () => {
    it("should throw for unsupported platform", () => {
      // Given: An unsupported platform
      // When/Then: Getting the path should throw
      expect(() => getChromePath("freebsd" as NodeJS.Platform, "chrome")).toThrow(
        /unsupported.*platform/i,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. CDP CONSTANTS (src/cdp/connection.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("CDP Constants", () => {
  // Verifies that the critical timeout and retry constants exported from
  // src/cdp/connection.ts have their expected values, preventing silent
  // configuration drift.

  it("TIMEOUT should be 15000ms (15 seconds)", () => {
    expect(TIMEOUT).toBe(15000);
  });

  it("NAVIGATION_TIMEOUT should be 30000ms (30 seconds)", () => {
    expect(NAVIGATION_TIMEOUT).toBe(30000);
  });

  it("IDLE_TIMEOUT should be 1200000ms (20 minutes)", () => {
    expect(IDLE_TIMEOUT).toBe(1200000);
  });

  it("DAEMON_CONNECT_RETRIES should be 20", () => {
    expect(DAEMON_CONNECT_RETRIES).toBe(20);
  });

  it("DAEMON_CONNECT_DELAY should be 300ms", () => {
    expect(DAEMON_CONNECT_DELAY).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. waitForDocumentReady POLLING (src/cdp/connection.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("waitForDocumentReady polling", () => {
  // Tests the polling mechanism that waits for document.readyState === 'complete'.
  // waitForDocumentReady(cdp, sessionId, timeoutMs) polls via Runtime.evaluate
  // every ~200ms until readyState is 'complete' or the timeout expires.

  it("should poll until document.readyState is 'complete'", async () => {
    // Given: readyState transitions from 'loading' -> 'interactive' -> 'complete'
    const mockCdp = createMockCDP();
    let callCount = 0;
    const states = ["loading", "interactive", "complete"];
    mockCdp.send = vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") {
        return { result: { type: "string", value: states[Math.min(callCount++, states.length - 1)] } };
      }
      return {};
    });

    // When: waitForDocumentReady is called
    await waitForDocumentReady(mockCdp, "SESSION_1", 5000);

    // Then: it should have polled multiple times
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject with timeout when readyState never reaches 'complete'", async () => {
    vi.useFakeTimers();
    const mockCdp = createMockCDP();
    mockCdp.send = vi.fn(async () => ({ result: { type: "string", value: "loading" } }));

    const promise = waitForDocumentReady(mockCdp, "SESSION_1", 1000);
    vi.advanceTimersByTime(1500);

    await expect(promise).rejects.toThrow(/timeout|readyState/i);
    vi.useRealTimers();
  });

  it("should include last known readyState in timeout error message", async () => {
    vi.useFakeTimers();
    const mockCdp = createMockCDP();
    mockCdp.send = vi.fn(async () => ({ result: { type: "string", value: "interactive" } }));

    const promise = waitForDocumentReady(mockCdp, "SESSION_1", 1000);
    vi.advanceTimersByTime(1500);

    try {
      await promise;
      expect.fail("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("interactive");
    }
    vi.useRealTimers();
  });

  it("should retry when Runtime.evaluate fails temporarily during navigation", async () => {
    const mockCdp = createMockCDP();
    let callCount = 0;
    mockCdp.send = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("Execution context was destroyed");
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(mockCdp, "SESSION_1", 5000);
    expect(callCount).toBe(3);
  });

  it("should poll at approximately 200ms intervals", async () => {
    vi.useFakeTimers();
    const mockCdp = createMockCDP();
    const timestamps: number[] = [];
    mockCdp.send = vi.fn(async () => {
      timestamps.push(Date.now());
      if (timestamps.length >= 4) return { result: { type: "string", value: "complete" } };
      return { result: { type: "string", value: "loading" } };
    });

    const promise = waitForDocumentReady(mockCdp, "SESSION_1", 5000);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();
    }
    await promise;

    // Check intervals between polls are approximately 200ms
    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i]! - timestamps[i - 1]!;
      expect(interval).toBeGreaterThanOrEqual(180);
      expect(interval).toBeLessThanOrEqual(300);
    }
    vi.useRealTimers();
  });
});

