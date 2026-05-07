/**
 * TDD tests for the browsirai MCP server layer.
 *
 * Covers:
 * - MCP server creation and startup
 * - All 25 tool registrations with correct names, schemas, and descriptions
 * - Input schema validation (valid inputs, invalid inputs, required/optional fields)
 * - Error response format
 * - CLI command dispatch
 * - Config loading, defaults, validation, env overrides
 * - Platform detection
 *
 * RED phase: Source modules do not exist yet — implementations will follow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. MCP Server
// ---------------------------------------------------------------------------

describe("MCP Server (src/server.ts)", () => {
  let createServer: typeof import("../src/server").createServer;
  let McpServerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Mock the MCP SDK – we only need to verify our server calls the right APIs
    McpServerMock = vi.fn().mockImplementation(() => ({
      tool: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
      McpServer: McpServerMock,
    }));

    vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
      StdioServerTransport: vi.fn().mockImplementation(() => ({})),
    }));

    const mod = await import("../src/server");
    createServer = mod.createServer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("creates an McpServer instance with the correct name and version", async () => {
    const server = await createServer();

    expect(McpServerMock).toHaveBeenCalledOnce();
    const ctorArg = McpServerMock.mock.calls[0]![0] as {
      name: string;
      version: string;
    };
    expect(ctorArg.name).toBe("browsirai");
    expect(ctorArg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("starts the server with a StdioServerTransport", async () => {
    const server = await createServer();
    // The server object should expose a `start()` or `connect()` that was called
    expect(server.connect).toBeDefined();
  });

  // ------- Tool registration -------

  const EXPECTED_TOOLS: string[] = [
    "browser_connect",
    "browser_tabs",
    "browser_snapshot",
    "browser_screenshot",
    "browser_click",
    "browser_fill_form",
    "browser_type",
    "browser_press_key",
    "browser_navigate",
    "browser_navigate_back",
    "browser_evaluate",
    "browser_scroll",
    "browser_network_requests",
    "browser_console_messages",
    "browser_html",
    "browser_close",
    "browser_wait_for",
    "browser_hover",
    "browser_drag",
    "browser_select_option",
    "browser_handle_dialog",
    "browser_file_upload",
    "browser_resize",
    "browser_annotated_screenshot",
    "browser_inspect_source",
    "browser_route",
    "browser_abort",
    "browser_unroute",
    "browser_find",
    "browser_diff",
    "browser_save_state",
    "browser_load_state",
    "browser_list",
  ];

  it("registers exactly 33 tools", async () => {
    const server = await createServer();
    const toolFn = (server as any).tool as ReturnType<typeof vi.fn>;
    expect(toolFn.mock.calls.length).toBe(33);
  });

  it("all tool names follow the browser_* pattern", async () => {
    const server = await createServer();
    const toolFn = (server as any).tool as ReturnType<typeof vi.fn>;
    const registeredNames = toolFn.mock.calls.map(
      (call: unknown[]) => call[0] as string
    );

    for (const name of registeredNames) {
      expect(name).toMatch(/^browser_/);
    }
  });

  it("registers every expected tool name", async () => {
    const server = await createServer();
    const toolFn = (server as any).tool as ReturnType<typeof vi.fn>;
    const registeredNames = new Set(
      toolFn.mock.calls.map((call: unknown[]) => call[0] as string)
    );

    for (const expected of EXPECTED_TOOLS) {
      expect(registeredNames.has(expected)).toBe(true);
    }
  });

  it("each tool has a non-empty description", async () => {
    const server = await createServer();
    const toolFn = (server as any).tool as ReturnType<typeof vi.fn>;

    for (const call of toolFn.mock.calls) {
      // MCP SDK tool() signature: tool(name, description, schema, handler)
      const description = call[1] as string;
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(0);
    }
  });

  it("each tool has a valid Zod input schema", async () => {
    const server = await createServer();
    const toolFn = (server as any).tool as ReturnType<typeof vi.fn>;

    for (const call of toolFn.mock.calls) {
      // Schema is the third argument when description is provided
      const schema = call[2] as Record<string, z.ZodType>;
      expect(schema).toBeDefined();
      expect(typeof schema).toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Tool Schema Validation — all 25 tools
// ---------------------------------------------------------------------------

describe("Tool Schema Validation", () => {
  // We import the schemas directly from the tools index module.
  // Each tool module is expected to export its Zod schema.
  let schemas: Record<string, z.ZodType>;

  beforeEach(async () => {
    const mod = await import("../src/tools/index");
    schemas = mod.schemas;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ---- 1. browser_connect ----
  describe("browser_connect", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_connect.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts port number", () => {
      const result = schemas.browser_connect.safeParse({ port: 9222 });
      expect(result.success).toBe(true);
    });

    it("accepts host string", () => {
      const result = schemas.browser_connect.safeParse({
        host: "127.0.0.1",
      });
      expect(result.success).toBe(true);
    });

    it("accepts both port and host", () => {
      const result = schemas.browser_connect.safeParse({
        port: 9223,
        host: "localhost",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-number port", () => {
      const result = schemas.browser_connect.safeParse({ port: "9222" });
      expect(result.success).toBe(false);
    });

    it("rejects non-string host", () => {
      const result = schemas.browser_connect.safeParse({ host: 127 });
      expect(result.success).toBe(false);
    });
  });

  // ---- 2. browser_tabs ----
  describe("browser_tabs", () => {
    it("accepts empty input (filter is optional)", () => {
      const result = schemas.browser_tabs.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid filter string", () => {
      const result = schemas.browser_tabs.safeParse({ filter: "github" });
      expect(result.success).toBe(true);
    });

    it("rejects non-string filter", () => {
      const result = schemas.browser_tabs.safeParse({ filter: 123 });
      expect(result.success).toBe(false);
    });
  });

  // ---- 3. browser_snapshot ----
  describe("browser_snapshot", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_snapshot.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid selector string", () => {
      const result = schemas.browser_snapshot.safeParse({
        selector: "#main-content",
      });
      expect(result.success).toBe(true);
    });

    it("accepts compact boolean", () => {
      const result = schemas.browser_snapshot.safeParse({ compact: true });
      expect(result.success).toBe(true);
    });

    it("rejects non-boolean compact", () => {
      const result = schemas.browser_snapshot.safeParse({ compact: "yes" });
      expect(result.success).toBe(false);
    });

    it("rejects non-string selector", () => {
      const result = schemas.browser_snapshot.safeParse({ selector: 42 });
      expect(result.success).toBe(false);
    });

    it("should accept interactive boolean", () => {
      expect(schemas.browser_snapshot.safeParse({ interactive: true }).success).toBe(true);
    });

    it("should accept cursor boolean", () => {
      expect(schemas.browser_snapshot.safeParse({ cursor: true }).success).toBe(true);
    });

    it("should accept depth number", () => {
      expect(schemas.browser_snapshot.safeParse({ depth: 3 }).success).toBe(true);
    });

    it("should reject non-number depth", () => {
      expect(schemas.browser_snapshot.safeParse({ depth: "three" }).success).toBe(false);
    });

    it("should reject non-boolean interactive", () => {
      expect(schemas.browser_snapshot.safeParse({ interactive: "yes" }).success).toBe(false);
    });
  });

  // ---- 4. browser_screenshot ----
  describe("browser_screenshot", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_screenshot.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid selector", () => {
      const result = schemas.browser_screenshot.safeParse({
        selector: ".hero",
      });
      expect(result.success).toBe(true);
    });

    it("accepts fullPage boolean", () => {
      const result = schemas.browser_screenshot.safeParse({ fullPage: true });
      expect(result.success).toBe(true);
    });

    it("accepts format enum: png", () => {
      const result = schemas.browser_screenshot.safeParse({ format: "png" });
      expect(result.success).toBe(true);
    });

    it("accepts format enum: jpeg", () => {
      const result = schemas.browser_screenshot.safeParse({ format: "jpeg" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid format enum", () => {
      const result = schemas.browser_screenshot.safeParse({ format: "gif" });
      expect(result.success).toBe(false);
    });

    it("accepts quality number", () => {
      const result = schemas.browser_screenshot.safeParse({ quality: 80 });
      expect(result.success).toBe(true);
    });

    it("rejects non-number quality", () => {
      const result = schemas.browser_screenshot.safeParse({
        quality: "high",
      });
      expect(result.success).toBe(false);
    });

    it("accepts annotate boolean", () => {
      const result = schemas.browser_screenshot.safeParse({ annotate: true });
      expect(result.success).toBe(true);
    });

    it("rejects non-boolean annotate", () => {
      const result = schemas.browser_screenshot.safeParse({ annotate: 1 });
      expect(result.success).toBe(false);
    });

    it("accepts fullPage with format and quality together", () => {
      const result = schemas.browser_screenshot.safeParse({
        fullPage: true,
        format: "jpeg",
        quality: 90,
      });
      expect(result.success).toBe(true);
    });
  });

  // ---- 5. browser_click ----
  describe("browser_click", () => {
    it("accepts selector string", () => {
      const result = schemas.browser_click.safeParse({
        selector: "#submit-btn",
      });
      expect(result.success).toBe(true);
    });

    it("accepts ref string", () => {
      const result = schemas.browser_click.safeParse({ ref: "ref=12" });
      expect(result.success).toBe(true);
    });

    it("accepts x,y coordinate pair", () => {
      const result = schemas.browser_click.safeParse({ x: 100, y: 200 });
      expect(result.success).toBe(true);
    });

    it("rejects empty input (requires selector, ref, or x/y)", () => {
      const result = schemas.browser_click.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects x without y", () => {
      const result = schemas.browser_click.safeParse({ x: 100 });
      expect(result.success).toBe(false);
    });

    it("rejects y without x", () => {
      const result = schemas.browser_click.safeParse({ y: 200 });
      expect(result.success).toBe(false);
    });

    it("rejects non-string selector", () => {
      const result = schemas.browser_click.safeParse({ selector: 123 });
      expect(result.success).toBe(false);
    });

    it("rejects non-number x", () => {
      const result = schemas.browser_click.safeParse({
        x: "ten",
        y: 200,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number y", () => {
      const result = schemas.browser_click.safeParse({
        x: 100,
        y: "twenty",
      });
      expect(result.success).toBe(false);
    });

    it("should accept newTab boolean", () => {
      expect(schemas.browser_click.safeParse({ ref: "@e1", newTab: true }).success).toBe(true);
    });

    it("should reject non-boolean newTab", () => {
      expect(schemas.browser_click.safeParse({ ref: "@e1", newTab: "yes" }).success).toBe(false);
    });
  });

  // ---- 6. browser_fill_form ----
  describe("browser_fill_form", () => {
    it("accepts ref and value", () => {
      const result = schemas.browser_fill_form.safeParse({
        ref: "ref=5",
        value: "hello",
      });
      expect(result.success).toBe(true);
    });

    it("accepts selector and value", () => {
      const result = schemas.browser_fill_form.safeParse({
        selector: "#email",
        value: "user@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing value", () => {
      const result = schemas.browser_fill_form.safeParse({
        ref: "ref=5",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing ref and selector", () => {
      const result = schemas.browser_fill_form.safeParse({
        value: "hello",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty input", () => {
      const result = schemas.browser_fill_form.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string value", () => {
      const result = schemas.browser_fill_form.safeParse({
        ref: "ref=5",
        value: 42,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string ref", () => {
      const result = schemas.browser_fill_form.safeParse({
        ref: 5,
        value: "hello",
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 7. browser_type ----
  describe("browser_type", () => {
    it("accepts required text", () => {
      const result = schemas.browser_type.safeParse({
        text: "Hello, world!",
      });
      expect(result.success).toBe(true);
    });

    it("accepts text with optional ref", () => {
      const result = schemas.browser_type.safeParse({
        text: "Hello",
        ref: "ref=3",
      });
      expect(result.success).toBe(true);
    });

    it("accepts text with optional slowly boolean", () => {
      const result = schemas.browser_type.safeParse({
        text: "slow typing",
        slowly: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts text with optional submit boolean", () => {
      const result = schemas.browser_type.safeParse({
        text: "query",
        submit: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts text with all optional fields", () => {
      const result = schemas.browser_type.safeParse({
        text: "full options",
        ref: "ref=7",
        slowly: true,
        submit: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing text", () => {
      const result = schemas.browser_type.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string text", () => {
      const result = schemas.browser_type.safeParse({ text: 123 });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean slowly", () => {
      const result = schemas.browser_type.safeParse({
        text: "hello",
        slowly: "yes",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean submit", () => {
      const result = schemas.browser_type.safeParse({
        text: "hello",
        submit: 1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string ref", () => {
      const result = schemas.browser_type.safeParse({
        text: "hello",
        ref: 42,
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 8. browser_press_key ----
  describe("browser_press_key", () => {
    it("accepts required key string", () => {
      const result = schemas.browser_press_key.safeParse({ key: "Enter" });
      expect(result.success).toBe(true);
    });

    it("accepts key combination", () => {
      const result = schemas.browser_press_key.safeParse({
        key: "Control+c",
      });
      expect(result.success).toBe(true);
    });

    it("accepts arrow keys", () => {
      const result = schemas.browser_press_key.safeParse({
        key: "ArrowLeft",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing key", () => {
      const result = schemas.browser_press_key.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string key", () => {
      const result = schemas.browser_press_key.safeParse({ key: 13 });
      expect(result.success).toBe(false);
    });
  });

  // ---- 9. browser_navigate ----
  describe("browser_navigate", () => {
    it("accepts required url string", () => {
      const result = schemas.browser_navigate.safeParse({
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = schemas.browser_navigate.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string url", () => {
      const result = schemas.browser_navigate.safeParse({ url: 42 });
      expect(result.success).toBe(false);
    });

    it("accepts url with protocol variations", () => {
      const result = schemas.browser_navigate.safeParse({
        url: "http://localhost:3000",
      });
      expect(result.success).toBe(true);
    });

    it("should accept waitUntil: 'load'", () => {
      expect(schemas.browser_navigate.safeParse({ url: "https://example.com", waitUntil: "load" }).success).toBe(true);
    });

    it("should accept waitUntil: 'domcontentloaded'", () => {
      expect(schemas.browser_navigate.safeParse({ url: "https://example.com", waitUntil: "domcontentloaded" }).success).toBe(true);
    });

    it("should accept waitUntil: 'networkidle'", () => {
      expect(schemas.browser_navigate.safeParse({ url: "https://example.com", waitUntil: "networkidle" }).success).toBe(true);
    });

    it("should reject invalid waitUntil value", () => {
      expect(schemas.browser_navigate.safeParse({ url: "https://example.com", waitUntil: "fast" }).success).toBe(false);
    });
  });

  // ---- 10. browser_navigate_back ----
  describe("browser_navigate_back", () => {
    it("accepts empty input (no required params)", () => {
      const result = schemas.browser_navigate_back.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts direction: back", () => {
      const result = schemas.browser_navigate_back.safeParse({
        direction: "back",
      });
      expect(result.success).toBe(true);
    });

    it("accepts direction: forward", () => {
      const result = schemas.browser_navigate_back.safeParse({
        direction: "forward",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid direction", () => {
      const result = schemas.browser_navigate_back.safeParse({
        direction: "up",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string direction", () => {
      const result = schemas.browser_navigate_back.safeParse({
        direction: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 11. browser_evaluate ----
  describe("browser_evaluate", () => {
    it("accepts required expression string", () => {
      const result = schemas.browser_evaluate.safeParse({
        expression: "document.title",
      });
      expect(result.success).toBe(true);
    });

    it("accepts complex expression", () => {
      const result = schemas.browser_evaluate.safeParse({
        expression: "(() => { return document.querySelectorAll('a').length; })()",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing expression", () => {
      const result = schemas.browser_evaluate.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string expression", () => {
      const result = schemas.browser_evaluate.safeParse({ expression: 42 });
      expect(result.success).toBe(false);
    });

    it("should accept optional frameId string", () => {
      expect(schemas.browser_evaluate.safeParse({ expression: "1+1", frameId: "FRAME_1" }).success).toBe(true);
    });
  });

  // ---- 12. browser_scroll ----
  describe("browser_scroll", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_scroll.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts direction: up", () => {
      const result = schemas.browser_scroll.safeParse({ direction: "up" });
      expect(result.success).toBe(true);
    });

    it("accepts direction: down", () => {
      const result = schemas.browser_scroll.safeParse({ direction: "down" });
      expect(result.success).toBe(true);
    });

    it("accepts direction: left", () => {
      const result = schemas.browser_scroll.safeParse({ direction: "left" });
      expect(result.success).toBe(true);
    });

    it("accepts direction: right", () => {
      const result = schemas.browser_scroll.safeParse({
        direction: "right",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid direction", () => {
      const result = schemas.browser_scroll.safeParse({
        direction: "diagonal",
      });
      expect(result.success).toBe(false);
    });

    it("accepts pixels number", () => {
      const result = schemas.browser_scroll.safeParse({ pixels: 500 });
      expect(result.success).toBe(true);
    });

    it("rejects non-number pixels", () => {
      const result = schemas.browser_scroll.safeParse({ pixels: "many" });
      expect(result.success).toBe(false);
    });

    it("accepts selector string", () => {
      const result = schemas.browser_scroll.safeParse({
        selector: "#content",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string selector", () => {
      const result = schemas.browser_scroll.safeParse({ selector: 42 });
      expect(result.success).toBe(false);
    });

    it("accepts direction with pixels together", () => {
      const result = schemas.browser_scroll.safeParse({
        direction: "down",
        pixels: 300,
      });
      expect(result.success).toBe(true);
    });
  });

  // ---- 13. browser_network_requests ----
  describe("browser_network_requests", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_network_requests.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts filter string", () => {
      const result = schemas.browser_network_requests.safeParse({
        filter: "api",
      });
      expect(result.success).toBe(true);
    });

    it("accepts limit number", () => {
      const result = schemas.browser_network_requests.safeParse({
        limit: 50,
      });
      expect(result.success).toBe(true);
    });

    it("accepts includeHeaders boolean", () => {
      const result = schemas.browser_network_requests.safeParse({
        includeHeaders: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts includeStatic boolean", () => {
      const result = schemas.browser_network_requests.safeParse({
        includeStatic: false,
      });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields together", () => {
      const result = schemas.browser_network_requests.safeParse({
        filter: "api",
        limit: 25,
        includeHeaders: true,
        includeStatic: false,
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string filter", () => {
      const result = schemas.browser_network_requests.safeParse({
        filter: 123,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number limit", () => {
      const result = schemas.browser_network_requests.safeParse({
        limit: "all",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean includeHeaders", () => {
      const result = schemas.browser_network_requests.safeParse({
        includeHeaders: "yes",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean includeStatic", () => {
      const result = schemas.browser_network_requests.safeParse({
        includeStatic: "no",
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 14. browser_console_messages ----
  describe("browser_console_messages", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_console_messages.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts limit number", () => {
      const result = schemas.browser_console_messages.safeParse({
        limit: 25,
      });
      expect(result.success).toBe(true);
    });

    it("accepts level: log", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: "log",
      });
      expect(result.success).toBe(true);
    });

    it("accepts level: warn", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: "warn",
      });
      expect(result.success).toBe(true);
    });

    it("accepts level: error", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: "error",
      });
      expect(result.success).toBe(true);
    });

    it("accepts level: info", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: "info",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid level (e.g. debug)", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: "debug",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number limit", () => {
      const result = schemas.browser_console_messages.safeParse({
        limit: "all",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string level", () => {
      const result = schemas.browser_console_messages.safeParse({
        level: 1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts limit and level together", () => {
      const result = schemas.browser_console_messages.safeParse({
        limit: 10,
        level: "error",
      });
      expect(result.success).toBe(true);
    });
  });

  // ---- 15. browser_html ----
  describe("browser_html", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_html.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts selector string", () => {
      const result = schemas.browser_html.safeParse({
        selector: "div.content",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string selector", () => {
      const result = schemas.browser_html.safeParse({ selector: 42 });
      expect(result.success).toBe(false);
    });
  });

  // ---- 16. browser_close ----
  describe("browser_close", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_close.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts targetId string", () => {
      const result = schemas.browser_close.safeParse({
        targetId: "ABC123",
      });
      expect(result.success).toBe(true);
    });

    it("accepts force boolean", () => {
      const result = schemas.browser_close.safeParse({ force: true });
      expect(result.success).toBe(true);
    });

    it("accepts targetId and force together", () => {
      const result = schemas.browser_close.safeParse({
        targetId: "ABC123",
        force: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string targetId", () => {
      const result = schemas.browser_close.safeParse({ targetId: 123 });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean force", () => {
      const result = schemas.browser_close.safeParse({ force: "yes" });
      expect(result.success).toBe(false);
    });

    it("should accept closeAll boolean", () => {
      expect(schemas.browser_close.safeParse({ closeAll: true }).success).toBe(true);
    });
  });

  // ---- 17. browser_wait_for ----
  describe("browser_wait_for", () => {
    it("accepts text string (wait for text to appear)", () => {
      const result = schemas.browser_wait_for.safeParse({
        text: "Loading complete",
      });
      expect(result.success).toBe(true);
    });

    it("accepts textGone string (wait for text to disappear)", () => {
      const result = schemas.browser_wait_for.safeParse({
        textGone: "Loading...",
      });
      expect(result.success).toBe(true);
    });

    it("accepts time number (wait for duration)", () => {
      const result = schemas.browser_wait_for.safeParse({ time: 2 });
      expect(result.success).toBe(true);
    });

    it("accepts optional timeout number", () => {
      const result = schemas.browser_wait_for.safeParse({
        text: "Done",
        timeout: 10,
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty input (all fields optional)", () => {
      // All fields are optional — empty is valid (implementation decides behavior)
      const result = schemas.browser_wait_for.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects non-string text", () => {
      const result = schemas.browser_wait_for.safeParse({ text: 42 });
      expect(result.success).toBe(false);
    });

    it("rejects non-string textGone", () => {
      const result = schemas.browser_wait_for.safeParse({ textGone: true });
      expect(result.success).toBe(false);
    });

    it("rejects non-number time", () => {
      const result = schemas.browser_wait_for.safeParse({ time: "forever" });
      expect(result.success).toBe(false);
    });

    it("rejects non-number timeout", () => {
      const result = schemas.browser_wait_for.safeParse({
        text: "Done",
        timeout: "long",
      });
      expect(result.success).toBe(false);
    });

    it("should accept url glob pattern", () => {
      expect(schemas.browser_wait_for.safeParse({ url: "**/dashboard" }).success).toBe(true);
    });

    it("should accept fn JS expression", () => {
      expect(schemas.browser_wait_for.safeParse({ fn: "window.ready === true" }).success).toBe(true);
    });

    it("should accept selector with state: 'hidden'", () => {
      expect(schemas.browser_wait_for.safeParse({ selector: "#spinner", state: "hidden" }).success).toBe(true);
    });

    it("should accept loadState enum", () => {
      expect(schemas.browser_wait_for.safeParse({ loadState: "networkidle" }).success).toBe(true);
    });
  });

  // ---- 18. browser_hover ----
  describe("browser_hover", () => {
    it("accepts required ref string", () => {
      const result = schemas.browser_hover.safeParse({ ref: "ref=7" });
      expect(result.success).toBe(true);
    });

    it("rejects missing ref (required)", () => {
      const result = schemas.browser_hover.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string ref", () => {
      const result = schemas.browser_hover.safeParse({ ref: 7 });
      expect(result.success).toBe(false);
    });
  });

  // ---- 19. browser_drag ----
  describe("browser_drag", () => {
    it("accepts required startRef and endRef", () => {
      const result = schemas.browser_drag.safeParse({
        startRef: "ref=1",
        endRef: "ref=2",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing startRef", () => {
      const result = schemas.browser_drag.safeParse({
        endRef: "ref=2",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing endRef", () => {
      const result = schemas.browser_drag.safeParse({
        startRef: "ref=1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty input", () => {
      const result = schemas.browser_drag.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string startRef", () => {
      const result = schemas.browser_drag.safeParse({
        startRef: 1,
        endRef: "ref=2",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string endRef", () => {
      const result = schemas.browser_drag.safeParse({
        startRef: "ref=1",
        endRef: 2,
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 20. browser_select_option ----
  describe("browser_select_option", () => {
    it("accepts required ref and values array", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: "ref=9",
        values: ["us"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts multiple values in array", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: "ref=9",
        values: ["us", "de", "fr"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing values", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: "ref=9",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing ref", () => {
      const result = schemas.browser_select_option.safeParse({
        values: ["us"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty input", () => {
      const result = schemas.browser_select_option.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-array values (string instead of string[])", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: "ref=9",
        values: "us",
      });
      expect(result.success).toBe(false);
    });

    it("rejects values array with non-string items", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: "ref=9",
        values: [42],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string ref", () => {
      const result = schemas.browser_select_option.safeParse({
        ref: 9,
        values: ["us"],
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 21. browser_handle_dialog ----
  describe("browser_handle_dialog", () => {
    it("accepts required accept: true", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts required accept: false", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: false,
      });
      expect(result.success).toBe(true);
    });

    it("accepts accept with optional promptText", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: true,
        promptText: "my input",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing accept", () => {
      const result = schemas.browser_handle_dialog.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean accept", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: "yes",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string promptText", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: true,
        promptText: 42,
      });
      expect(result.success).toBe(false);
    });

    it("accepts dismiss (accept: false) without promptText", () => {
      const result = schemas.browser_handle_dialog.safeParse({
        accept: false,
      });
      expect(result.success).toBe(true);
    });
  });

  // ---- 22. browser_file_upload ----
  describe("browser_file_upload", () => {
    it("accepts required ref and paths array", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: "ref=11",
        paths: ["/path/to/file.txt"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts multiple paths", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: "ref=11",
        paths: ["/path/to/a.png", "/path/to/b.jpg"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing paths", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: "ref=11",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing ref", () => {
      const result = schemas.browser_file_upload.safeParse({
        paths: ["/path/to/file.txt"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty input", () => {
      const result = schemas.browser_file_upload.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-array paths (string instead of string[])", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: "ref=11",
        paths: "/path/to/file.txt",
      });
      expect(result.success).toBe(false);
    });

    it("rejects paths array with non-string items", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: "ref=11",
        paths: [42],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string ref", () => {
      const result = schemas.browser_file_upload.safeParse({
        ref: 11,
        paths: ["/path/to/file.txt"],
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 23. browser_resize ----
  describe("browser_resize", () => {
    it("accepts required width and height", () => {
      const result = schemas.browser_resize.safeParse({
        width: 1280,
        height: 720,
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional deviceScaleFactor", () => {
      const result = schemas.browser_resize.safeParse({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2,
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing width", () => {
      const result = schemas.browser_resize.safeParse({ height: 720 });
      expect(result.success).toBe(false);
    });

    it("rejects missing height", () => {
      const result = schemas.browser_resize.safeParse({ width: 1280 });
      expect(result.success).toBe(false);
    });

    it("rejects empty input", () => {
      const result = schemas.browser_resize.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-number width", () => {
      const result = schemas.browser_resize.safeParse({
        width: "wide",
        height: 720,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number height", () => {
      const result = schemas.browser_resize.safeParse({
        width: 1280,
        height: "tall",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number deviceScaleFactor", () => {
      const result = schemas.browser_resize.safeParse({
        width: 1280,
        height: 720,
        deviceScaleFactor: "retina",
      });
      expect(result.success).toBe(false);
    });

    it("should accept preset name 'mobile'", () => {
      expect(schemas.browser_resize.safeParse({ preset: "mobile" }).success).toBe(true);
    });

    it("should accept preset name 'tablet'", () => {
      expect(schemas.browser_resize.safeParse({ preset: "tablet" }).success).toBe(true);
    });

    it("should accept preset name 'desktop'", () => {
      expect(schemas.browser_resize.safeParse({ preset: "desktop" }).success).toBe(true);
    });
  });

  // ---- 24. browser_annotated_screenshot ----
  describe("browser_annotated_screenshot", () => {
    it("accepts empty input (all optional)", () => {
      const result = schemas.browser_annotated_screenshot.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts selector string", () => {
      const result = schemas.browser_annotated_screenshot.safeParse({
        selector: "#hero",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string selector", () => {
      const result = schemas.browser_annotated_screenshot.safeParse({
        selector: 42,
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- 25. browser_list ----
  describe("browser_list", () => {
    it("accepts empty input (no params)", () => {
      const result = schemas.browser_list.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts undefined input", () => {
      const result = schemas.browser_list.safeParse(undefined);
      // Should either succeed with defaults or accept empty
      expect(result.success).toBe(true);
    });

    it("ignores unknown properties", () => {
      const result = schemas.browser_list.safeParse({ foo: "bar" });
      expect(result.success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Error Response Format
// ---------------------------------------------------------------------------

describe("Error Response Format", () => {
  let createErrorResponse: typeof import("../src/errors").createErrorResponse;

  beforeEach(async () => {
    const mod = await import("../src/errors");
    createErrorResponse = mod.createErrorResponse;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("not connected to browser returns correct error", () => {
    const response = createErrorResponse("not_connected");
    expect(response).toEqual({
      content: [
        {
          type: "text",
          text: "Not connected to browser. Run browser_connect first.",
        },
      ],
      isError: true,
    });
  });

  it("invalid selector returns a clear error with the selector", () => {
    const response = createErrorResponse("invalid_selector", {
      selector: "###bad",
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain("###bad");
  });

  it("CDP timeout returns error with timeout duration", () => {
    const response = createErrorResponse("cdp_timeout", { timeout: 30000 });
    expect(response).toEqual({
      content: [
        {
          type: "text",
          text: "CDP command timed out after 30000ms",
        },
      ],
      isError: true,
    });
  });

  it("tab not found returns error with targetId", () => {
    const response = createErrorResponse("tab_not_found", {
      targetId: "ABC-123",
    });
    expect(response).toEqual({
      content: [
        {
          type: "text",
          text: "Tab not found: ABC-123",
        },
      ],
      isError: true,
    });
  });

  it("error responses always have isError: true", () => {
    const errorTypes = [
      "not_connected",
      "cdp_timeout",
      "tab_not_found",
    ] as const;

    for (const errorType of errorTypes) {
      const response = createErrorResponse(errorType, {
        timeout: 5000,
        targetId: "x",
      });
      expect(response.isError).toBe(true);
    }
  });

  it("error responses always have content array with text type", () => {
    const response = createErrorResponse("not_connected");
    expect(Array.isArray(response.content)).toBe(true);
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content[0]!.type).toBe("text");
    expect(typeof response.content[0]!.text).toBe("string");
  });

  it("invalid selector error message is human-readable", () => {
    const response = createErrorResponse("invalid_selector", {
      selector: "div>>>.broken",
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain("div>>>.broken");
    expect(response.content[0]!.text.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// 4. CLI (src/cli.ts)
// ---------------------------------------------------------------------------

describe("CLI (src/cli.ts)", () => {
  let runCli: typeof import("../src/cli").runCli;
  let mockCreateServer: ReturnType<typeof vi.fn>;
  let mockRunDoctor: ReturnType<typeof vi.fn>;
  let mockRunInstall: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateServer = vi.fn().mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
    });
    mockRunDoctor = vi.fn().mockResolvedValue(undefined);
    mockRunInstall = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/server", () => ({
      createServer: mockCreateServer,
    }));

    vi.doMock("../src/doctor", () => ({
      runDoctor: mockRunDoctor,
    }));

    vi.doMock("../src/install", () => ({
      runInstall: mockRunInstall,
    }));

    const mod = await import("../src/cli");
    runCli = mod.runCli;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("`browsirai` (no args) starts the MCP server", async () => {
    await runCli([]);
    expect(mockCreateServer).toHaveBeenCalledOnce();
  });

  it("`browsirai doctor` runs diagnostics", async () => {
    await runCli(["doctor"]);
    expect(mockRunDoctor).toHaveBeenCalledOnce();
  });

  it("`browsirai install` runs platform installer", async () => {
    await runCli(["install"]);
    expect(mockRunInstall).toHaveBeenCalledOnce();
  });

  it("`browsirai --version` prints version string", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["--version"]);
    expect(consoleSpy).toHaveBeenCalledOnce();
    const versionOutput = consoleSpy.mock.calls[0]![0] as string;
    expect(versionOutput).toMatch(/\d+\.\d+\.\d+/);
    consoleSpy.mockRestore();
  });

  it("`browsirai` default command does not call doctor or install", async () => {
    await runCli([]);
    expect(mockRunDoctor).not.toHaveBeenCalled();
    expect(mockRunInstall).not.toHaveBeenCalled();
  });

  it("`browsirai doctor` does not start the MCP server", async () => {
    await runCli(["doctor"]);
    expect(mockCreateServer).not.toHaveBeenCalled();
  });

  it("`browsirai install` does not start the MCP server", async () => {
    await runCli(["install"]);
    expect(mockCreateServer).not.toHaveBeenCalled();
  });

  it("unknown command shows help or usage information", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await runCli(["bogus-command"]);

    // Should output help/usage info — check either console.log or console.error
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...errorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");

    // Should mention available commands or show help
    expect(allOutput.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. Config (src/config.ts)
// ---------------------------------------------------------------------------

describe("Config (src/config.ts)", () => {
  let loadConfig: typeof import("../src/config").loadConfig;
  let DEFAULT_CONFIG: typeof import("../src/config").DEFAULT_CONFIG;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/config");
    loadConfig = mod.loadConfig;
    DEFAULT_CONFIG = mod.DEFAULT_CONFIG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ----- Default values -----

  it("DEFAULT_CONFIG has port 9222", () => {
    expect(DEFAULT_CONFIG.chrome.port).toBe(9222);
  });

  it("DEFAULT_CONFIG has commandTimeout 30000", () => {
    expect(DEFAULT_CONFIG.connection.commandTimeout).toBe(30000);
  });

  it("DEFAULT_CONFIG has host 127.0.0.1", () => {
    expect(DEFAULT_CONFIG.chrome.host).toBe("127.0.0.1");
  });

  it("DEFAULT_CONFIG has autoLaunch disabled", () => {
    expect(DEFAULT_CONFIG.chrome.autoLaunch).toBe(false);
  });

  it("DEFAULT_CONFIG has screenshot quality 80", () => {
    expect(DEFAULT_CONFIG.screenshot.quality).toBe(80);
  });

  it("DEFAULT_CONFIG has screenshot maxWidth 1280", () => {
    expect(DEFAULT_CONFIG.screenshot.maxWidth).toBe(1280);
  });

  it("DEFAULT_CONFIG has network maxRequests 100", () => {
    expect(DEFAULT_CONFIG.network.maxRequests).toBe(100);
  });

  it("DEFAULT_CONFIG has connection connectTimeout 5000", () => {
    expect(DEFAULT_CONFIG.connection.connectTimeout).toBe(5000);
  });

  it("DEFAULT_CONFIG has connection reconnectAttempts 3", () => {
    expect(DEFAULT_CONFIG.connection.reconnectAttempts).toBe(3);
  });

  // ----- Config file loading -----

  it("loads config from ~/.browsirai/config.json path", async () => {
    const readSpy = vi.fn().mockImplementation(() => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: readSpy,
        existsSync: vi.fn().mockReturnValue(false),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    mod.loadConfig();

    // Verify it attempted to read from the correct path
    const homedir = (await import("node:os")).homedir();
    const expectedPath = `${homedir}/.browsirai/config.json`;
    const allCalls = [
      ...readSpy.mock.calls.map((c: unknown[]) => String(c[0])),
    ];
    const existsCalls = vi
      .mocked((await import("node:fs")).existsSync)
      .mock.calls.map((c) => String(c[0]));

    const allPaths = [...allCalls, ...existsCalls];
    const accessedConfigPath = allPaths.some((p) =>
      p.includes(".browsirai/config.json")
    );
    expect(accessedConfigPath).toBe(true);
  });

  it("returns defaults when config file does not exist", async () => {
    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            const err = new Error("ENOENT") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return false;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();
    expect(config.chrome.port).toBe(9222);
    expect(config.chrome.host).toBe("127.0.0.1");
    expect(config.connection.commandTimeout).toBe(30000);
  });

  it("merges user config with defaults (partial override)", async () => {
    const userConfig = JSON.stringify({
      chrome: { port: 9333 },
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return userConfig;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return true;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();

    // Overridden value
    expect(config.chrome.port).toBe(9333);
    // Default values preserved (deep merge)
    expect(config.chrome.host).toBe("127.0.0.1");
    expect(config.chrome.autoLaunch).toBe(false);
    expect(config.connection.commandTimeout).toBe(30000);
    expect(config.screenshot.quality).toBe(80);
  });

  it("deep merges nested user config with defaults", async () => {
    const userConfig = JSON.stringify({
      chrome: { port: 9333, host: "192.168.1.100" },
      connection: { commandTimeout: 60000 },
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return userConfig;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return true;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();

    // Overridden values
    expect(config.chrome.port).toBe(9333);
    expect(config.chrome.host).toBe("192.168.1.100");
    expect(config.connection.commandTimeout).toBe(60000);
    // Non-overridden values preserved
    expect(config.chrome.autoLaunch).toBe(false);
    expect(config.connection.connectTimeout).toBe(5000);
    expect(config.connection.reconnectAttempts).toBe(3);
    expect(config.screenshot.quality).toBe(80);
    expect(config.network.maxRequests).toBe(100);
  });

  it("handles malformed config file (use defaults + warn)", async () => {
    const malformedJson = "{ this is not valid json!!!";

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return malformedJson;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return true;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const mod = await import("../src/config");
    const config = mod.loadConfig();

    // Should fall back to defaults
    expect(config.chrome.port).toBe(9222);
    expect(config.chrome.host).toBe("127.0.0.1");
    expect(config.connection.commandTimeout).toBe(30000);

    // Should have warned about the malformed config
    const allWarnings = [
      ...warnSpy.mock.calls.map((c) => String(c[0])),
      ...errorSpy.mock.calls.map((c) => String(c[0])),
    ];
    const didWarn = allWarnings.some(
      (msg) =>
        msg.includes("config") ||
        msg.includes("parse") ||
        msg.includes("invalid") ||
        msg.includes("malformed") ||
        msg.includes("JSON") ||
        msg.includes("error")
    );
    expect(didWarn).toBe(true);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("validates config with Zod (rejects invalid types)", async () => {
    // Config with wrong types should be caught by Zod validation
    const invalidConfig = JSON.stringify({
      chrome: { port: "not-a-number", host: 12345 },
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return invalidConfig;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return true;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const mod = await import("../src/config");
    const config = mod.loadConfig();

    // Should fall back to defaults when Zod validation fails
    expect(config.chrome.port).toBe(9222);
    expect(config.chrome.host).toBe("127.0.0.1");

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ----- Environment variable overrides -----

  it("BROWSIR_CONFIG env var overrides config file path", async () => {
    const customPath = "/tmp/custom-browsirai-config.json";
    const customConfig = JSON.stringify({
      chrome: { port: 9444 },
    });

    const originalEnv = process.env.BROWSIR_CONFIG;
    process.env.BROWSIR_CONFIG = customPath;

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path) === customPath) {
            return customConfig;
          }
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          return String(path) === customPath;
        }),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();

    expect(config.chrome.port).toBe(9444);

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.BROWSIR_CONFIG;
    } else {
      process.env.BROWSIR_CONFIG = originalEnv;
    }
  });

  it("CHROME_DEBUG_PORT env var overrides chrome port in config", async () => {
    const originalEnv = process.env.CHROME_DEBUG_PORT;
    process.env.CHROME_DEBUG_PORT = "9555";

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation(() => {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }),
        existsSync: vi.fn().mockReturnValue(false),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();

    expect(config.chrome.port).toBe(9555);

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CHROME_DEBUG_PORT;
    } else {
      process.env.CHROME_DEBUG_PORT = originalEnv;
    }
  });

  it("CHROME_DEBUG_PORT overrides port from config file", async () => {
    const originalEnv = process.env.CHROME_DEBUG_PORT;
    process.env.CHROME_DEBUG_PORT = "9666";

    const userConfig = JSON.stringify({
      chrome: { port: 9333 },
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        (await importOriginal()) as typeof import("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return userConfig;
          }
          return actual.readFileSync(path);
        }),
        existsSync: vi.fn().mockImplementation((path: string) => {
          if (String(path).includes("config.json")) {
            return true;
          }
          return actual.existsSync(path);
        }),
      };
    });

    vi.resetModules();
    const mod = await import("../src/config");
    const config = mod.loadConfig();

    // Env var should take precedence over config file
    expect(config.chrome.port).toBe(9666);

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CHROME_DEBUG_PORT;
    } else {
      process.env.CHROME_DEBUG_PORT = originalEnv;
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Platform Detection (src/adapters/detect.ts)
// ---------------------------------------------------------------------------

describe("Platform Detection (src/adapters/detect.ts)", () => {
  let detectPlatform: typeof import("../src/adapters/detect").detectPlatform;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/adapters/detect");
    detectPlatform = mod.detectPlatform;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("detects Claude Code when CLAUDE_PROJECT_DIR is set", () => {
    const originalEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = "/Users/test/project";

    vi.resetModules();

    // Re-import to pick up env change
    const result = detectPlatform();

    expect(result.platform).toBe("claude-code");

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = originalEnv;
    }
  });

  it("Claude Code detection has high confidence", () => {
    const originalEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = "/Users/test/project";

    const result = detectPlatform();

    expect(result.confidence).toBe("high");

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = originalEnv;
    }
  });

  it("detects Cursor when CURSOR_TRACE_ID is set", () => {
    const originalClaudeEnv = process.env.CLAUDE_PROJECT_DIR;
    const originalCursorEnv = process.env.CURSOR_TRACE_ID;

    delete process.env.CLAUDE_PROJECT_DIR;
    process.env.CURSOR_TRACE_ID = "trace-abc-123";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("cursor");

    // Restore env
    if (originalClaudeEnv === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = originalClaudeEnv;
    }
    if (originalCursorEnv === undefined) {
      delete process.env.CURSOR_TRACE_ID;
    } else {
      process.env.CURSOR_TRACE_ID = originalCursorEnv;
    }
  });

  it("Cursor detection has high confidence", () => {
    const originalClaudeEnv = process.env.CLAUDE_PROJECT_DIR;
    const originalCursorEnv = process.env.CURSOR_TRACE_ID;

    delete process.env.CLAUDE_PROJECT_DIR;
    process.env.CURSOR_TRACE_ID = "trace-abc-123";

    const result = detectPlatform();

    expect(result.confidence).toBe("high");

    // Restore env
    if (originalClaudeEnv === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = originalClaudeEnv;
    }
    if (originalCursorEnv === undefined) {
      delete process.env.CURSOR_TRACE_ID;
    } else {
      process.env.CURSOR_TRACE_ID = originalCursorEnv;
    }
  });

  it("falls back to generic platform when no env vars are set", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("generic");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("generic platform has low confidence", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    const result = detectPlatform();

    expect(result.confidence).toBe("low");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("detection result includes a reason string", () => {
    const result = detectPlatform();
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("detection result platform is a valid PlatformId", () => {
    const validPlatforms = [
      "claude-code",
      "cursor",
      "gemini-cli",
      "windsurf",
      "cline",
      "vscode-copilot",
      "opencode",
      "zed",
      "continue",
      "generic",
    ];
    const result = detectPlatform();
    expect(validPlatforms).toContain(result.platform);
  });

  it("detection result confidence is a valid level", () => {
    const validConfidences = ["high", "medium", "low"];
    const result = detectPlatform();
    expect(validConfidences).toContain(result.confidence);
  });

  // --- NEW: Expanded platform detection tests ---

  it("should detect gemini-cli via GEMINI_CLI env var", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
      "GEMINI_CLI",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "OPENCODE_CONFIG",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.GEMINI_CLI = "1";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("gemini-cli");
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("GEMINI_CLI");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should detect opencode via OPENCODE_CONFIG env var", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
      "GEMINI_CLI",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "OPENCODE_CONFIG",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.OPENCODE_CONFIG = "/home/user/.config/opencode";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("opencode");
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("OPENCODE_CONFIG");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should detect vscode-copilot via VSCODE_PID env var", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
      "GEMINI_CLI",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "OPENCODE_CONFIG",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.VSCODE_PID = "12345";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("vscode-copilot");
    expect(result.confidence).toBe("medium");
    expect(result.reason).toContain("VSCODE_PID");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should detect vscode-copilot via TERM_PROGRAM=vscode", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
      "GEMINI_CLI",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "OPENCODE_CONFIG",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.TERM_PROGRAM = "vscode";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("vscode-copilot");
    expect(result.confidence).toBe("medium");
    expect(result.reason).toContain("TERM_PROGRAM");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should prioritize claude-code over cursor when both env vars set", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToSave = ["CLAUDE_PROJECT_DIR", "CURSOR_TRACE_ID"];

    for (const key of envVarsToSave) {
      savedEnv[key] = process.env[key];
    }

    process.env.CLAUDE_PROJECT_DIR = "/Users/test/project";
    process.env.CURSOR_TRACE_ID = "trace-abc-123";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("claude-code");
    expect(result.confidence).toBe("high");

    // Restore env
    for (const key of envVarsToSave) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should prioritize gemini-cli over generic", () => {
    const savedEnv: Record<string, string | undefined> = {};
    const envVarsToRemove = [
      "CLAUDE_PROJECT_DIR",
      "CURSOR_TRACE_ID",
      "GEMINI_CLI",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "OPENCODE_CONFIG",
    ];

    for (const key of envVarsToRemove) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.GEMINI_CLI = "1";

    vi.resetModules();

    const result = detectPlatform();

    expect(result.platform).toBe("gemini-cli");
    expect(result.platform).not.toBe("generic");

    // Restore env
    for (const key of envVarsToRemove) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should return platform with confidence level", () => {
    const result = detectPlatform();

    expect(result).toHaveProperty("confidence");
    expect(["high", "medium", "low"]).toContain(result.confidence);
  });

  it("should include reason string explaining detection", () => {
    const result = detectPlatform();

    expect(result).toHaveProperty("reason");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Platform Install Config (src/adapters/detect.ts)
// ---------------------------------------------------------------------------

describe("Platform Install Config", () => {
  let getInstallConfig: typeof import("../src/adapters/detect").getInstallConfig;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/adapters/detect");
    getInstallConfig = mod.getInstallConfig;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("should return correct config path for claude-code", () => {
    const config = getInstallConfig("claude-code");
    expect(config.configPath).toBe(".mcp.json");
  });

  it("should return correct config path for cursor", () => {
    const config = getInstallConfig("cursor");
    expect(config.configPath).toBe(".cursor/mcp.json");
  });

  it("should return correct config path for gemini-cli", () => {
    const config = getInstallConfig("gemini-cli");
    expect(config.configPath).toBe("~/.gemini/settings.json");
  });

  it("should return correct config path for windsurf", () => {
    const config = getInstallConfig("windsurf");
    expect(config.configPath).toBe("~/.codeium/windsurf/mcp_config.json");
  });

  it("should return correct config path for cline", () => {
    const config = getInstallConfig("cline");
    expect(config.configPath).toContain("globalStorage/saoudrizwan.claude-dev");
  });

  it("should return correct config path for vscode-copilot", () => {
    const config = getInstallConfig("vscode-copilot");
    expect(config.configPath).toBe(".vscode/mcp.json");
  });

  it("should return correct config path for opencode", () => {
    const config = getInstallConfig("opencode");
    expect(config.configPath).toBe("opencode.json");
  });

  it("should return correct config path for zed", () => {
    const config = getInstallConfig("zed");
    expect(config.configPath).toBe("~/.config/zed/settings.json");
  });

  it("should return correct config path for continue", () => {
    const config = getInstallConfig("continue");
    expect(config.configPath).toBe("~/.continue/config.yaml");
  });

  it("should return correct config key for each platform", () => {
    // Most platforms use "mcpServers"
    expect(getInstallConfig("claude-code").configKey).toBe("mcpServers");
    expect(getInstallConfig("cursor").configKey).toBe("mcpServers");
    expect(getInstallConfig("gemini-cli").configKey).toBe("mcpServers");
    expect(getInstallConfig("windsurf").configKey).toBe("mcpServers");
    expect(getInstallConfig("opencode").configKey).toBe("mcpServers");

    // VS Code uses "mcp" key at top-level with "servers" nested
    expect(getInstallConfig("vscode-copilot").configKey).toBe("servers");

    // Zed uses "context_servers"
    expect(getInstallConfig("zed").configKey).toBe("context_servers");

    // Continue uses "mcpServers"
    expect(getInstallConfig("continue").configKey).toBe("mcpServers");
  });

  it("should generate valid MCP server entry JSON for stdio transport", () => {
    const config = getInstallConfig("claude-code");

    expect(config.serverEntry).toBeDefined();
    expect(config.serverEntry.command).toBe("npx");
    expect(config.serverEntry.args).toContain("browsirai");
    expect(config.serverEntry.type).toBeUndefined(); // stdio is the default, type field optional
  });
});

// ---------------------------------------------------------------------------
// 8. Install Command (src/install.ts)
// ---------------------------------------------------------------------------

describe("Install Command (src/install.ts)", () => {
  let runInstall: typeof import("../src/install").runInstall;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockConfirm: ReturnType<typeof vi.fn>;
  let mockIntro: ReturnType<typeof vi.fn>;
  let mockOutro: ReturnType<typeof vi.fn>;
  let mockNote: ReturnType<typeof vi.fn>;
  let mockSpinner: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;
  let mockDetectPlatform: ReturnType<typeof vi.fn>;
  let mockGetInstallConfig: ReturnType<typeof vi.fn>;
  let mockReadFileSync: ReturnType<typeof vi.fn>;
  let mockWriteFileSync: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockMkdirSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    // Clear leftover mock registrations from other describe blocks (e.g. CLI tests)
    vi.doUnmock("../src/install");

    mockSelect = vi.fn();
    mockConfirm = vi.fn();
    mockIntro = vi.fn();
    mockOutro = vi.fn();
    mockNote = vi.fn();
    mockSpinner = vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    mockIsCancel = vi.fn().mockReturnValue(false);

    vi.doMock("@clack/prompts", () => ({
      select: mockSelect,
      confirm: mockConfirm,
      intro: mockIntro,
      outro: mockOutro,
      note: mockNote,
      spinner: mockSpinner,
      isCancel: mockIsCancel,
      cancel: vi.fn(),
      log: { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), message: vi.fn(), step: vi.fn() },
    }));

    mockDetectPlatform = vi.fn().mockReturnValue({
      platform: "claude-code",
      confidence: "high",
      reason: "CLAUDE_PROJECT_DIR is set",
    });

    mockGetInstallConfig = vi.fn().mockReturnValue({
      configPath: ".mcp.json",
      configKey: "mcpServers",
      serverEntry: { command: "npx", args: ["-y", "browsirai"] },
    });

    vi.doMock("../src/adapters/detect", () => ({
      detectPlatform: mockDetectPlatform,
      getInstallConfig: mockGetInstallConfig,
    }));

    mockReadFileSync = vi.fn();
    mockWriteFileSync = vi.fn();
    mockExistsSync = vi.fn().mockReturnValue(false);
    mockMkdirSync = vi.fn();

    vi.doMock("node:fs", () => ({
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
      cpSync: vi.fn(),
      default: {
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync,
        existsSync: mockExistsSync,
        mkdirSync: mockMkdirSync,
        cpSync: vi.fn(),
      },
    }));

    // Mock chrome-launcher to prevent real Chrome interaction during install tests
    vi.doMock("../src/chrome-launcher", () => ({
      connectChrome: vi.fn().mockResolvedValue({ success: false, port: 9222, activePortFound: false, error: "mocked" }),
      openChromeInspect: vi.fn().mockReturnValue(false),
      findChrome: vi.fn().mockReturnValue(null),
      isPortReachable: vi.fn().mockResolvedValue(false),
      readDevToolsActivePort: vi.fn().mockReturnValue(null),
      getDefaultChromeDataDir: vi.fn().mockReturnValue("/tmp/browsirai-test"),
    }));
    vi.doMock("../src/chrome-launcher.js", () => ({
      connectChrome: vi.fn().mockResolvedValue({ success: false, port: 9222, activePortFound: false, error: "mocked" }),
      openChromeInspect: vi.fn().mockReturnValue(false),
      findChrome: vi.fn().mockReturnValue(null),
      isPortReachable: vi.fn().mockResolvedValue(false),
      readDevToolsActivePort: vi.fn().mockReturnValue(null),
      getDefaultChromeDataDir: vi.fn().mockReturnValue("/tmp/browsirai-test"),
    }));

    const mod = await import("../src/install");
    runInstall = mod.runInstall;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("runInstall", () => {
    it("should auto-detect platform and show it as default", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockDetectPlatform).toHaveBeenCalled();
      // The select prompt should include the detected platform as the initial/default value
      const selectCall = mockSelect.mock.calls[0]![0] as {
        initialValue?: string;
        options?: Array<{ value: string }>;
      };
      expect(selectCall.initialValue).toBe("claude-code");
    });

    it("should present all supported platforms in select prompt", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      const selectCall = mockSelect.mock.calls[0]![0] as {
        options: Array<{ value: string; label: string }>;
      };
      const platformValues = selectCall.options.map(
        (o: { value: string }) => o.value
      );
      expect(platformValues).toContain("claude-code");
      expect(platformValues).toContain("cursor");
      expect(platformValues).toContain("gemini-cli");
      expect(platformValues).toContain("vscode-copilot");
      expect(platformValues).toContain("opencode");
      expect(platformValues).toContain("zed");
    });

    it("should present scope options (project, global)", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      // Second select call should be scope selection
      expect(mockSelect).toHaveBeenCalledTimes(2);
      const scopeCall = mockSelect.mock.calls[1]![0] as {
        options: Array<{ value: string }>;
      };
      const scopeValues = scopeCall.options.map(
        (o: { value: string }) => o.value
      );
      expect(scopeValues).toContain("project");
      expect(scopeValues).toContain("global");
    });

    it("should generate correct config JSON for claude-code", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      expect(writtenContent).toHaveProperty("mcpServers");
      expect(writtenContent.mcpServers).toHaveProperty("browsirai");
      expect(writtenContent.mcpServers.browsirai.command).toBe("npx");
    });

    it("should generate correct config JSON for cursor", async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: ".cursor/mcp.json",
        configKey: "mcpServers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("cursor");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      expect(writtenContent).toHaveProperty("mcpServers");
      expect(writtenContent.mcpServers).toHaveProperty("browsirai");
    });

    it("should generate correct config JSON for gemini-cli", async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: "~/.gemini/settings.json",
        configKey: "mcpServers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("gemini-cli");
      mockSelect.mockResolvedValueOnce("global");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      expect(writtenContent).toHaveProperty("mcpServers");
      expect(writtenContent.mcpServers).toHaveProperty("browsirai");
    });

    it('should generate correct config JSON for vscode-copilot (uses "servers" key not "mcpServers")', async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: ".vscode/mcp.json",
        configKey: "servers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("vscode-copilot");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      // VS Code Copilot uses "servers" key, not "mcpServers"
      expect(writtenContent).toHaveProperty("servers");
      expect(writtenContent).not.toHaveProperty("mcpServers");
      expect(writtenContent.servers).toHaveProperty("browsirai");
    });

    it('should generate correct config JSON for opencode (uses "mcp" key)', async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: "opencode.json",
        configKey: "mcp",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("opencode");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      expect(writtenContent).toHaveProperty("mcp");
      expect(writtenContent.mcp).toHaveProperty("browsirai");
    });

    it('should generate correct config JSON for zed (uses "context_servers" key)', async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: "~/.config/zed/settings.json",
        configKey: "context_servers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("zed");
      mockSelect.mockResolvedValueOnce("global");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      expect(writtenContent).toHaveProperty("context_servers");
      expect(writtenContent.context_servers).toHaveProperty("browsirai");
    });

    it("should write config to correct file path for project scope", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenPath = mockWriteFileSync.mock.calls[0]![0] as string;
      // Project scope: relative path (current working directory)
      expect(writtenPath).toContain(".mcp.json");
      expect(writtenPath).not.toContain("~");
    });

    it("should write config to correct file path for global scope", async () => {
      mockGetInstallConfig.mockReturnValue({
        configPath: "~/.gemini/settings.json",
        configKey: "mcpServers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      });
      mockSelect.mockResolvedValueOnce("gemini-cli");
      mockSelect.mockResolvedValueOnce("global");

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenPath = mockWriteFileSync.mock.calls[0]![0] as string;
      // Global scope: should resolve ~ to home directory
      expect(writtenPath).toContain(".gemini");
      expect(writtenPath).toContain("settings.json");
    });

    it("should handle cancellation gracefully (Ctrl+C)", async () => {
      mockSelect.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel.mockReturnValue(true);

      // Should not throw, should exit gracefully
      await expect(runInstall()).resolves.not.toThrow();

      // Should not write any files
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("should not overwrite existing config without confirmation", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ mcpServers: { otherServer: {} } })
      );
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");
      mockConfirm.mockResolvedValueOnce(false); // User says no to overwrite

      await runInstall();

      // Should ask for confirmation before overwriting
      expect(mockConfirm).toHaveBeenCalled();
      // Should not write if user declines
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("should merge with existing config if file already exists", async () => {
      const existingConfig = {
        mcpServers: {
          otherServer: { command: "node", args: ["other.js"] },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");
      mockConfirm.mockResolvedValueOnce(true); // User confirms merge

      await runInstall();

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        mockWriteFileSync.mock.calls[0]![1] as string
      );
      // Should preserve existing entries
      expect(writtenContent.mcpServers.otherServer).toBeDefined();
      // Should add browsirai
      expect(writtenContent.mcpServers.browsirai).toBeDefined();
    });

    it("should show success message with file path after install", async () => {
      mockSelect.mockResolvedValueOnce("claude-code");
      mockSelect.mockResolvedValueOnce("project");

      await runInstall();

      // Should call outro with success message
      expect(mockOutro.mock.calls.length).toBeGreaterThan(0);

      // Config should be written to the correct file
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Doctor Command (src/doctor.ts)
// ---------------------------------------------------------------------------

describe("Doctor Command (src/doctor.ts)", () => {
  let runDoctor: typeof import("../src/doctor").runDoctor;
  let mockDetectPlatform: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockReadFileSync: ReturnType<typeof vi.fn>;
  let mockExecSync: ReturnType<typeof vi.fn>;
  let mockCreateConnection: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    // Clear leftover mock registrations from other describe blocks (e.g. CLI tests)
    vi.doUnmock("../src/doctor");

    mockDetectPlatform = vi.fn().mockReturnValue({
      platform: "claude-code",
      confidence: "high",
      reason: "CLAUDE_PROJECT_DIR is set",
    });

    vi.doMock("../src/adapters/detect", () => ({
      detectPlatform: mockDetectPlatform,
      getInstallConfig: vi.fn().mockReturnValue({
        configPath: ".mcp.json",
        configKey: "mcpServers",
        serverEntry: { command: "npx", args: ["-y", "browsirai"] },
      }),
    }));

    mockExistsSync = vi.fn().mockReturnValue(true);
    mockReadFileSync = vi.fn().mockReturnValue(
      JSON.stringify({ mcpServers: { browsirai: { command: "npx" } } })
    );

    vi.doMock("node:fs", () => ({
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
      default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
      },
    }));

    mockExecSync = vi.fn();

    vi.doMock("node:child_process", () => ({
      execSync: mockExecSync,
      default: { execSync: mockExecSync },
    }));

    // Mock net.createConnection for CDP port check
    const mockSocket = {
      on: vi.fn().mockImplementation(function (
        this: { on: ReturnType<typeof vi.fn> },
        event: string,
        cb: () => void
      ) {
        if (event === "connect") setTimeout(cb, 0);
        return this;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    mockCreateConnection = vi.fn().mockReturnValue(mockSocket);

    vi.doMock("node:net", () => ({
      createConnection: mockCreateConnection,
      default: { createConnection: mockCreateConnection },
    }));

    // Mock chrome-launcher to prevent real Chrome interaction during doctor tests
    vi.doMock("../src/chrome-launcher", () => ({
      connectChrome: vi.fn().mockResolvedValue({ success: false, port: 9222, activePortFound: false, error: "Chrome remote debugging is not enabled. Open chrome://inspect/#remote-debugging in Chrome to enable it." }),
      openChromeInspect: vi.fn().mockReturnValue(false),
      readDevToolsActivePort: vi.fn().mockReturnValue(null),
      findChrome: vi.fn().mockReturnValue(null),
      isPortReachable: vi.fn().mockResolvedValue(false),
      getDefaultChromeDataDir: vi.fn().mockReturnValue("/tmp/browsirai-test"),
    }));
    vi.doMock("../src/chrome-launcher.js", () => ({
      connectChrome: vi.fn().mockResolvedValue({ success: false, port: 9222, activePortFound: false, error: "Chrome remote debugging is not enabled. Open chrome://inspect/#remote-debugging in Chrome to enable it." }),
      openChromeInspect: vi.fn().mockReturnValue(false),
      readDevToolsActivePort: vi.fn().mockReturnValue(null),
      findChrome: vi.fn().mockReturnValue(null),
      isPortReachable: vi.fn().mockResolvedValue(false),
      getDefaultChromeDataDir: vi.fn().mockReturnValue("/tmp/browsirai-test"),
    }));

    const mod = await import("../src/doctor");
    runDoctor = mod.runDoctor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("runDoctor", () => {
    it("should check if Chrome/Chromium is installed", async () => {
      const result = await runDoctor();

      // Since findChrome is mocked, we verify that the mock was called
      const mod = await import("../src/chrome-launcher.js");
      expect(mod.findChrome).toHaveBeenCalled();
    });

    it("should check if Node.js version >= 22", async () => {
      const result = await runDoctor();

      // Doctor should verify Node.js version meets minimum requirement
      // This can be checked via process.version or execSync('node --version')
      expect(result).toBeDefined();
      // The result should contain a check for Node.js version
      const checks = Array.isArray(result) ? result : (result as { checks?: unknown[] })?.checks;
      if (checks) {
        const nodeCheck = (checks as Array<{ label: string }>).find(
          (c) => c.label.toLowerCase().includes("node")
        );
        expect(nodeCheck).toBeDefined();
      }
    });

    it("should check CDP connection status", async () => {
      const result = await runDoctor();

      // Should include a CDP connection check in results
      expect(Array.isArray(result)).toBe(true);
      const cdpCheck = (result as Array<{ label: string }>).find(
        (c) => c.label.toLowerCase().includes("cdp")
      );
      expect(cdpCheck).toBeDefined();
    });

    it("should detect current platform", async () => {
      const result = await runDoctor();

      expect(mockDetectPlatform).toHaveBeenCalled();
    });

    it("should check if browsirai is configured in platform config", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            browsirai: { command: "npx", args: ["-y", "browsirai"] },
          },
        })
      );

      const result = await runDoctor();

      // Should check for browsirai entry in config file
      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadFileSync).toHaveBeenCalled();
    });

    it("should report all checks with pass/fail status", async () => {
      const result = await runDoctor();

      // Result should be an array or object containing diagnostic checks
      expect(result).toBeDefined();

      // Each check should have ok/pass status and a label
      if (Array.isArray(result)) {
        for (const check of result) {
          expect(check).toHaveProperty("ok");
          expect(check).toHaveProperty("label");
          expect(typeof check.ok).toBe("boolean");
          expect(typeof check.label).toBe("string");
        }
        expect(result.length).toBeGreaterThanOrEqual(3); // At minimum: Chrome, Node, CDP
      }
    });

    it("should return diagnostic results array", async () => {
      mockExecSync.mockReturnValue(Buffer.from("/usr/bin/google-chrome"));

      const result = await runDoctor();

      // runDoctor must return a meaningful result (not undefined)
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      // Should have at least 3 checks: Chrome, Node, CDP
      expect((result as unknown[]).length).toBeGreaterThanOrEqual(3);
    });

    it("should return exit code 1 when any check fails", async () => {
      // Simulate Chrome not found
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = await runDoctor();

      // runDoctor must return a meaningful result (not undefined)
      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      // When any check fails, exit code should be 1
      if (typeof result === "object" && "exitCode" in (result as object)) {
        expect((result as { exitCode: number }).exitCode).toBe(1);
      } else {
        // Must be an array of diagnostic results where at least one failed
        expect(Array.isArray(result)).toBe(true);
        const anyFailed = (result as Array<{ ok: boolean }>).some(
          (c) => c.ok === false
        );
        expect(anyFailed).toBe(true);
      }
    });

    it("should show Chrome path when found", async () => {
      const chromePath = "/usr/bin/google-chrome";
      const mod = await import("../src/chrome-launcher.js");
      vi.mocked(mod.findChrome).mockReturnValue(chromePath);

      const result = await runDoctor();

      // runDoctor must return diagnostic results
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      const checks = result as Array<{ label: string; message?: string; ok: boolean }>;
      const chromeCheck = checks.find(
        (c) =>
          c.label.toLowerCase().includes("chrome") ||
          c.label.toLowerCase().includes("chromium")
      );
      expect(chromeCheck).toBeDefined();
      expect(chromeCheck!.message || chromeCheck!.label).toContain(chromePath);
    });

    it('should suggest "chrome://inspect/#remote-debugging" when CDP unreachable', async () => {
      // Make execSync throw for all calls so Chrome is NOT found
      // This prevents auto-launch attempt
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      // Simulate CDP port unreachable
      const mockErrorSocket = {
        on: vi.fn().mockImplementation(function (
          this: { on: ReturnType<typeof vi.fn> },
          event: string,
          cb: (err?: Error) => void
        ) {
          if (event === "error")
            setTimeout(() => cb(new Error("ECONNREFUSED")), 0);
          return this;
        }),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
      };
      mockCreateConnection.mockReturnValue(mockErrorSocket);

      const result = await runDoctor();

      // runDoctor must return diagnostic results
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      const checks = result as Array<{ label: string; message?: string; ok: boolean }>;
      const cdpCheck = checks.find(
        (c) =>
          c.label.toLowerCase().includes("cdp") ||
          c.label.toLowerCase().includes("port")
      );
      expect(cdpCheck).toBeDefined();
      expect(cdpCheck!.ok).toBe(false);
      expect(cdpCheck!.message).toContain("chrome://inspect");

    });
  });
});

// ---------------------------------------------------------------------------
// 10. Tool Design Principles
// ---------------------------------------------------------------------------

describe("Tool Design Principles", () => {
  let schemas: Record<string, z.ZodType>;

  beforeEach(async () => {
    const mod = await import("../src/tools/index");
    schemas = mod.schemas;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("all observation tools should have optional tabId parameter", () => {
    // Tools with all-optional params accept empty input
    const optionalOnlyTools = ['browser_snapshot', 'browser_screenshot', 'browser_html', 'browser_tabs', 'browser_console_messages', 'browser_network_requests'];
    for (const tool of optionalOnlyTools) {
      const result = schemas[tool].safeParse({});
      expect(result.success).toBe(true);
    }
    // browser_evaluate requires expression, but tabId is still optional
    const evalResult = schemas.browser_evaluate.safeParse({ expression: "1+1" });
    expect(evalResult.success).toBe(true);
  });

  it("all interaction tools should have optional tabId parameter", () => {
    // Tools that require other params - provide minimal valid input
    const result1 = schemas.browser_click.safeParse({ ref: "@e1" });
    expect(result1.success).toBe(true);
    // tabId not required - should work without it
  });
});

// ---------------------------------------------------------------------------
// 11. Network Intercept Tool Schema Validation — browser_route, browser_abort, browser_unroute
// ---------------------------------------------------------------------------

describe("Network Intercept Tool Schema Validation", () => {
  let schemas: Record<string, z.ZodType>;

  beforeEach(async () => {
    const mod = await import("../src/tools/index");
    schemas = mod.schemas;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ---- browser_route ----
  describe("browser_route", () => {
    it("accepts valid url and body (required fields)", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com/users",
        body: '{"users": []}',
      });
      expect(result.success).toBe(true);
    });

    it("accepts url, body, and optional status", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com/not-found",
        body: '{"error": "not found"}',
        status: 404,
      });
      expect(result.success).toBe(true);
    });

    it("accepts url, body, and optional headers", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com/data",
        body: "OK",
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "value",
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts all fields together", () => {
      const result = schemas.browser_route.safeParse({
        url: "**/api/**",
        body: '{"mocked": true}',
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = schemas.browser_route.safeParse({
        body: '{"users": []}',
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing body", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com/users",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string url", () => {
      const result = schemas.browser_route.safeParse({
        url: 12345,
        body: "test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string body", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com",
        body: 12345,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number status", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com",
        body: "test",
        status: "200",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-object headers", () => {
      const result = schemas.browser_route.safeParse({
        url: "https://api.example.com",
        body: "test",
        headers: "Content-Type: application/json",
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- browser_abort ----
  describe("browser_abort", () => {
    it("accepts valid url (required field)", () => {
      const result = schemas.browser_abort.safeParse({
        url: "https://ads.example.com/*",
      });
      expect(result.success).toBe(true);
    });

    it("accepts glob URL patterns", () => {
      const result = schemas.browser_abort.safeParse({
        url: "**/analytics/**",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = schemas.browser_abort.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string url", () => {
      const result = schemas.browser_abort.safeParse({ url: 12345 });
      expect(result.success).toBe(false);
    });
  });

  // ---- browser_unroute ----
  describe("browser_unroute", () => {
    it("accepts url to remove a specific intercept", () => {
      const result = schemas.browser_unroute.safeParse({
        url: "https://api.example.com/users",
      });
      expect(result.success).toBe(true);
    });

    it("accepts {all: true} to remove all intercepts", () => {
      const result = schemas.browser_unroute.safeParse({ all: true });
      expect(result.success).toBe(true);
    });

    it("accepts url and all together", () => {
      // Edge case — url + all is valid (all takes precedence in implementation)
      const result = schemas.browser_unroute.safeParse({
        url: "https://api.example.com/users",
        all: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty input (must provide url or all)", () => {
      const result = schemas.browser_unroute.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string url", () => {
      const result = schemas.browser_unroute.safeParse({ url: 12345 });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean all", () => {
      const result = schemas.browser_unroute.safeParse({ all: "true" });
      expect(result.success).toBe(false);
    });
  });
});
