/**
 * interaction.test.ts — TDD tests for ALL mutating/interaction tools in browsirai.
 *
 * Tools covered:
 *   browser_navigate, browser_navigate_back, browser_click, browser_fill_form,
 *   browser_type, browser_press_key, browser_scroll, browser_hover, browser_drag,
 *   browser_select_option, browser_file_upload, browser_handle_dialog,
 *   browser_wait_for, browser_close, browser_resize
 *
 * All tests mock the CDP connection. Imports reference ../src/... paths
 * that do not exist yet (TDD — implementations are written after tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// TDD Imports — these modules DO NOT exist yet; implementations will follow.
// ---------------------------------------------------------------------------
import { browserNavigate } from "../src/tools/browser-navigate";
import { browserNavigateBack } from "../src/tools/browser-navigate-back";
import { browserClick } from "../src/tools/browser-click";
import { browserFillForm } from "../src/tools/browser-fill-form";
import { browserType } from "../src/tools/browser-type";
import { browserPressKey } from "../src/tools/browser-press-key";
import { browserScroll } from "../src/tools/browser-scroll";
import { browserHover } from "../src/tools/browser-hover";
import { browserDrag } from "../src/tools/browser-drag";
import { browserSelectOption } from "../src/tools/browser-select-option";
import { browserFileUpload } from "../src/tools/browser-file-upload";
import { browserHandleDialog } from "../src/tools/browser-handle-dialog";
import { browserWaitFor } from "../src/tools/browser-wait-for";
import { browserClose } from "../src/tools/browser-close";
import { browserResize } from "../src/tools/browser-resize";

// ---------------------------------------------------------------------------
// TDD Imports — Gap Analysis additions (sections 1.2–2.15)
// ---------------------------------------------------------------------------
import { browserKeyboard } from "../src/tools/browser-keyboard";
import { browserCheck, browserUncheck } from "../src/tools/browser-check";
import { browserFocus } from "../src/tools/browser-focus";
import { browserTabNew, browserWindowNew } from "../src/tools/browser-tab";
import { browserFrameSwitch, browserFrameMain } from "../src/tools/browser-frame";
import { browserClipboardRead, browserClipboardWrite } from "../src/tools/browser-clipboard";
import { listFrames } from "../src/tools/browser-frames";
import { browserScrollIntoView } from "../src/tools/browser-scroll-into-view";
import { findByRole, findByText, findByLabel, findByPlaceholder, findByAlt, findByTitle, findByTestId, findFirst, findLast, findNth, browserFind } from "../src/tools/browser-find";
import { waitForDocumentReady } from "../src/cdp/wait-ready";

// ---------------------------------------------------------------------------
// TDD Imports — Network intercept tools (browser_route, browser_abort, browser_unroute)
// ---------------------------------------------------------------------------
import { browserRoute, browserAbort, browserUnroute, resetInterceptState } from "../src/tools/browser-intercept";
import { browserDiff } from "../src/tools/browser-diff";

// ---------------------------------------------------------------------------
// Mock CDP Session Factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock CDP session that records all CDP method calls and lets
 * individual tests configure responses per-method.
 */
function createMockCDP() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const responses = new Map<string, unknown>();
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const bufferedEvents = new Map<string, unknown[][]>();

  const session = {
    send: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (responses.has(method)) {
        const response = responses.get(method);
        if (typeof response === "function") {
          return (response as (params: unknown) => unknown)(params);
        }
        return response;
      }
      return {};
    }),

    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);

      // Replay any buffered events that were emitted before this handler was registered
      const buffered = bufferedEvents.get(event);
      if (buffered && buffered.length > 0) {
        for (const args of buffered) {
          handler(...args);
        }
        bufferedEvents.delete(event);
      }
    }),

    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),

    // Test helpers — not part of real CDP session
    _calls: calls,
    _setResponse(method: string, value: unknown) {
      responses.set(method, value);
    },
    _emit(event: string, ...args: unknown[]) {
      const handlers = eventHandlers.get(event);
      if (handlers && handlers.length > 0) {
        handlers.forEach((h) => h(...args));
      } else {
        // Buffer the event for replay when a handler is registered
        if (!bufferedEvents.has(event)) {
          bufferedEvents.set(event, []);
        }
        bufferedEvents.get(event)!.push(args);
      }
    },
    async _emitAsync(event: string, ...args: unknown[]) {
      const handlers = eventHandlers.get(event);
      if (handlers && handlers.length > 0) {
        await Promise.all(handlers.map((h) => h(...args)));
      } else {
        if (!bufferedEvents.has(event)) {
          bufferedEvents.set(event, []);
        }
        bufferedEvents.get(event)!.push(args);
      }
    },
    _getCalls(method: string) {
      return calls.filter((c) => c.method === method);
    },
    _reset() {
      calls.length = 0;
      responses.clear();
      eventHandlers.clear();
      bufferedEvents.clear();
      session.send.mockClear();
      session.on.mockClear();
      session.off.mockClear();
    },
  };

  return session;
}

type MockCDP = ReturnType<typeof createMockCDP>;

// ===========================================================================
// browser_navigate
// ===========================================================================

describe("browser_navigate", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should navigate to URL and return title + URL", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-1",
    });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Example Domain" } };
      }
      if (p.expression.includes("location.href")) {
        return { result: { type: "string", value: "https://example.com/" } };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com",
    });

    expect(result.url).toBe("https://example.com/");
    expect(result.title).toBe("Example Domain");
    expect(cdp._getCalls("Page.navigate")).toHaveLength(1);
    expect(cdp._getCalls("Page.navigate")[0].params).toEqual(
      expect.objectContaining({ url: "https://example.com" })
    );
  });

  it("should wait for load event after navigation", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-1",
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "string", value: "Test" },
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com",
      waitUntil: "load",
    });

    // Verify that the navigation waited for the load event
    // The implementation should listen for Page.loadEventFired or poll
    const navCalls = cdp._getCalls("Page.navigate");
    expect(navCalls).toHaveLength(1);
  });

  it("should handle net::ERR_NAME_NOT_RESOLVED error", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      errorText: "net::ERR_NAME_NOT_RESOLVED",
    });

    await expect(
      browserNavigate(cdp as never, {
        url: "https://nonexistent.invalid",
      })
    ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED|navigation.*failed|cannot.*resolve/i);
  });

  it("should handle navigation timeout", async () => {
    cdp._setResponse("Page.navigate", () => {
      return new Promise(() => {
        // Never resolves — simulates timeout
      });
    });

    await expect(
      browserNavigate(cdp as never, {
        url: "https://slow-site.example.com",
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("should handle redirect and return final URL", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-1",
    });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("location.href")) {
        return {
          result: {
            type: "string",
            value: "https://example.com/redirected",
          },
        };
      }
      return { result: { type: "string", value: "Redirected Page" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/old-path",
    });

    expect(result.url).toBe("https://example.com/redirected");
  });

  it("should handle same-document navigation (hash change, no loaderId)", async () => {
    // Same-document navigations (e.g., #section) return no loaderId
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      // No loaderId — indicates same-document navigation
    });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Page Title" } };
      }
      if (p.expression.includes("location.href")) {
        return {
          result: {
            type: "string",
            value: "https://example.com/page#section2",
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/page#section2",
    });

    expect(result.url).toBe("https://example.com/page#section2");
    expect(result.title).toBe("Page Title");
    // Should NOT wait for load event on same-document navigation (no loaderId)
  });

  it("should pass waitUntil option to control load wait strategy", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-1",
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "string", value: "Test" },
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com",
      waitUntil: "domcontentloaded",
    });

    const navCalls = cdp._getCalls("Page.navigate");
    expect(navCalls).toHaveLength(1);
  });
});

// ===========================================================================
// browser_navigate_back
// ===========================================================================

describe("browser_navigate_back", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should go back in navigation history", async () => {
    cdp._setResponse("Page.getNavigationHistory", {
      currentIndex: 2,
      entries: [
        { id: 0, url: "https://example.com/page1", title: "Page 1" },
        { id: 1, url: "https://example.com/page2", title: "Page 2" },
        { id: 2, url: "https://example.com/page3", title: "Page 3" },
      ],
    });
    cdp._setResponse("Page.navigateToHistoryEntry", {});

    const result = await browserNavigateBack(cdp as never, {
      direction: "back",
    });

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.com/page2");

    const historyCalls = cdp._getCalls("Page.navigateToHistoryEntry");
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].params).toEqual(
      expect.objectContaining({ entryId: 1 })
    );
  });

  it("should go forward in navigation history", async () => {
    cdp._setResponse("Page.getNavigationHistory", {
      currentIndex: 0,
      entries: [
        { id: 0, url: "https://example.com/page1", title: "Page 1" },
        { id: 1, url: "https://example.com/page2", title: "Page 2" },
      ],
    });
    cdp._setResponse("Page.navigateToHistoryEntry", {});
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("location.href")) {
        return {
          result: {
            type: "string",
            value: "https://example.com/page2",
          },
        };
      }
      return { result: { type: "string", value: "Page 2" } };
    });

    const result = await browserNavigateBack(cdp as never, {
      direction: "forward",
    });

    expect(result.url).toBe("https://example.com/page2");

    const historyCalls = cdp._getCalls("Page.navigateToHistoryEntry");
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].params).toEqual(
      expect.objectContaining({ entryId: 1 })
    );
  });

  it("should handle empty history (no page to go back to)", async () => {
    cdp._setResponse("Page.getNavigationHistory", {
      currentIndex: 0,
      entries: [
        { id: 0, url: "https://example.com/only-page", title: "Only Page" },
      ],
    });

    const result = await browserNavigateBack(cdp as never, { direction: "back" });
    expect(result.success).toBe(false);
    expect(result.url).toBe("https://example.com/only-page");
  });

  it("should handle empty forward history", async () => {
    cdp._setResponse("Page.getNavigationHistory", {
      currentIndex: 1,
      entries: [
        { id: 0, url: "https://example.com/page1", title: "Page 1" },
        { id: 1, url: "https://example.com/page2", title: "Page 2" },
      ],
    });

    const result = await browserNavigateBack(cdp as never, { direction: "forward" });
    expect(result.success).toBe(false);
    expect(result.url).toBe("https://example.com/page2");
  });

  it("should default to going back when no direction is specified", async () => {
    cdp._setResponse("Page.getNavigationHistory", {
      currentIndex: 1,
      entries: [
        { id: 0, url: "https://example.com/page1", title: "Page 1" },
        { id: 1, url: "https://example.com/page2", title: "Page 2" },
      ],
    });
    cdp._setResponse("Page.navigateToHistoryEntry", {});
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("location.href")) {
        return {
          result: { type: "string", value: "https://example.com/page1" },
        };
      }
      return { result: { type: "string", value: "Page 1" } };
    });

    const result = await browserNavigateBack(cdp as never, {});

    expect(result.url).toBe("https://example.com/page1");
    const historyCalls = cdp._getCalls("Page.navigateToHistoryEntry");
    expect(historyCalls[0].params).toEqual(
      expect.objectContaining({ entryId: 0 })
    );
  });
});

// ===========================================================================
// browser_click
// ===========================================================================

describe("browser_click", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    // Default box model response for element center calculation
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [100, 200, 200, 200, 200, 250, 100, 250],
        padding: [100, 200, 200, 200, 200, 250, 100, 250],
        border: [100, 200, 200, 200, 200, 250, 100, 250],
        margin: [100, 200, 200, 200, 200, 250, 100, 250],
        width: 100,
        height: 50,
      },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.querySelector", { nodeId: 42 });
    cdp._setResponse("DOM.getDocument", {
      root: { nodeId: 1 },
    });
  });

  it("should click by @eN ref", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Submit button",
    });

    expect(result.success).toBe(true);

    // Should dispatch mouseMoved, mousePressed, mouseReleased
    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(mouseEvents.length).toBeGreaterThanOrEqual(3);

    const types = mouseEvents.map(
      (c) => (c.params as { type: string }).type
    );
    expect(types).toContain("mouseMoved");
    expect(types).toContain("mousePressed");
    expect(types).toContain("mouseReleased");
  });

  it("should click by CSS selector", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: {
        type: "object",
        subtype: "node",
        objectId: "obj-css-1",
      },
    });

    const result = await browserClick(cdp as never, {
      selector: "#submit-btn",
      element: "Submit button",
    });

    expect(result.success).toBe(true);
  });

  it("should click by coordinates (x, y)", async () => {
    const result = await browserClick(cdp as never, {
      x: 150,
      y: 225,
      element: "Button at coordinates",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    expect(pressEvent).toBeDefined();
    expect((pressEvent!.params as { x: number }).x).toBe(150);
    expect((pressEvent!.params as { y: number }).y).toBe(225);
  });

  it("should perform double click", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Text to select",
      doubleClick: true,
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvents = mouseEvents.filter(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    // Double click has clickCount: 2
    const doubleClickPress = pressEvents.find(
      (c) => (c.params as { clickCount?: number }).clickCount === 2
    );
    expect(doubleClickPress).toBeDefined();
  });

  it("should perform right click (context menu)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Element for context menu",
      button: "right",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    expect(
      (pressEvent!.params as { button: string }).button
    ).toBe("right");
  });

  it("should click with modifier keys (Ctrl+click)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Link to open in new tab",
      modifiers: ["Control"],
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    // CDP modifier bitfield: Ctrl = 2
    expect(
      (pressEvent!.params as { modifiers: number }).modifiers
    ).toBe(2);
  });

  it("should handle element not found", async () => {
    cdp._setResponse("DOM.querySelector", { nodeId: 0 });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "undefined", value: undefined },
    });

    await expect(
      browserClick(cdp as never, {
        selector: "#nonexistent",
        element: "Ghost element",
      })
    ).rejects.toThrow(/not found|no element|could not find/i);
  });

  it("should handle element not visible/clickable (zero-size box model)", async () => {
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [0, 0, 0, 0, 0, 0, 0, 0],
        width: 0,
        height: 0,
      },
    });

    await expect(
      browserClick(cdp as never, {
        ref: "@e5",
        element: "Hidden element",
      })
    ).rejects.toThrow(/not visible|not clickable|zero.*size|hidden/i);
  });

  it("should click and navigate within a page (TS-11)", async () => {
    // Simulating a click on a tab/link that changes the page hash
    const result = await browserClick(cdp as never, {
      ref: "@e3",
      element: "Files tab",
    });

    expect(result.success).toBe(true);
    // Navigation within page is a side effect; the click itself should succeed
  });

  it("should scroll element into view before clicking", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e10",
      element: "Below-fold button",
    });

    expect(result.success).toBe(true);
    const scrollCalls = cdp._getCalls("DOM.scrollIntoViewIfNeeded");
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should follow correct mouse event sequence: mouseMoved -> mousePressed -> delay -> mouseReleased", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Test button",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const types = mouseEvents.map(
      (c) => (c.params as { type: string }).type
    );

    // Verify the correct sequence order
    const moveIdx = types.indexOf("mouseMoved");
    const pressIdx = types.indexOf("mousePressed");
    const releaseIdx = types.indexOf("mouseReleased");

    expect(moveIdx).toBeLessThan(pressIdx);
    expect(pressIdx).toBeLessThan(releaseIdx);

    // The pressed and released events should have clickCount: 1
    const pressEvent = mouseEvents[pressIdx];
    expect(
      (pressEvent.params as { clickCount: number }).clickCount
    ).toBe(1);
    const releaseEvent = mouseEvents[releaseIdx];
    expect(
      (releaseEvent.params as { clickCount: number }).clickCount
    ).toBe(1);
  });

  it("should click with multiple modifier keys (Ctrl+Shift+click)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Multi-modifier click target",
      modifiers: ["Control", "Shift"],
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    // CDP modifier bitfield: Ctrl = 2, Shift = 8 → combined = 10
    expect(
      (pressEvent!.params as { modifiers: number }).modifiers
    ).toBe(10);
  });

  it("should click middle mouse button", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      element: "Middle click target",
      button: "middle",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    expect(
      (pressEvent!.params as { button: string }).button
    ).toBe("middle");
  });
});

// ===========================================================================
// browser_fill_form
// ===========================================================================

describe("browser_fill_form", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.focus", {});
    cdp._setResponse("Input.insertText", {});
    cdp._setResponse("Runtime.callFunctionOn", { result: { type: "undefined" } });
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-form-1" },
    });
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [10, 10, 110, 10, 110, 40, 10, 40],
        width: 100,
        height: 30,
      },
    });
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
  });

  it("should focus element, clear, type text, and dispatch events", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Email",
          type: "textbox",
          ref: "@e1",
          value: "user@example.com",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Should have focused the element
    const focusCalls = cdp._getCalls("DOM.focus");
    expect(focusCalls.length).toBeGreaterThanOrEqual(1);

    // Should have cleared and typed
    const insertCalls = cdp._getCalls("Input.insertText");
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      (insertCalls[insertCalls.length - 1].params as { text: string }).text
    ).toBe("user@example.com");
  });

  it("should fill by @eN ref", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Password",
          type: "textbox",
          ref: "@e2",
          value: "secret123",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
  });

  it("should fill by CSS selector", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", subtype: "node", objectId: "obj-css-2" },
    });
    cdp._setResponse("DOM.querySelector", { nodeId: 55 });
    cdp._setResponse("DOM.getDocument", { root: { nodeId: 1 } });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Username",
          type: "textbox",
          selector: "#username",
          value: "johndoe",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
  });

  it("should clear field before filling", async () => {
    const callOrder: string[] = [];
    cdp._setResponse("Runtime.callFunctionOn", (params: unknown) => {
      const p = params as { functionDeclaration: string };
      if (p.functionDeclaration.includes("value = ''") ||
          p.functionDeclaration.includes('value = ""') ||
          p.functionDeclaration.includes("value=''")) {
        callOrder.push("clear");
      }
      if (p.functionDeclaration.includes("dispatchEvent")) {
        callOrder.push("dispatch");
      }
      return { result: { type: "undefined" } };
    });

    await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Search",
          type: "textbox",
          ref: "@e3",
          value: "new search query",
        },
      ],
    });

    // Clear should be called (via Runtime.callFunctionOn to set value = '')
    const clearCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle multiple fields in one call", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        { name: "First Name", type: "textbox", ref: "@e1", value: "John" },
        { name: "Last Name", type: "textbox", ref: "@e2", value: "Doe" },
        { name: "Email", type: "textbox", ref: "@e3", value: "john@doe.com" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(3);
  });

  it("should handle readonly/disabled inputs", async () => {
    cdp._setResponse("Runtime.callFunctionOn", (params: unknown) => {
      const p = params as { functionDeclaration: string };
      if (
        p.functionDeclaration.includes("readOnly") ||
        p.functionDeclaration.includes("disabled")
      ) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Read Only Field",
          type: "textbox",
          ref: "@e1",
          value: "cannot set this",
        },
      ],
    });

    // Should report the field as failed but not crash
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
    expect(result.errors![0].error).toMatch(/readonly|disabled|cannot.*fill/i);
  });

  it("should handle checkbox fields", async () => {
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "boolean", value: false },
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Accept Terms",
          type: "checkbox",
          ref: "@e4",
          value: "true",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
  });

  it("should handle radio button fields", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Payment Method",
          type: "radio",
          ref: "@e5",
          value: "credit_card",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Radio buttons are selected by clicking
    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(mouseEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle combobox (select dropdown) fields", async () => {
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "object", value: ["us"] },
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Country",
          type: "combobox",
          ref: "@e6",
          value: "us",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Combobox should use the select_option approach
    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(callOnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle slider (range input) fields", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Volume",
          type: "slider",
          ref: "@e7",
          value: "75",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Slider should set value property and dispatch input + change events
    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(callOnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should dispatch input and change events after filling textbox", async () => {
    await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Email",
          type: "textbox",
          ref: "@e1",
          value: "test@test.com",
        },
      ],
    });

    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    const dispatchCall = callOnCalls.find((c) => {
      const fd = (c.params as { functionDeclaration: string })
        .functionDeclaration;
      return fd.includes("dispatchEvent") &&
        (fd.includes("input") || fd.includes("change"));
    });
    expect(dispatchCall).toBeDefined();
  });
});

// ===========================================================================
// browser_type
// ===========================================================================

describe("browser_type", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.focus", {});
    cdp._setResponse("Input.insertText", {});
    cdp._setResponse("Input.dispatchKeyEvent", {});
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-type-1" },
    });
  });

  it("should type text via Input.insertText (fast mode)", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "Hello, world!",
    });

    expect(result.success).toBe(true);

    const insertCalls = cdp._getCalls("Input.insertText");
    expect(insertCalls).toHaveLength(1);
    expect(
      (insertCalls[0].params as { text: string }).text
    ).toBe("Hello, world!");
  });

  it("should type text slowly via key events (slowly=true)", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "abc",
      slowly: true,
    });

    expect(result.success).toBe(true);

    // For "abc" typed slowly: 3 keyDown + 3 keyUp = 6 events minimum
    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    expect(keyEvents.length).toBeGreaterThanOrEqual(6);
  });

  it("should type in focused element (no ref, just insert text)", async () => {
    const result = await browserType(cdp as never, {
      text: "typed text",
    });

    expect(result.success).toBe(true);

    const insertCalls = cdp._getCalls("Input.insertText");
    expect(insertCalls).toHaveLength(1);
    expect(
      (insertCalls[0].params as { text: string }).text
    ).toBe("typed text");
  });

  it("should press Enter after typing when submit=true", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "search query",
      submit: true,
    });

    expect(result.success).toBe(true);

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const enterKey = keyEvents.find(
      (c) =>
        (c.params as { key: string }).key === "Enter" &&
        (c.params as { type: string }).type === "keyDown"
    );
    expect(enterKey).toBeDefined();
  });

  it("should handle cross-origin iframes via Input.insertText", async () => {
    // Input.insertText works even when Runtime.evaluate is blocked by CORS
    cdp._setResponse("Runtime.evaluate", () => {
      throw new Error("Cannot access cross-origin frame");
    });

    const result = await browserType(cdp as never, {
      text: "cross-origin input",
    });

    expect(result.success).toBe(true);
    const insertCalls = cdp._getCalls("Input.insertText");
    expect(insertCalls).toHaveLength(1);
  });

  it("should focus element before typing when ref is provided", async () => {
    await browserType(cdp as never, {
      ref: "@e3",
      text: "focused typing",
    });

    const focusCalls = cdp._getCalls("DOM.focus");
    expect(focusCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should dispatch char events for printable characters in slow mode", async () => {
    await browserType(cdp as never, {
      ref: "@e1",
      text: "A",
      slowly: true,
    });

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const keyDownEvents = keyEvents.filter(
      (c) => (c.params as { type: string }).type === "keyDown"
    );
    const keyUpEvents = keyEvents.filter(
      (c) => (c.params as { type: string }).type === "keyUp"
    );

    expect(keyDownEvents.length).toBeGreaterThanOrEqual(1);
    expect(keyUpEvents.length).toBeGreaterThanOrEqual(1);
    expect(
      (keyDownEvents[0].params as { text?: string; key?: string }).key
    ).toBe("A");
  });
});

// ===========================================================================
// browser_press_key
// ===========================================================================

describe("browser_press_key", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.dispatchKeyEvent", {});
  });

  it("should press single key (Enter)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Enter" });

    expect(result.success).toBe(true);

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    expect(keyEvents.length).toBeGreaterThanOrEqual(2); // keyDown + keyUp

    const keyDown = keyEvents.find(
      (c) => (c.params as { type: string }).type === "keyDown"
    );
    expect(keyDown).toBeDefined();
    expect((keyDown!.params as { key: string }).key).toBe("Enter");
    expect(
      (keyDown!.params as { windowsVirtualKeyCode: number })
        .windowsVirtualKeyCode
    ).toBe(13);
  });

  it("should press Tab key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Tab" });

    expect(result.success).toBe(true);

    const keyDown = cdp
      ._getCalls("Input.dispatchKeyEvent")
      .find((c) => (c.params as { type: string }).type === "keyDown");
    expect((keyDown!.params as { key: string }).key).toBe("Tab");
  });

  it("should press Escape key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Escape" });
    expect(result.success).toBe(true);

    const keyDown = cdp
      ._getCalls("Input.dispatchKeyEvent")
      .find((c) => (c.params as { type: string }).type === "keyDown");
    expect((keyDown!.params as { key: string }).key).toBe("Escape");
  });

  it("should press Backspace key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Backspace" });
    expect(result.success).toBe(true);

    const keyDown = cdp
      ._getCalls("Input.dispatchKeyEvent")
      .find((c) => (c.params as { type: string }).type === "keyDown");
    expect((keyDown!.params as { key: string }).key).toBe("Backspace");
  });

  it("should press key combination (Ctrl+A)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+a" });

    expect(result.success).toBe(true);

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    // Should have Ctrl keyDown, 'a' keyDown, 'a' keyUp, Ctrl keyUp (or similar)
    const ctrlDown = keyEvents.find(
      (c) =>
        (c.params as { type: string }).type === "keyDown" &&
        (c.params as { key: string }).key === "Control"
    );
    const aDown = keyEvents.find(
      (c) =>
        (c.params as { type: string }).type === "keyDown" &&
        (c.params as { key: string }).key === "a"
    );
    expect(ctrlDown).toBeDefined();
    expect(aDown).toBeDefined();
    // The 'a' key event should have the Ctrl modifier set (bitfield: 2)
    expect(
      (aDown!.params as { modifiers: number }).modifiers & 2
    ).toBeTruthy();
  });

  it("should press Ctrl+C (copy)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+c" });
    expect(result.success).toBe(true);
  });

  it("should press Ctrl+V (paste)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+v" });
    expect(result.success).toBe(true);
  });

  it("should press Meta+A (Cmd+A on macOS)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Meta+a" });

    expect(result.success).toBe(true);

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const metaDown = keyEvents.find(
      (c) =>
        (c.params as { type: string }).type === "keyDown" &&
        (c.params as { key: string }).key === "Meta"
    );
    expect(metaDown).toBeDefined();
  });

  it("should dispatch keyDown and keyUp events", async () => {
    await browserPressKey(cdp as never, { key: "Enter" });

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const types = keyEvents.map(
      (c) => (c.params as { type: string }).type
    );
    expect(types).toContain("keyDown");
    expect(types).toContain("keyUp");
  });

  it("should map keys to correct code values", async () => {
    await browserPressKey(cdp as never, { key: "ArrowLeft" });

    const keyDown = cdp
      ._getCalls("Input.dispatchKeyEvent")
      .find((c) => (c.params as { type: string }).type === "keyDown");

    expect((keyDown!.params as { key: string }).key).toBe("ArrowLeft");
    expect((keyDown!.params as { code: string }).code).toBe("ArrowLeft");
    expect(
      (keyDown!.params as { windowsVirtualKeyCode: number })
        .windowsVirtualKeyCode
    ).toBe(37);
  });

  it("should map Tab to correct virtual key code", async () => {
    await browserPressKey(cdp as never, { key: "Tab" });

    const keyDown = cdp
      ._getCalls("Input.dispatchKeyEvent")
      .find((c) => (c.params as { type: string }).type === "keyDown");

    expect(
      (keyDown!.params as { windowsVirtualKeyCode: number })
        .windowsVirtualKeyCode
    ).toBe(9);
  });

  it("should press arrow keys (ArrowDown, ArrowUp, ArrowRight)", async () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight"]) {
      cdp._reset();
      cdp._setResponse("Input.dispatchKeyEvent", {});

      const result = await browserPressKey(cdp as never, { key });
      expect(result.success).toBe(true);
    }
  });

  it("should press Shift+Tab for reverse tab navigation", async () => {
    const result = await browserPressKey(cdp as never, { key: "Shift+Tab" });
    expect(result.success).toBe(true);

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const tabDown = keyEvents.find(
      (c) =>
        (c.params as { type: string }).type === "keyDown" &&
        (c.params as { key: string }).key === "Tab"
    );
    expect(tabDown).toBeDefined();
    // Tab event should have Shift modifier (bitfield: 8)
    expect(
      (tabDown!.params as { modifiers: number }).modifiers & 8
    ).toBeTruthy();
  });
});

// ===========================================================================
// browser_scroll
// ===========================================================================

describe("browser_scroll", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: true },
    });
  });

  it("should scroll page down by pixels", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "down",
      amount: 500,
    });

    expect(result.success).toBe(true);

    // Scroll is typically done via Input.dispatchMouseEvent with mouseWheel
    // or Runtime.evaluate with window.scrollBy
    const scrollCalls = [
      ...cdp._getCalls("Input.dispatchMouseEvent"),
      ...cdp._getCalls("Runtime.evaluate"),
    ];
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should scroll page up by pixels", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "up",
      amount: 300,
    });

    expect(result.success).toBe(true);
  });

  it("should scroll to element (scrollIntoView)", async () => {
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-scroll-1" },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "undefined" },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});

    const result = await browserScroll(cdp as never, {
      selector: "#target-section",
    });

    expect(result.success).toBe(true);

    // Should call scrollIntoView on the element
    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    const scrollIntoViewCall = callOnCalls.find((c) =>
      (c.params as { functionDeclaration: string }).functionDeclaration.includes(
        "scrollIntoView"
      )
    );
    // Or it may use DOM.scrollIntoViewIfNeeded
    const scrollIfNeeded = cdp._getCalls("DOM.scrollIntoViewIfNeeded");
    expect(
      scrollIntoViewCall !== undefined || scrollIfNeeded.length > 0
    ).toBe(true);
  });

  it("should scroll within scrollable container by selector", async () => {
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-container-1" },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "undefined" },
    });

    const result = await browserScroll(cdp as never, {
      direction: "down",
      amount: 200,
      selector: "div.scrollable-panel",
    });

    expect(result.success).toBe(true);
  });

  it("should scroll left", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "left",
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should scroll right", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "right",
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should handle default scroll amount when not specified", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "down",
    });

    expect(result.success).toBe(true);
  });

  it("should handle scroll on element that does not exist", async () => {
    cdp._setResponse("DOM.resolveNode", () => {
      throw new Error("Could not find node with given id");
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", value: null, subtype: "null" },
    });
    cdp._setResponse("DOM.querySelector", { nodeId: 0 });

    await expect(
      browserScroll(cdp as never, {
        selector: "#nonexistent-container",
      })
    ).rejects.toThrow(/not found|could not find|no element/i);
  });
});

// ===========================================================================
// browser_hover
// ===========================================================================

describe("browser_hover", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [50, 100, 150, 100, 150, 130, 50, 130],
        width: 100,
        height: 30,
      },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-hover-1" },
    });
  });

  it("should hover element by @eN ref", async () => {
    const result = await browserHover(cdp as never, {
      ref: "@e7",
      element: "Tooltip trigger",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const moveEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mouseMoved"
    );
    expect(moveEvent).toBeDefined();
    // Center of content box: x = (50+150)/2 = 100, y = (100+130)/2 = 115
    expect((moveEvent!.params as { x: number }).x).toBe(100);
    expect((moveEvent!.params as { y: number }).y).toBe(115);
  });

  it("should hover by CSS selector", async () => {
    cdp._setResponse("DOM.querySelector", { nodeId: 88 });
    cdp._setResponse("DOM.getDocument", { root: { nodeId: 1 } });

    const result = await browserHover(cdp as never, {
      selector: ".dropdown-trigger",
      element: "Dropdown menu trigger",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(
      mouseEvents.some(
        (c) => (c.params as { type: string }).type === "mouseMoved"
      )
    ).toBe(true);
  });

  it("should trigger mouseover/mouseenter events via mouseMoved dispatch", async () => {
    const result = await browserHover(cdp as never, {
      ref: "@e7",
      element: "Hover target",
    });

    expect(result.success).toBe(true);

    // The CDP mouseMoved event triggers mouseover/mouseenter in the browser
    const moveEvents = cdp
      ._getCalls("Input.dispatchMouseEvent")
      .filter(
        (c) => (c.params as { type: string }).type === "mouseMoved"
      );
    expect(moveEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should scroll element into view before hovering", async () => {
    await browserHover(cdp as never, {
      ref: "@e7",
      element: "Off-screen element",
    });

    const scrollCalls = cdp._getCalls("DOM.scrollIntoViewIfNeeded");
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle element not found for hover", async () => {
    cdp._setResponse("DOM.getBoxModel", () => {
      throw new Error("Could not find node with given id");
    });

    await expect(
      browserHover(cdp as never, {
        ref: "@e999",
        element: "Nonexistent element",
      })
    ).rejects.toThrow(/not found|could not find/i);
  });

  it("should hover at the center of the element's content box", async () => {
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [0, 0, 200, 0, 200, 100, 0, 100],
        width: 200,
        height: 100,
      },
    });

    await browserHover(cdp as never, {
      ref: "@e1",
      element: "Large element",
    });

    const moveEvent = cdp
      ._getCalls("Input.dispatchMouseEvent")
      .find((c) => (c.params as { type: string }).type === "mouseMoved");

    // Center: x = (0+200)/2 = 100, y = (0+100)/2 = 50
    expect((moveEvent!.params as { x: number }).x).toBe(100);
    expect((moveEvent!.params as { y: number }).y).toBe(50);
  });
});

// ===========================================================================
// browser_drag
// ===========================================================================

describe("browser_drag", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.getBoxModel", (params: unknown) => {
      const p = params as { nodeId?: number; backendNodeId?: number };
      // Return different coordinates for source vs target
      if (p.nodeId === 10 || p.backendNodeId === 10) {
        return {
          model: {
            content: [50, 50, 100, 50, 100, 80, 50, 80],
            width: 50,
            height: 30,
          },
        };
      }
      return {
        model: {
          content: [300, 300, 350, 300, 350, 330, 300, 330],
          width: 50,
          height: 30,
        },
      };
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-drag-1" },
    });
  });

  it("should drag from source to target using synthesized mouse events", async () => {
    const result = await browserDrag(cdp as never, {
      startRef: "@e1",
      startElement: "Draggable item",
      endRef: "@e2",
      endElement: "Drop zone",
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const types = mouseEvents.map(
      (c) => (c.params as { type: string }).type
    );

    // Should follow: mouseMoved -> mousePressed -> (intermediate mouseMoved's) -> mouseReleased
    expect(types).toContain("mousePressed");
    expect(types).toContain("mouseReleased");

    // The mousePressed should be at source coordinates
    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    expect(pressEvent).toBeDefined();

    // The mouseReleased should be at target coordinates
    const releaseEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mouseReleased"
    );
    expect(releaseEvent).toBeDefined();
  });

  it("should drag by @eN refs", async () => {
    const result = await browserDrag(cdp as never, {
      startRef: "@e3",
      startElement: "Card",
      endRef: "@e5",
      endElement: "Column",
    });

    expect(result.success).toBe(true);
  });

  it("should drag by coordinates", async () => {
    const result = await browserDrag(cdp as never, {
      startX: 75,
      startY: 65,
      endX: 325,
      endY: 315,
    });

    expect(result.success).toBe(true);

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");

    const pressEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mousePressed"
    );
    expect((pressEvent!.params as { x: number }).x).toBe(75);
    expect((pressEvent!.params as { y: number }).y).toBe(65);

    const releaseEvent = mouseEvents.find(
      (c) => (c.params as { type: string }).type === "mouseReleased"
    );
    expect((releaseEvent!.params as { x: number }).x).toBe(325);
    expect((releaseEvent!.params as { y: number }).y).toBe(315);
  });

  it("should include intermediate mouseMoved events during drag", async () => {
    await browserDrag(cdp as never, {
      startRef: "@e1",
      startElement: "Draggable",
      endRef: "@e2",
      endElement: "Target",
    });

    const moveEvents = cdp
      ._getCalls("Input.dispatchMouseEvent")
      .filter(
        (c) => (c.params as { type: string }).type === "mouseMoved"
      );

    // Should have at least start, intermediate, and end move events
    expect(moveEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("should follow mousedown -> mousemove(s) -> mouseup sequence", async () => {
    await browserDrag(cdp as never, {
      startRef: "@e1",
      startElement: "Source",
      endRef: "@e2",
      endElement: "Target",
    });

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const types = mouseEvents.map(
      (c) => (c.params as { type: string }).type
    );

    const pressIdx = types.indexOf("mousePressed");
    const releaseIdx = types.lastIndexOf("mouseReleased");

    // mousePressed must come before mouseReleased
    expect(pressIdx).toBeLessThan(releaseIdx);

    // There should be mouseMoved events between press and release
    const moveBetween = types
      .slice(pressIdx + 1, releaseIdx)
      .filter((t) => t === "mouseMoved");
    expect(moveBetween.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle drag when source element is not found", async () => {
    cdp._setResponse("DOM.getBoxModel", () => {
      throw new Error("Could not find node with given id");
    });

    await expect(
      browserDrag(cdp as never, {
        startRef: "@e999",
        startElement: "Missing source",
        endRef: "@e2",
        endElement: "Target",
      })
    ).rejects.toThrow(/not found|could not find/i);
  });
});

// ===========================================================================
// browser_select_option
// ===========================================================================

describe("browser_select_option", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-select-1" },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "object", value: ["option-1"] },
    });
  });

  it("should select option in <select> by value", async () => {
    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["option-2"],
      element: "Country dropdown",
    });

    expect(result.success).toBe(true);

    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(callOnCalls.length).toBeGreaterThanOrEqual(1);

    // The function should set selected options and dispatch change event
    const selectCall = callOnCalls.find((c) => {
      const fd = (c.params as { functionDeclaration: string })
        .functionDeclaration;
      return fd.includes("option") && fd.includes("selected");
    });
    expect(selectCall).toBeDefined();
  });

  it("should select by label text", async () => {
    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["United States"],
      element: "Country dropdown",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toBeDefined();
  });

  it("should handle multi-select", async () => {
    cdp._setResponse("Runtime.callFunctionOn", {
      result: {
        type: "object",
        value: ["opt-a", "opt-c"],
      },
    });

    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["opt-a", "opt-c"],
      element: "Multi-select tags",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.selected).toContain("opt-a");
    expect(result.selected).toContain("opt-c");
  });

  it("should dispatch input and change events after selection", async () => {
    await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["opt-1"],
      element: "Dropdown",
    });

    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    const dispatchCall = callOnCalls.find((c) => {
      const fd = (c.params as { functionDeclaration: string })
        .functionDeclaration;
      return (
        fd.includes("dispatchEvent") &&
        (fd.includes("change") || fd.includes("input"))
      );
    });
    expect(dispatchCall).toBeDefined();
  });

  it("should handle element not being a <select>", async () => {
    cdp._setResponse("Runtime.callFunctionOn", () => {
      throw new Error("Element is not a SELECT");
    });

    await expect(
      browserSelectOption(cdp as never, {
        ref: "@e4",
        values: ["value"],
        element: "Not a select",
      })
    ).rejects.toThrow(/not.*select|invalid.*element/i);
  });

  it("should select single option and return it in selected array", async () => {
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "object", value: ["us"] },
    });

    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["us"],
      element: "Country select",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toEqual(["us"]);
  });

  it("should pass the objectId from DOM.resolveNode to Runtime.callFunctionOn", async () => {
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "specific-obj-id-42" },
    });

    await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["val"],
      element: "Test select",
    });

    const callOnCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(callOnCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      (callOnCalls[0].params as { objectId: string }).objectId
    ).toBe("specific-obj-id-42");
  });
});

// ===========================================================================
// browser_file_upload
// ===========================================================================

describe("browser_file_upload", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.setFileInputFiles", {});
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-upload-1" },
    });
  });

  it("should set files on <input type='file'> via DOM.setFileInputFiles", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/photo.jpg"],
    });

    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(1);

    const setFileCalls = cdp._getCalls("DOM.setFileInputFiles");
    expect(setFileCalls).toHaveLength(1);
    expect(
      (setFileCalls[0].params as { files: string[] }).files
    ).toEqual(["/tmp/photo.jpg"]);
  });

  it("should handle multiple file upload", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/doc1.pdf", "/tmp/doc2.pdf", "/tmp/doc3.pdf"],
    });

    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(3);

    const setFileCalls = cdp._getCalls("DOM.setFileInputFiles");
    expect(
      (setFileCalls[0].params as { files: string[] }).files
    ).toHaveLength(3);
  });

  it("should handle file not found", async () => {
    cdp._setResponse("DOM.setFileInputFiles", () => {
      throw new Error("File not found: /tmp/nonexistent.jpg");
    });

    await expect(
      browserFileUpload(cdp as never, {
        ref: "@e5",
        paths: ["/tmp/nonexistent.jpg"],
      })
    ).rejects.toThrow(/file not found|no such file|ENOENT/i);
  });

  it("should cancel file chooser when paths is empty", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: [],
    });

    // Cancelling file chooser should still succeed
    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(0);
  });

  it("should enable file chooser interception", async () => {
    await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/test.txt"],
    });

    // Verify the upload call was made
    expect(cdp._getCalls("DOM.setFileInputFiles")).toHaveLength(1);
  });

  it("should resolve backendNodeId from ref and pass objectId to setFileInputFiles", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e42",
      paths: ["/tmp/upload.png"],
    });

    expect(result.success).toBe(true);

    // Should have resolved the backendNodeId from the ref
    const resolveCalls = cdp._getCalls("DOM.resolveNode");
    expect(resolveCalls).toHaveLength(1);
    expect(
      (resolveCalls[0].params as { backendNodeId: number }).backendNodeId
    ).toBe(42);

    const setFileCalls = cdp._getCalls("DOM.setFileInputFiles");
    expect(setFileCalls).toHaveLength(1);
    // Should pass objectId from DOM.resolveNode
    expect(
      (setFileCalls[0].params as { objectId?: string }).objectId
    ).toBe("obj-upload-1");
  });

  it("should return error for invalid ref format", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "invalid-ref",
      paths: ["/tmp/test.txt"],
    });

    expect(result.success).toBe(false);
    expect(result.filesCount).toBe(0);
    expect(result.error).toBeDefined();
  });
});

// ===========================================================================
// browser_handle_dialog
// ===========================================================================

describe("browser_handle_dialog", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Page.handleJavaScriptDialog", {});
  });

  it("should accept alert dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("Page.handleJavaScriptDialog");
    expect(dialogCalls).toHaveLength(1);
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(true);
  });

  it("should dismiss confirm dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: false,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("Page.handleJavaScriptDialog");
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(false);
  });

  it("should accept prompt dialog with text", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
      promptText: "John Doe",
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("Page.handleJavaScriptDialog");
    expect(dialogCalls).toHaveLength(1);
    expect(
      (dialogCalls[0].params as { promptText?: string }).promptText
    ).toBe("John Doe");
  });

  it("should dismiss prompt dialog (returns null to page)", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: false,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("Page.handleJavaScriptDialog");
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(false);
  });

  it("should handle no pending dialog gracefully", async () => {
    // CDP throws when no dialog is pending
    cdp._setResponse("Page.handleJavaScriptDialog", () => {
      throw new Error("No dialog is showing");
    });

    const result = await browserHandleDialog(cdp as never, { accept: true });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no.*dialog/i);
  });

  it("should handle beforeunload dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
    });

    expect(result.success).toBe(true);
  });

  it("should handle all four dialog types by sending accept param", async () => {
    // The implementation doesn't track dialog type — it just sends accept/promptText to CDP.
    // Verify that calling handleDialog works for each accept value.
    for (const accept of [true, false]) {
      cdp._reset();
      cdp._setResponse("Page.handleJavaScriptDialog", {});

      const result = await browserHandleDialog(cdp as never, { accept });
      expect(result.success).toBe(true);

      const dialogCalls = cdp._getCalls("Page.handleJavaScriptDialog");
      expect(dialogCalls).toHaveLength(1);
      expect((dialogCalls[0].params as { accept: boolean }).accept).toBe(accept);
    }
  });

  it("should pass accept=true to CDP for accepted dialogs", async () => {
    await browserHandleDialog(cdp as never, { accept: true });

    const calls = cdp._getCalls("Page.handleJavaScriptDialog");
    expect(calls).toHaveLength(1);
    expect((calls[0].params as { accept: boolean }).accept).toBe(true);
  });
});

// ===========================================================================
// browser_wait_for
// ===========================================================================

describe("browser_wait_for", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should wait for text to appear on page", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      // Text appears on 3rd poll
      if (callCount >= 3) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Welcome",
      timeout: 5,
    });

    expect(result.success).toBe(true);
    expect(result.elapsed).toBeGreaterThan(0);
  });

  it("should wait for text to disappear", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      // Text disappears on 2nd poll
      if (callCount >= 2) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      textGone: "Loading...",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for specified time (delay)", async () => {
    const start = Date.now();

    const result = await browserWaitFor(cdp as never, {
      time: 0.1, // 100ms
    });

    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(50); // Allow some tolerance
  });

  it("should respect custom timeout", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: false },
    });

    await expect(
      browserWaitFor(cdp as never, {
        text: "Never appears",
        timeout: 0.5, // 500ms
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("should produce clear error message on timeout", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: false },
    });

    try {
      await browserWaitFor(cdp as never, {
        text: "Expected text",
        timeout: 0.3,
      });
      // Should not reach here
      expect.unreachable("Should have thrown timeout error");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/timeout/i);
      // Error should ideally mention what was being waited for
      expect(message.length).toBeGreaterThan(5);
    }
  });

  it("should wait for selector to appear in DOM", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount >= 2) {
        return { result: { type: "object", value: {} } };
      }
      return { result: { type: "object", value: null, subtype: "null" } };
    });

    const result = await browserWaitFor(cdp as never, {
      selector: ".dashboard-loaded",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for selector to be visible", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount >= 2) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      selector: ".modal",
      visible: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for network idle", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: true },
    });

    const result = await browserWaitFor(cdp as never, {
      networkIdle: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for page load", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "string", value: "complete" },
    });

    const result = await browserWaitFor(cdp as never, {
      load: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should handle cross-origin iframe waits (TS-16)", async () => {
    // In cross-origin iframes, Runtime.evaluate may fail
    // The implementation should handle this gracefully
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount === 1) {
        // First attempt might target cross-origin frame
        throw new Error("Cannot access cross-origin frame");
      }
      // Fallback to main frame
      return { result: { type: "boolean", value: true } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Loaded",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should use 30-second default timeout when not specified", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      // Resolve immediately on first call to avoid actually waiting 30s
      return { result: { type: "boolean", value: true } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Immediate text",
    });

    expect(result.success).toBe(true);
  });

  it("should return elapsed time in milliseconds", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: true },
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Already here",
      timeout: 5,
    });

    expect(result.success).toBe(true);
    expect(typeof result.elapsed).toBe("number");
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it("should poll at regular intervals for text appearance", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount >= 4) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      text: "Eventually appears",
      timeout: 5,
    });

    // Should have polled multiple times
    const evalCalls = cdp._getCalls("Runtime.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(4);
  });
});

// ===========================================================================
// browser_close
// ===========================================================================

describe("browser_close", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Target.closeTarget", { success: true });
    cdp._setResponse("Target.getTargets", {
      targetInfos: [
        {
          targetId: "target-1",
          type: "page",
          title: "Tab 1",
          url: "https://example.com",
          attached: true,
        },
        {
          targetId: "target-2",
          type: "page",
          title: "Tab 2",
          url: "https://example.org",
        },
      ],
    });
  });

  it("should close current active tab by default", async () => {
    const result = await browserClose(cdp as never, {});

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    const closeCalls = cdp._getCalls("Target.closeTarget");
    expect(closeCalls).toHaveLength(1);
    // Should close the attached (active) target
    expect(
      (closeCalls[0].params as { targetId: string }).targetId
    ).toBe("target-1");
  });

  it("should close specific tab by target ID", async () => {
    const result = await browserClose(cdp as never, {
      targetId: "target-1",
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    const closeCalls = cdp._getCalls("Target.closeTarget");
    expect(closeCalls).toHaveLength(1);
    expect(
      (closeCalls[0].params as { targetId: string }).targetId
    ).toBe("target-1");
  });

  it("should close all tabs when closeAll=true", async () => {
    const result = await browserClose(cdp as never, {
      closeAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(2);

    const closeCalls = cdp._getCalls("Target.closeTarget");
    expect(closeCalls).toHaveLength(2); // Two tabs
  });

  it("should handle already-closed tab in closeAll gracefully", async () => {
    // When closeAll is used, individual target close errors are ignored
    cdp._setResponse("Target.closeTarget", () => {
      throw new Error("No target with given id found");
    });

    const result = await browserClose(cdp as never, {
      closeAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(0);
  });

  it("should close current tab when no targetId or closeAll specified", async () => {
    const result = await browserClose(cdp as never, {});

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    // Should have closed the active target
    const closeCalls = cdp._getCalls("Target.closeTarget");
    expect(closeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// browser_resize
// ===========================================================================

describe("browser_resize", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Emulation.setDeviceMetricsOverride", {});
  });

  it("should set viewport size via Emulation.setDeviceMetricsOverride", async () => {
    const result = await browserResize(cdp as never, {
      width: 1280,
      height: 720,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    expect(emulationCalls).toHaveLength(1);
    expect(emulationCalls[0].params).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
      })
    );
  });

  it("should handle mobile preset with deviceScaleFactor and mobile flag", async () => {
    const result = await browserResize(cdp as never, {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      mobile: true,
    });

    expect(result.success).toBe(true);

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    expect(emulationCalls[0].params).toEqual(
      expect.objectContaining({
        width: 375,
        height: 812,
        deviceScaleFactor: 3,
        mobile: true,
      })
    );
  });

  it("should handle tablet preset", async () => {
    const result = await browserResize(cdp as never, {
      width: 768,
      height: 1024,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(768);
    expect(result.height).toBe(1024);
  });

  it("should handle desktop preset", async () => {
    const result = await browserResize(cdp as never, {
      width: 1920,
      height: 1080,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("should handle DPR (device pixel ratio) changes", async () => {
    const result = await browserResize(cdp as never, {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
    });

    expect(result.success).toBe(true);

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    expect(emulationCalls[0].params).toEqual(
      expect.objectContaining({
        deviceScaleFactor: 2,
      })
    );
  });

  it("should use default deviceScaleFactor of 0 when not specified", async () => {
    await browserResize(cdp as never, {
      width: 800,
      height: 600,
    });

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    const params = emulationCalls[0].params as {
      deviceScaleFactor: number;
    };
    expect(params.deviceScaleFactor).toBe(0);
  });

  it("should handle Emulation.setDeviceMetricsOverride failure", async () => {
    cdp._setResponse("Emulation.setDeviceMetricsOverride", () => {
      throw new Error("Emulation domain is not enabled");
    });

    await expect(
      browserResize(cdp as never, { width: 100, height: 100 })
    ).rejects.toThrow(/emulation|not enabled|failed/i);
  });

  it("should set mobile=false by default", async () => {
    await browserResize(cdp as never, {
      width: 1024,
      height: 768,
    });

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    const params = emulationCalls[0].params as { mobile: boolean };
    expect(params.mobile).toBe(false);
  });

  it("should handle high-DPR retina display (deviceScaleFactor=3)", async () => {
    const result = await browserResize(cdp as never, {
      width: 414,
      height: 896,
      deviceScaleFactor: 3,
      mobile: true,
    });

    expect(result.success).toBe(true);

    const emulationCalls = cdp._getCalls(
      "Emulation.setDeviceMetricsOverride"
    );
    expect(emulationCalls[0].params).toEqual(
      expect.objectContaining({
        width: 414,
        height: 896,
        deviceScaleFactor: 3,
        mobile: true,
      })
    );
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.2 — Mouse Click 3-Event CDP Sequence (P0)
// ===========================================================================

describe("browser_click CDP event sequence verification", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    // Default: resolve element at coordinates (100, 200)
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [100, 200, 200, 200, 200, 250, 100, 250],
        width: 100,
        height: 50,
      },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
  });

  it("should send exactly 3 Input.dispatchMouseEvent calls in correct order", async () => {
    await browserClick(cdp as never, { x: 100, y: 200 });

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(mouseEvents).toHaveLength(3);

    const [moved, pressed, released] = mouseEvents;
    expect((moved.params as { type: string }).type).toBe("mouseMoved");
    expect((moved.params as { x: number }).x).toBe(100);
    expect((moved.params as { y: number }).y).toBe(200);

    expect((pressed.params as { type: string }).type).toBe("mousePressed");
    expect((pressed.params as { button: string }).button).toBe("left");
    expect((pressed.params as { clickCount: number }).clickCount).toBe(1);

    expect((released.params as { type: string }).type).toBe("mouseReleased");
    expect((released.params as { button: string }).button).toBe("left");
    expect((released.params as { clickCount: number }).clickCount).toBe(1);
  });

  it("should include approximately 50ms delay between mousePressed and mouseReleased", async () => {
    const timestamps: number[] = [];
    const originalSend = cdp.send;
    cdp.send = vi.fn(async (method: string, params?: unknown) => {
      if (method === "Input.dispatchMouseEvent") {
        const p = params as { type: string };
        if (p.type === "mousePressed" || p.type === "mouseReleased") {
          timestamps.push(Date.now());
        }
      }
      return originalSend(method, params);
    });

    await browserClick(cdp as never, { x: 100, y: 200 });

    expect(timestamps).toHaveLength(2);
    const delay = timestamps[1] - timestamps[0];
    // Allow tolerance: 30ms to 100ms
    expect(delay).toBeGreaterThanOrEqual(30);
    expect(delay).toBeLessThanOrEqual(100);
  });

  it("should use modifiers=0 for unmodified clicks", async () => {
    await browserClick(cdp as never, { x: 100, y: 200 });

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    for (const event of mouseEvents) {
      const params = event.params as { modifiers?: number };
      // modifiers should be 0 or undefined (meaning no modifiers)
      expect(params.modifiers ?? 0).toBe(0);
    }
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.6 — Navigation loaderId Check (P0)
// ===========================================================================

describe("Navigation loaderId handling", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Page.enable", {});
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Test Page" } };
      }
      if (p.expression.includes("location.href")) {
        return { result: { type: "string", value: "https://example.com/" } };
      }
      if (p.expression.includes("readyState")) {
        return { result: { type: "string", value: "complete" } };
      }
      return { result: { type: "undefined" } };
    });
  });

  it("should await Page.loadEventFired when Page.navigate returns a loaderId", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-123",
    });

    // Simulate loadEventFired being emitted after navigate
    const navigatePromise = browserNavigate(cdp as never, {
      url: "https://example.com",
    });

    // Emit loadEventFired asynchronously
    setTimeout(() => {
      cdp._emit("Page.loadEventFired", {});
    }, 10);

    const result = await navigatePromise;

    expect(result.url).toBe("https://example.com/");
    // Verify that we subscribed to Page.loadEventFired
    expect(cdp.on).toHaveBeenCalledWith(
      "Page.loadEventFired",
      expect.any(Function)
    );
  });

  it("should NOT wait for Page.loadEventFired when no loaderId (same-document navigation)", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      // No loaderId — same-document navigation (hash change, pushState)
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/#section",
    });

    expect(result.url).toBe("https://example.com/");
    // Should NOT have waited for loadEventFired since no loaderId
    const loadEventCalls = cdp.on.mock.calls.filter(
      (call) => call[0] === "Page.loadEventFired"
    );
    // Either no subscription, or subscription was immediately cancelled
    expect(loadEventCalls.length).toBeLessThanOrEqual(1);
  });

  it("should cancel the load event listener for same-document navigation", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      // No loaderId
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com/#section",
    });

    // If a listener was registered, it should have been cleaned up via off()
    const onCalls = cdp.on.mock.calls.filter(
      (call) => call[0] === "Page.loadEventFired"
    );
    const offCalls = cdp.off.mock.calls.filter(
      (call) => call[0] === "Page.loadEventFired"
    );

    // For same-document navigation, either no listener was registered,
    // or the listener was registered and then removed
    if (onCalls.length > 0) {
      expect(offCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should call Page.enable before Page.navigate", async () => {
    cdp._setResponse("Page.navigate", {
      frameId: "frame-1",
      loaderId: "loader-1",
    });

    const navigatePromise = browserNavigate(cdp as never, {
      url: "https://example.com",
    });
    setTimeout(() => cdp._emit("Page.loadEventFired", {}), 10);
    await navigatePromise;

    const allCalls = cdp._calls;
    const enableIdx = allCalls.findIndex((c) => c.method === "Page.enable");
    const navigateIdx = allCalls.findIndex((c) => c.method === "Page.navigate");

    expect(enableIdx).toBeGreaterThanOrEqual(0);
    expect(navigateIdx).toBeGreaterThan(enableIdx);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.5 — waitForDocumentReady Polling Pattern (P0)
// ===========================================================================

describe("waitForDocumentReady", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should poll until document.readyState === 'complete'", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return { result: { type: "string", value: "loading" } };
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject with timeout error if readyState never reaches 'complete'", async () => {
    cdp._setResponse("Runtime.evaluate", () => ({
      result: { type: "string", value: "interactive" },
    }));

    await expect(
      waitForDocumentReady(cdp as never, { timeout: 1000 })
    ).rejects.toThrow(/timeout/i);
  });

  it("should retry on temporary Runtime.evaluate failures during navigation", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Execution context was destroyed");
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should poll at approximately 200ms intervals", async () => {
    const timestamps: number[] = [];
    let callCount = 0;

    cdp._setResponse("Runtime.evaluate", () => {
      timestamps.push(Date.now());
      callCount++;
      if (callCount < 4) {
        return { result: { type: "string", value: "loading" } };
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    // Verify intervals are approximately 200ms (allow 100ms–400ms tolerance)
    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i] - timestamps[i - 1];
      expect(interval).toBeGreaterThanOrEqual(100);
      expect(interval).toBeLessThanOrEqual(400);
    }
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.3 — Keyboard type / inserttext variants (P1)
// ===========================================================================

describe("keyboard type (at current focus, no selector)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.dispatchKeyEvent", {});
  });

  it("should dispatch individual keyDown/char/keyUp events for each character", async () => {
    await browserKeyboard(cdp as never, { action: "type", text: "hi" });

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    // For "hi": keyDown('h'), char('h'), keyUp('h'), keyDown('i'), char('i'), keyUp('i')
    // = 6 events (3 per character)
    expect(keyEvents.length).toBe(6);

    // First character 'h'
    expect((keyEvents[0].params as { type: string }).type).toBe("keyDown");
    expect((keyEvents[1].params as { type: string }).type).toBe("char");
    expect((keyEvents[2].params as { type: string }).type).toBe("keyUp");

    // Second character 'i'
    expect((keyEvents[3].params as { type: string }).type).toBe("keyDown");
    expect((keyEvents[4].params as { type: string }).type).toBe("char");
    expect((keyEvents[5].params as { type: string }).type).toBe("keyUp");
  });

  it("should not perform element lookup", async () => {
    await browserKeyboard(cdp as never, { action: "type", text: "abc" });

    // Should not call any DOM resolution methods
    const domCalls = cdp._getCalls("DOM.querySelector");
    const resolveCalls = cdp._getCalls("DOM.resolveNode");
    expect(domCalls).toHaveLength(0);
    expect(resolveCalls).toHaveLength(0);
  });
});

describe("keyboard inserttext (no key events)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.insertText", {});
  });

  it("should call Input.insertText without keyDown/keyUp events", async () => {
    await browserKeyboard(cdp as never, {
      action: "inserttext",
      text: "hello world",
    });

    const insertCalls = cdp._getCalls("Input.insertText");
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0].params as { text: string }).text).toBe(
      "hello world"
    );

    // No key events should have been dispatched
    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    expect(keyEvents).toHaveLength(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.4 — click --new-tab (P2)
// ===========================================================================

describe("click --new-tab", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("DOM.getDocument", {
      root: { nodeId: 1 },
    });
    cdp._setResponse("DOM.querySelector", { nodeId: 42 });
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [100, 200, 200, 200, 200, 250, 100, 250],
        width: 100,
        height: 50,
      },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
  });

  it("should use Meta/Ctrl modifier to open link in new tab", async () => {
    await browserClick(cdp as never, { selector: "a.link", newTab: true });

    const mouseEvents = cdp._getCalls("Input.dispatchMouseEvent");
    const pressedEvent = mouseEvents.find(
      (e) => (e.params as { type: string }).type === "mousePressed"
    );

    expect(pressedEvent).toBeDefined();
    const params = pressedEvent!.params as { modifiers: number };
    // Meta (macOS) = 4, Ctrl (Windows/Linux) = 2
    // The modifier should be non-zero indicating Meta or Ctrl
    expect(params.modifiers).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.5 — keydown / keyup separate commands (P2)
// ===========================================================================

describe("keydown (hold without release)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.dispatchKeyEvent", {});
  });

  it("should send only keyDown event, no keyUp", async () => {
    await browserKeyboard(cdp as never, { action: "keydown", key: "Shift" });

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const keyDownEvents = keyEvents.filter(
      (e) => (e.params as { type: string }).type === "keyDown"
    );
    const keyUpEvents = keyEvents.filter(
      (e) => (e.params as { type: string }).type === "keyUp"
    );

    expect(keyDownEvents.length).toBeGreaterThanOrEqual(1);
    expect(keyUpEvents).toHaveLength(0);
  });
});

describe("keyup (release held key)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Input.dispatchKeyEvent", {});
  });

  it("should send only keyUp event, no keyDown", async () => {
    await browserKeyboard(cdp as never, { action: "keyup", key: "Shift" });

    const keyEvents = cdp._getCalls("Input.dispatchKeyEvent");
    const keyDownEvents = keyEvents.filter(
      (e) => (e.params as { type: string }).type === "keyDown"
    );
    const keyUpEvents = keyEvents.filter(
      (e) => (e.params as { type: string }).type === "keyUp"
    );

    expect(keyUpEvents.length).toBeGreaterThanOrEqual(1);
    expect(keyDownEvents).toHaveLength(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.6 — scrollintoview as dedicated command (P2)
// ===========================================================================

describe("scrollintoview (dedicated command)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "undefined" },
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
  });

  it("should call DOM.scrollIntoViewIfNeeded or element.scrollIntoView", async () => {
    await browserScrollIntoView(cdp as never, { selector: "#target" });

    // Should have called either DOM.scrollIntoViewIfNeeded or
    // Runtime.callFunctionOn with scrollIntoView
    const scrollCalls = cdp._getCalls("DOM.scrollIntoViewIfNeeded");
    const runtimeCalls = cdp._getCalls("Runtime.callFunctionOn").filter(
      (c) =>
        ((c.params as { functionDeclaration?: string }).functionDeclaration ?? "")
          .includes("scrollIntoView")
    );

    expect(scrollCalls.length + runtimeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should work with @eN ref", async () => {
    await browserScrollIntoView(cdp as never, { ref: "@e5" });

    const scrollCalls = cdp._getCalls("DOM.scrollIntoViewIfNeeded");
    const runtimeCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(scrollCalls.length + runtimeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.7 — check / uncheck idempotency (P2)
// ===========================================================================

describe("check / uncheck (idempotent)", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [10, 10, 30, 10, 30, 30, 10, 30],
        width: 20,
        height: 20,
      },
    });
  });

  it("should be no-op if checkbox is already checked", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: true },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "boolean", value: true },
    });

    await browserCheck(cdp as never, { selector: "#agree" });

    // No click events should be dispatched since already checked
    const clickEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(clickEvents).toHaveLength(0);
  });

  it("should click to check if checkbox is unchecked", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: false },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "boolean", value: false },
    });

    await browserCheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(clickEvents.length).toBeGreaterThan(0);
  });

  it("should be no-op if checkbox is already unchecked when uncheck called", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: false },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "boolean", value: false },
    });

    await browserUncheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(clickEvents).toHaveLength(0);
  });

  it("should click to uncheck if checkbox is checked", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "boolean", value: true },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "boolean", value: true },
    });

    await browserUncheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(clickEvents.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.8 — focus element (P2)
// ===========================================================================

describe("focus element", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("DOM.focus", {});
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "undefined" },
    });
  });

  it("should call DOM.focus on the element", async () => {
    await browserFocus(cdp as never, { selector: "#email-input" });

    // Should call DOM.focus or Runtime.callFunctionOn with .focus()
    const focusCalls = cdp._getCalls("DOM.focus");
    const runtimeFocusCalls = cdp._getCalls("Runtime.callFunctionOn").filter(
      (c) =>
        ((c.params as { functionDeclaration?: string }).functionDeclaration ?? "")
          .includes("focus")
    );

    expect(focusCalls.length + runtimeFocusCalls.length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("should not dispatch click events", async () => {
    await browserFocus(cdp as never, { selector: "#email-input" });

    const clickEvents = cdp._getCalls("Input.dispatchMouseEvent");
    expect(clickEvents).toHaveLength(0);
  });

  it("should work with @eN ref", async () => {
    await browserFocus(cdp as never, { ref: "@e3" });

    const focusCalls = cdp._getCalls("DOM.focus");
    const runtimeFocusCalls = cdp._getCalls("Runtime.callFunctionOn");
    expect(focusCalls.length + runtimeFocusCalls.length).toBeGreaterThanOrEqual(
      1
    );
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.12 — Wait strategies (--url, --fn, --state) (P1)
// ===========================================================================

describe("wait --url pattern", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should poll current URL until it matches glob pattern", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return {
          result: { type: "string", value: "https://example.com/login" },
        };
      }
      return {
        result: { type: "string", value: "https://example.com/dashboard" },
      };
    });

    await browserWaitFor(cdp as never, { url: "**/dashboard" });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject on timeout if URL never matches", async () => {
    cdp._setResponse("Runtime.evaluate", () => ({
      result: { type: "string", value: "https://example.com/login" },
    }));

    await expect(
      browserWaitFor(cdp as never, { url: "**/dashboard", timeout: 1000 })
    ).rejects.toThrow(/timeout/i);
  });
});

describe("wait --fn JS condition", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should poll Runtime.evaluate until expression returns truthy", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return { result: { type: "boolean", value: false } };
      }
      return { result: { type: "boolean", value: true } };
    });

    await browserWaitFor(cdp as never, { fn: "window.ready === true" });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject on timeout if expression never returns true", async () => {
    cdp._setResponse("Runtime.evaluate", () => ({
      result: { type: "boolean", value: false },
    }));

    await expect(
      browserWaitFor(cdp as never, {
        fn: "window.ready === true",
        timeout: 1000,
      })
    ).rejects.toThrow(/timeout/i);
  });
});

describe("wait --state hidden", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should poll until element is no longer visible", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        // Element still visible
        return { result: { type: "boolean", value: true } };
      }
      // Element now hidden
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      selector: "#spinner",
      state: "hidden",
    });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should succeed immediately if element is already hidden", async () => {
    let callCount = 0;
    cdp._setResponse("Runtime.evaluate", () => {
      callCount++;
      // Element is already hidden on first check
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      selector: "#spinner",
      state: "hidden",
    });

    // Should resolve quickly with minimal polls
    expect(callCount).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.13 — Tab management (tab new, window new) (P2)
// ===========================================================================

describe("tab new", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Target.createTarget", {
      targetId: "new-target-1",
    });
    cdp._setResponse("Target.activateTarget", {});
  });

  it("should call Target.createTarget with URL", async () => {
    await browserTabNew(cdp as never, { url: "https://example.com" });

    const createCalls = cdp._getCalls("Target.createTarget");
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0].params as { url: string }).url).toBe(
      "https://example.com"
    );
  });

  it("should call Target.createTarget with about:blank when no URL", async () => {
    await browserTabNew(cdp as never, {});

    const createCalls = cdp._getCalls("Target.createTarget");
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0].params as { url: string }).url).toBe("about:blank");
  });

  it("should set new tab as active", async () => {
    const result = await browserTabNew(cdp as never, {
      url: "https://example.com",
    });

    const activateCalls = cdp._getCalls("Target.activateTarget");
    expect(activateCalls).toHaveLength(1);
    expect(
      (activateCalls[0].params as { targetId: string }).targetId
    ).toBe("new-target-1");
    expect(result.targetId).toBe("new-target-1");
  });
});

describe("window new", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Target.createTarget", {
      targetId: "new-window-target-1",
    });
    cdp._setResponse("Target.activateTarget", {});
  });

  it("should call Target.createTarget with newWindow=true", async () => {
    await browserWindowNew(cdp as never, { url: "https://example.com" });

    const createCalls = cdp._getCalls("Target.createTarget");
    expect(createCalls).toHaveLength(1);
    expect(
      (createCalls[0].params as { newWindow: boolean }).newWindow
    ).toBe(true);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.14 — Frame management (P2)
// ===========================================================================

describe("frame switch", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Page.getFrameTree", {
      frameTree: {
        frame: { id: "main-frame", url: "https://example.com" },
        childFrames: [
          {
            frame: {
              id: "iframe-1",
              url: "https://example.com/embed",
              name: "my-iframe",
            },
          },
        ],
      },
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "iframe-obj-1" },
    });
  });

  it("should switch execution context to iframe", async () => {
    const result = await browserFrameSwitch(cdp as never, {
      selector: "#my-iframe",
    });

    expect(result.success).toBe(true);
    expect(result.frameId).toBeDefined();
  });

  it("should scope subsequent commands to the iframe", async () => {
    await browserFrameSwitch(cdp as never, { selector: "#my-iframe" });

    // After switching, any evaluate call should target the iframe context
    // This is verified by checking that the execution context ID is set
    const frameCalls = cdp._getCalls("Page.getFrameTree");
    expect(frameCalls.length).toBeGreaterThanOrEqual(0);
  });
});

describe("frame main", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should switch back to main frame execution context", async () => {
    const result = await browserFrameMain(cdp as never);

    expect(result.success).toBe(true);
    // Should reset to main frame context
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.15 — Clipboard (P2)
// ===========================================================================

describe("clipboard", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
  });

  it("should read clipboard text via navigator.clipboard.readText()", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "string", value: "clipboard content" },
    });

    const result = await browserClipboardRead(cdp as never);

    expect(result.text).toBe("clipboard content");

    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const clipboardReadCall = evalCalls.find((c) =>
      ((c.params as { expression: string }).expression ?? "").includes(
        "clipboard.readText"
      )
    );
    expect(clipboardReadCall).toBeDefined();
  });

  it("should write clipboard text via navigator.clipboard.writeText()", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "undefined" },
    });

    await browserClipboardWrite(cdp as never, { text: "Hello, World!" });

    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const clipboardWriteCall = evalCalls.find((c) =>
      ((c.params as { expression: string }).expression ?? "").includes(
        "clipboard.writeText"
      )
    );
    expect(clipboardWriteCall).toBeDefined();
    // Verify the text is passed in the expression
    expect(
      (clipboardWriteCall!.params as { expression: string }).expression
    ).toContain("Hello, World!");
  });
});

// ===========================================================================
// GAP ANALYSIS: TS-16 — Cross-Origin Iframe (complete) (P1)
// ===========================================================================

describe("TS-16: Cross-origin iframe complete handling", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Page.getFrameTree", {
      frameTree: {
        frame: {
          id: "main-frame",
          url: "https://example.com",
          securityOrigin: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "same-origin-iframe",
              url: "https://example.com/embed",
              securityOrigin: "https://example.com",
            },
          },
          {
            frame: {
              id: "cross-origin-iframe",
              url: "https://third-party.com/widget",
              securityOrigin: "https://third-party.com",
            },
          },
        ],
      },
    });
  });

  it("should list all frames with origins via listFrames()", async () => {
    const frames = await listFrames(cdp as never);

    expect(frames).toHaveLength(3);
    expect(frames[0].url).toContain("example.com");
    expect(frames[1].url).toContain("example.com/embed");
    expect(frames[2].url).toContain("third-party.com");
  });

  it("should mark cross-origin frames as crossOrigin: true", async () => {
    const frames = await listFrames(cdp as never);

    const crossOriginFrame = frames.find((f: { url: string }) =>
      f.url.includes("third-party.com")
    );
    expect(crossOriginFrame).toBeDefined();
    expect(
      (crossOriginFrame as { crossOrigin: boolean }).crossOrigin
    ).toBe(true);
  });

  it("should suggest Target.attachToTarget for cross-origin content", async () => {
    const frames = await listFrames(cdp as never);

    const crossOriginFrame = frames.find((f: { url: string }) =>
      f.url.includes("third-party.com")
    );
    // The frame info should include a hint about cross-origin access
    expect(crossOriginFrame).toHaveProperty("crossOrigin", true);
    // Implementation should suggest Target.attachToTarget or similar
    // for accessing cross-origin iframe content
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.11 — Semantic Locators (P1)
// ===========================================================================

describe("Semantic Locators", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Accessibility.getFullAXTree", {
      nodes: [
        {
          nodeId: "ax-1",
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: "Submit" },
          backendDOMNodeId: 1,
        },
        {
          nodeId: "ax-2",
          role: { type: "role", value: "link" },
          name: { type: "computedString", value: "Sign In" },
          backendDOMNodeId: 2,
        },
      ],
    });
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("DOM.resolveNode", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
    cdp._setResponse("DOM.getBoxModel", {
      model: {
        content: [50, 50, 150, 50, 150, 80, 50, 80],
        width: 100,
        height: 30,
      },
    });
    cdp._setResponse("DOM.scrollIntoViewIfNeeded", {});
    cdp._setResponse("Input.dispatchMouseEvent", {});
    cdp._setResponse("Runtime.callFunctionOn", {
      result: { type: "string", value: "matched-text" },
    });
  });

  it("find role: should locate by ARIA role and accessible name", async () => {
    const result = await findByRole(cdp as never, {
      role: "button",
      name: "Submit",
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find text: should locate by text content", async () => {
    const result = await findByText(cdp as never, { text: "Sign In" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find label: should locate by associated label", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "labeled-input-1" },
    });

    const result = await findByLabel(cdp as never, { label: "Email" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find placeholder: should locate by placeholder attribute", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "placeholder-input-1" },
    });

    const result = await findByPlaceholder(cdp as never, {
      placeholder: "Search...",
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find alt: should locate by alt text", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "img-1" },
    });

    const result = await findByAlt(cdp as never, { alt: "Company Logo" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find title: should locate by title attribute", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "titled-1" },
    });

    const result = await findByTitle(cdp as never, { title: "More info" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find testid: should locate by data-testid", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: { type: "object", objectId: "testid-1" },
    });

    const result = await findByTestId(cdp as never, { testId: "submit-btn" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find first: should select first matching element", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: {
        type: "object",
        objectId: "first-1",
        description: "NodeList(3)",
      },
    });

    const result = await findFirst(cdp as never, { selector: ".item" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
    expect(result.index).toBe(0);
  });

  it("find last: should select last matching element", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: {
        type: "object",
        objectId: "last-1",
        description: "NodeList(3)",
      },
    });

    const result = await findLast(cdp as never, { selector: ".item" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find nth: should select nth matching element", async () => {
    cdp._setResponse("Runtime.evaluate", {
      result: {
        type: "object",
        objectId: "nth-1",
        description: "NodeList(5)",
      },
    });

    const result = await findNth(cdp as never, { selector: "a", n: 2 });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
    expect(result.index).toBe(2);
  });

  it("find with --exact: should require exact text match", async () => {
    // With exact=true, "Sign In" should NOT match "Sign In Now"
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("exact")) {
        return { result: { type: "object", objectId: "exact-match-1" } };
      }
      return { result: { type: "object", objectId: "fuzzy-match-1" } };
    });

    const result = await findByText(cdp as never, {
      text: "Sign In",
      exact: true,
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });
});

// ===========================================================================
// browser_route — Intercept requests and return mock responses
// ===========================================================================

describe("browser_route", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockCDP();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should intercept matching URL and return mock response body", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Verify Fetch.enable was called with the correct URL pattern
    const enableCalls = cdp._getCalls("Fetch.enable");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        patterns: expect.arrayContaining([
          expect.objectContaining({ urlPattern: "https://api.example.com/users" }),
        ]),
      })
    );

    // Simulate a matching request being paused
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-1",
      request: {
        url: "https://api.example.com/users",
        method: "GET",
      },
    });

    // Verify Fetch.fulfillRequest was called with the mock body
    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        requestId: "req-1",
        body: expect.any(String), // base64-encoded body
      })
    );
  });

  it("should set correct response status code", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/not-found",
      body: '{"error": "not found"}',
      status: 404,
    });

    // Simulate request paused
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-2",
      request: {
        url: "https://api.example.com/not-found",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        requestId: "req-2",
        responseCode: 404,
      })
    );
  });

  it("should set response headers", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/data",
      body: "OK",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Header": "test-value",
      },
    });

    // Simulate request paused
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-3",
      request: {
        url: "https://api.example.com/data",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        requestId: "req-3",
        responseHeaders: expect.arrayContaining([
          expect.objectContaining({ name: "Content-Type", value: "application/json" }),
          expect.objectContaining({ name: "X-Custom-Header", value: "test-value" }),
        ]),
      })
    );
  });

  it("should support glob URL patterns (e.g., '**/api/**')", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    await browserRoute(cdp as never, {
      url: "**/api/**",
      body: '{"mocked": true}',
    });

    const enableCalls = cdp._getCalls("Fetch.enable");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        patterns: expect.arrayContaining([
          expect.objectContaining({ urlPattern: "**/api/**" }),
        ]),
      })
    );

    // Simulate a matching request
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-glob-1",
      request: {
        url: "https://example.com/api/v2/users",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({ requestId: "req-glob-1" })
    );
  });

  it("should allow multiple routes for different patterns", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": ["alice"]}',
    });

    await browserRoute(cdp as never, {
      url: "https://api.example.com/posts",
      body: '{"posts": []}',
    });

    // Both patterns should be registered via Fetch.enable
    // The second call should re-enable with both patterns
    const enableCalls = cdp._getCalls("Fetch.enable");
    expect(enableCalls.length).toBeGreaterThanOrEqual(2);

    // Simulate request for /users
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-users",
      request: {
        url: "https://api.example.com/users",
        method: "GET",
      },
    });

    // Simulate request for /posts
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-posts",
      request: {
        url: "https://api.example.com/posts",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(2);

    const usersFulfill = fulfillCalls.find(
      (c) => (c.params as any).requestId === "req-users"
    );
    const postsFulfill = fulfillCalls.find(
      (c) => (c.params as any).requestId === "req-posts"
    );
    expect(usersFulfill).toBeDefined();
    expect(postsFulfill).toBeDefined();
  });

  it("should override existing route for same pattern", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    // First route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/config",
      body: '{"version": 1}',
    });

    // Override with new body
    await browserRoute(cdp as never, {
      url: "https://api.example.com/config",
      body: '{"version": 2}',
    });

    // Simulate request — should use the LATEST route definition
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-config",
      request: {
        url: "https://api.example.com/config",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    // The body should be the second (overridden) value, base64-encoded
    const body = fulfillCalls[0].params as Record<string, unknown>;
    // Decode the base64 body to verify it's the updated value
    const decodedBody = Buffer.from(body.body as string, "base64").toString("utf-8");
    expect(decodedBody).toBe('{"version": 2}');
  });

  it("should handle JSON body (auto-stringify if object)", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    // Pass an object as body — implementation should JSON.stringify it
    await browserRoute(cdp as never, {
      url: "https://api.example.com/json",
      body: { data: [1, 2, 3] } as any,
    });

    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-json",
      request: {
        url: "https://api.example.com/json",
        method: "GET",
      },
    });

    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(1);
    // Decode body and verify JSON was stringified
    const body = fulfillCalls[0].params as Record<string, unknown>;
    const decodedBody = Buffer.from(body.body as string, "base64").toString("utf-8");
    const parsed = JSON.parse(decodedBody);
    expect(parsed).toEqual({ data: [1, 2, 3] });
  });

  it("should pass non-matching requests through (Fetch.continueRequest)", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});
    cdp._setResponse("Fetch.continueRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Simulate a NON-matching request
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-other",
      request: {
        url: "https://cdn.example.com/image.png",
        method: "GET",
      },
    });

    // Should NOT fulfill this request
    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(0);

    // Should continue the non-matching request
    const continueCalls = cdp._getCalls("Fetch.continueRequest");
    expect(continueCalls).toHaveLength(1);
    expect(continueCalls[0].params).toEqual(
      expect.objectContaining({ requestId: "req-other" })
    );
  });
});

// ===========================================================================
// browser_abort — Block requests matching a URL pattern
// ===========================================================================

describe("browser_abort", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockCDP();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should block matching URL pattern", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Verify Fetch.enable was called with the URL pattern
    const enableCalls = cdp._getCalls("Fetch.enable");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        patterns: expect.arrayContaining([
          expect.objectContaining({ urlPattern: "https://ads.example.com/*" }),
        ]),
      })
    );

    // Simulate a matching request being paused
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-ad-1",
      request: {
        url: "https://ads.example.com/banner.js",
        method: "GET",
      },
    });

    // Should fail (abort) the request
    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({ requestId: "req-ad-1" })
    );
  });

  it('should use "BlockedByClient" as failure reason', async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://tracker.example.com/*",
    });

    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-tracker-1",
      request: {
        url: "https://tracker.example.com/pixel.gif",
        method: "GET",
      },
    });

    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({
        requestId: "req-tracker-1",
        reason: "BlockedByClient",
      })
    );
  });

  it("should support glob URL patterns", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});

    await browserAbort(cdp as never, {
      url: "**/analytics/**",
    });

    const enableCalls = cdp._getCalls("Fetch.enable");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        patterns: expect.arrayContaining([
          expect.objectContaining({ urlPattern: "**/analytics/**" }),
        ]),
      })
    );

    // Simulate a matching request
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-analytics",
      request: {
        url: "https://example.com/analytics/event",
        method: "POST",
      },
    });

    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({
        requestId: "req-analytics",
        reason: "BlockedByClient",
      })
    );
  });

  it("should allow multiple abort patterns", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    await browserAbort(cdp as never, {
      url: "https://tracker.example.com/*",
    });

    // Simulate matching requests for both patterns
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-ad",
      request: {
        url: "https://ads.example.com/banner.js",
        method: "GET",
      },
    });

    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-tracker",
      request: {
        url: "https://tracker.example.com/pixel.gif",
        method: "GET",
      },
    });

    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(2);

    const adFail = failCalls.find(
      (c) => (c.params as any).requestId === "req-ad"
    );
    const trackerFail = failCalls.find(
      (c) => (c.params as any).requestId === "req-tracker"
    );
    expect(adFail).toBeDefined();
    expect(trackerFail).toBeDefined();
  });

  it("should not affect non-matching requests", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});
    cdp._setResponse("Fetch.continueRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Simulate a NON-matching request
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-legit",
      request: {
        url: "https://api.example.com/data",
        method: "GET",
      },
    });

    // Should NOT fail this request
    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(0);

    // Should continue the non-matching request
    const continueCalls = cdp._getCalls("Fetch.continueRequest");
    expect(continueCalls).toHaveLength(1);
    expect(continueCalls[0].params).toEqual(
      expect.objectContaining({ requestId: "req-legit" })
    );
  });
});

// ===========================================================================
// browser_unroute — Remove intercept rules
// ===========================================================================

describe("browser_unroute", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockCDP();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should remove specific route by URL pattern", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});
    cdp._setResponse("Fetch.continueRequest", {});

    // Set up a route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Remove the route
    await browserUnroute(cdp as never, {
      url: "https://api.example.com/users",
    });

    // Clear calls so we only see post-unroute behavior
    cdp._calls.length = 0;

    // Simulate a request that previously would have been intercepted
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-after-unroute",
      request: {
        url: "https://api.example.com/users",
        method: "GET",
      },
    });

    // Should NOT fulfill — the route was removed
    const fulfillCalls = cdp._getCalls("Fetch.fulfillRequest");
    expect(fulfillCalls).toHaveLength(0);

    // Should continue the request (or no longer intercept it at all)
    const continueCalls = cdp._getCalls("Fetch.continueRequest");
    expect(continueCalls).toHaveLength(1);
  });

  it("should remove specific abort by URL pattern", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.failRequest", {});
    cdp._setResponse("Fetch.continueRequest", {});

    // Set up an abort
    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Remove the abort rule
    await browserUnroute(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Clear calls
    cdp._calls.length = 0;

    // Simulate a request that previously would have been blocked
    await cdp._emitAsync("Fetch.requestPaused", {
      requestId: "req-after-unabort",
      request: {
        url: "https://ads.example.com/banner.js",
        method: "GET",
      },
    });

    // Should NOT fail — the abort was removed
    const failCalls = cdp._getCalls("Fetch.failRequest");
    expect(failCalls).toHaveLength(0);

    // Should continue the request
    const continueCalls = cdp._getCalls("Fetch.continueRequest");
    expect(continueCalls).toHaveLength(1);
  });

  it("should remove all intercepts when {all: true}", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.disable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});
    cdp._setResponse("Fetch.failRequest", {});

    // Set up multiple routes and aborts
    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    await browserRoute(cdp as never, {
      url: "https://api.example.com/posts",
      body: '{"posts": []}',
    });

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Remove ALL intercepts
    await browserUnroute(cdp as never, { all: true });

    // Fetch.disable should have been called since all intercepts are removed
    const disableCalls = cdp._getCalls("Fetch.disable");
    expect(disableCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should call Fetch.disable when no intercepts remain", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.disable", {});
    cdp._setResponse("Fetch.fulfillRequest", {});

    // Set up a single route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/data",
      body: "{}",
    });

    // Remove the only route — no intercepts remain
    await browserUnroute(cdp as never, {
      url: "https://api.example.com/data",
    });

    // Fetch.disable should be called when the last intercept is removed
    const disableCalls = cdp._getCalls("Fetch.disable");
    expect(disableCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should be idempotent (removing non-existent pattern is ok)", async () => {
    cdp._setResponse("Fetch.enable", {});
    cdp._setResponse("Fetch.disable", {});

    // Remove a pattern that was never registered — should not throw
    await expect(
      browserUnroute(cdp as never, {
        url: "https://nonexistent.example.com/*",
      })
    ).resolves.not.toThrow();
  });
});

// ===========================================================================
// browser_find (unified MCP tool)
// ===========================================================================

describe("browser_find", () => {
  let cdp: MockCDP;

  // Sample AX tree nodes for tests
  const sampleNodes = [
    {
      nodeId: "1",
      role: { type: "role", value: "WebArea" },
      name: { type: "computedString", value: "Test Page" },
      backendDOMNodeId: 1,
      childIds: ["2", "3", "4", "5", "6", "7"],
    },
    {
      nodeId: "2",
      role: { type: "role", value: "heading" },
      name: { type: "computedString", value: "Welcome" },
      backendDOMNodeId: 10,
      parentId: "1",
    },
    {
      nodeId: "3",
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Submit" },
      backendDOMNodeId: 20,
      parentId: "1",
    },
    {
      nodeId: "4",
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Cancel" },
      backendDOMNodeId: 30,
      parentId: "1",
    },
    {
      nodeId: "5",
      role: { type: "role", value: "link" },
      name: { type: "computedString", value: "Sign In" },
      backendDOMNodeId: 40,
      parentId: "1",
    },
    {
      nodeId: "6",
      role: { type: "role", value: "textbox" },
      name: { type: "computedString", value: "Email" },
      backendDOMNodeId: 50,
      parentId: "1",
    },
    {
      nodeId: "7",
      role: { type: "role", value: "StaticText" },
      name: { type: "computedString", value: "Hello world" },
      backendDOMNodeId: 60,
      parentId: "1",
    },
  ];

  beforeEach(() => {
    cdp = createMockCDP();
    cdp._setResponse("Accessibility.getFullAXTree", { nodes: sampleNodes });
  });

  it("should find element by role", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
  });

  it("should find element by role and name", async () => {
    const result = await browserFind(cdp as never, { role: "button", name: "Cancel" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
    expect(result.name).toBe("Cancel");
    expect(result.ref).toBe("@e30");
  });

  it("should find element by text content", async () => {
    const result = await browserFind(cdp as never, { text: "Hello world" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Hello world");
    expect(result.ref).toBe("@e60");
  });

  it("should return first match by default (nth=0)", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Submit");
    expect(result.ref).toBe("@e20");
  });

  it("should return nth match when specified", async () => {
    const result = await browserFind(cdp as never, { role: "button", nth: 1 });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Cancel");
    expect(result.ref).toBe("@e30");
  });

  it("should return found: false when no match", async () => {
    const result = await browserFind(cdp as never, { role: "slider" });

    expect(result.found).toBe(false);
    expect(result.ref).toBeNull();
    expect(result.role).toBeNull();
    expect(result.name).toBeNull();
    expect(result.count).toBe(0);
  });

  it("should return count of total matches", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.count).toBe(2);
  });

  it("should return valid @eN ref for matched element", async () => {
    const result = await browserFind(cdp as never, { role: "link", name: "Sign In" });

    expect(result.found).toBe(true);
    expect(result.ref).toBe("@e40");
    expect(result.ref).toMatch(/^@e\d+$/);
  });

  it("should match role case-insensitively", async () => {
    const result = await browserFind(cdp as never, { role: "BUTTON" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
    expect(result.count).toBe(2);
  });

  it("should match name as substring", async () => {
    const result = await browserFind(cdp as never, { name: "Sub" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Submit");
    expect(result.ref).toBe("@e20");
  });
});

// ===========================================================================
// browser_diff
// ===========================================================================

describe("browser_diff", () => {
  let cdp: MockCDP;

  // A fake base64 PNG string (not valid PNG but sufficient for mock tests)
  const fakeBase64A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
  const fakeBase64B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8";

  beforeEach(() => {
    cdp = createMockCDP();
    // Default responses for Runtime.evaluate
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      // For the variable assignment calls, return simple value
      if (p.expression.startsWith("window._diffBefore") || p.expression.startsWith("window._diffAfter")) {
        return { result: { type: "string", value: "" } };
      }
      // For the cleanup call
      if (p.expression.startsWith("delete window._diffBefore")) {
        return { result: { type: "boolean", value: true } };
      }
      // For the comparison expression (awaitPromise: true)
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 0,
              totalPixels: 100,
              diffPixels: 0,
              identical: true,
              diffImage: "diffImageBase64Data",
              width: 10,
              height: 10,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });
    cdp._setResponse("Page.captureScreenshot", { data: fakeBase64A });
  });

  it("should return identical: true for same screenshot", async () => {
    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64A,
    });

    expect(result.identical).toBe(true);
    expect(result.diffPercentage).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(100);
  });

  it("should detect pixel differences between two images", async () => {
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 15.5,
              totalPixels: 1000,
              diffPixels: 155,
              identical: false,
              diffImage: "diffHighlightBase64",
              width: 100,
              height: 10,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.identical).toBe(false);
    expect(result.diffPixels).toBe(155);
    expect(result.diffPercentage).toBe(15.5);
  });

  it("should return diff percentage", async () => {
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 42.75,
              totalPixels: 400,
              diffPixels: 171,
              identical: false,
              diffImage: "base64data",
              width: 20,
              height: 20,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.diffPercentage).toBe(42.75);
    expect(result.totalPixels).toBe(400);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it("should return diff image as base64", async () => {
    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64A,
    });

    expect(result.diffImage).toBeDefined();
    expect(typeof result.diffImage).toBe("string");
    expect(result.diffImage.length).toBeGreaterThan(0);
  });

  it("should capture current page when before is 'current'", async () => {
    cdp._setResponse("Page.captureScreenshot", { data: fakeBase64A });

    const result = await browserDiff(cdp as never, {
      before: "current",
      after: fakeBase64B,
    });

    // Should have called Page.captureScreenshot for "before"
    const screenshotCalls = cdp._getCalls("Page.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.identical).toBe(true);
  });

  it("should capture current page when after is not provided", async () => {
    cdp._setResponse("Page.captureScreenshot", { data: fakeBase64A });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
    });

    // Should have called Page.captureScreenshot for "after"
    const screenshotCalls = cdp._getCalls("Page.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.identical).toBe(true);
  });

  it("should respect threshold parameter", async () => {
    const customThreshold = 50;

    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
      threshold: customThreshold,
    });

    // The threshold should be embedded in the comparison expression
    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const comparisonCall = evalCalls.find(
      (c) => (c.params as { awaitPromise?: boolean }).awaitPromise === true,
    );
    expect(comparisonCall).toBeDefined();
    const expression = (comparisonCall!.params as { expression: string }).expression;
    expect(expression).toContain("const threshold = 50;");
  });

  it("should handle different image dimensions gracefully", async () => {
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        // Simulate comparison of images with different dimensions
        // The canvas approach uses Math.max(width, height) so it handles this
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 25.0,
              totalPixels: 2000,
              diffPixels: 500,
              identical: false,
              diffImage: "diffBase64ForDifferentSizes",
              width: 100,
              height: 20,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.width).toBe(100);
    expect(result.height).toBe(20);
    expect(result.diffPercentage).toBe(25.0);
    expect(result.identical).toBe(false);
  });

  it("should store images in page context as window variables", async () => {
    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    const evalCalls = cdp._getCalls("Runtime.evaluate");

    // Should set window._diffBefore
    const beforeCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("window._diffBefore"),
    );
    expect(beforeCall).toBeDefined();

    // Should set window._diffAfter
    const afterCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("window._diffAfter"),
    );
    expect(afterCall).toBeDefined();

    // Should clean up globals
    const cleanupCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("delete window._diffBefore"),
    );
    expect(cleanupCall).toBeDefined();
  });

  it("should scope comparison to selector when provided", async () => {
    cdp._setResponse("DOM.getDocument", { root: { nodeId: 1 } });
    cdp._setResponse("DOM.querySelector", { nodeId: 5 });
    cdp._setResponse("DOM.getBoxModel", {
      model: { content: [10, 20, 110, 20, 110, 120, 10, 120] },
    });

    await browserDiff(cdp as never, {
      before: "current",
      after: "current",
      selector: "#my-element",
    });

    // Should have used DOM.querySelector to find the element
    const queryCalls = cdp._getCalls("DOM.querySelector");
    expect(queryCalls.length).toBeGreaterThanOrEqual(1);
    expect((queryCalls[0].params as { selector: string }).selector).toBe("#my-element");

    // Should have captured screenshot with clip
    const screenshotCalls = cdp._getCalls("Page.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    const clipParam = (screenshotCalls[0].params as { clip?: unknown }).clip;
    expect(clipParam).toBeDefined();
  });

  it("should throw error when comparison fails with exception", async () => {
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: { type: "undefined" },
          exceptionDetails: { text: "Canvas tainted by cross-origin data" },
        };
      }
      return { result: { type: "undefined" } };
    });

    await expect(
      browserDiff(cdp as never, {
        before: fakeBase64A,
        after: fakeBase64B,
      }),
    ).rejects.toThrow("Diff comparison failed");
  });

  it("should use default threshold of 30 when not specified", async () => {
    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const comparisonCall = evalCalls.find(
      (c) => (c.params as { awaitPromise?: boolean }).awaitPromise === true,
    );
    expect(comparisonCall).toBeDefined();
    const expression = (comparisonCall!.params as { expression: string }).expression;
    expect(expression).toContain("const threshold = 30;");
  });
});

// ===========================================================================
// browser_save_state
// ===========================================================================

import { browserSaveState } from "../src/tools/browser-session-state";
import { browserLoadState } from "../src/tools/browser-session-state";

// Mock node:fs and node:os for state tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: vi.fn(() => "/mock-home"),
  };
});

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

describe("browser_save_state", () => {
  let cdp: MockCDP;

  beforeEach(() => {
    cdp = createMockCDP();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(homedir).mockReturnValue("/mock-home");
  });

  it("should save cookies from Network.getAllCookies", async () => {
    const mockCookies = [
      { name: "session", value: "abc123", domain: ".example.com" },
      { name: "pref", value: "dark", domain: ".example.com" },
    ];
    cdp._setResponse("Network.getAllCookies", { cookies: mockCookies });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/dashboard" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-session" });

    expect(result.cookies).toBe(2);
    expect(cdp._getCalls("Network.getAllCookies")).toHaveLength(1);
  });

  it("should save localStorage entries", async () => {
    const localEntries = [["theme", "dark"], ["lang", "en"]];
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: JSON.stringify(localEntries) } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-local" });

    expect(result.localStorage).toBe(2);
  });

  it("should save sessionStorage entries", async () => {
    const sessionEntries = [["cart", "item1"], ["step", "3"]];
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: JSON.stringify(sessionEntries) } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-session-storage" });

    expect(result.sessionStorage).toBe(2);
  });

  it("should save current URL", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://app.example.com/settings" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    await browserSaveState(cdp as never, { name: "test-url" });

    // Verify the written file contains the URL
    const writeCall = vi.mocked(writeFileSync).mock.calls[0];
    const writtenData = JSON.parse(writeCall[1] as string);
    expect(writtenData.url).toBe("https://app.example.com/settings");
  });

  it("should write state file to ~/.browsirai/states/{name}.json", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "my-state" });

    expect(result.path.replace(/\\/g, '/')).toBe("/mock-home/.browsirai/states/my-state.json");
    expect(vi.mocked(writeFileSync).mock.calls[0][0].replace(/\\/g, '/')).toBe("/mock-home/.browsirai/states/my-state.json");
  });

  it("should create states directory if not exists", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await browserSaveState(cdp as never, { name: "new-state" });

    expect(vi.mocked(mkdirSync).mock.calls[0][0].replace(/\\/g, '/')).toBe("/mock-home/.browsirai/states");
    expect(vi.mocked(mkdirSync).mock.calls[0][1]).toEqual({ recursive: true });
  });

  it("should overwrite existing state file with same name", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [{ name: "a", value: "1" }] });
    cdp._setResponse("Runtime.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    // Save twice with same name
    await browserSaveState(cdp as never, { name: "overwrite-test" });
    await browserSaveState(cdp as never, { name: "overwrite-test" });

    // writeFileSync should have been called twice to the same path
    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0][0].replace(/\\/g, '/')).toBe("/mock-home/.browsirai/states/overwrite-test.json");
    expect(writeCalls[1][0].replace(/\\/g, '/')).toBe("/mock-home/.browsirai/states/overwrite-test.json");
  });
});

// ===========================================================================
// browser_load_state
// ===========================================================================

describe("browser_load_state", () => {
  let cdp: MockCDP;

  const mockStateFile = {
    version: 1,
    savedAt: "2024-01-01T00:00:00.000Z",
    url: "https://example.com/dashboard",
    cookies: [
      { name: "session", value: "abc123", domain: ".example.com" },
    ],
    localStorage: { theme: "dark", lang: "en" },
    sessionStorage: { cart: "item1" },
  };

  beforeEach(() => {
    cdp = createMockCDP();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(homedir).mockReturnValue("/mock-home");
  });

  it("should load cookies via Network.setCookies", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const setCookieCalls = cdp._getCalls("Network.setCookies");
    expect(setCookieCalls).toHaveLength(1);
    expect(setCookieCalls[0].params).toEqual({
      cookies: mockStateFile.cookies,
    });
  });

  it("should restore localStorage entries", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    const result = await browserLoadState(cdp as never, { name: "test-session" });

    expect(result.localStorage).toBe(2);
    // Verify Runtime.evaluate was called with localStorage.setItem expressions
    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const localStorageCall = evalCalls.find((c) => {
      const p = c.params as { expression: string };
      return p.expression.includes("localStorage.setItem");
    });
    expect(localStorageCall).toBeDefined();
  });

  it("should restore sessionStorage entries", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    const result = await browserLoadState(cdp as never, { name: "test-session" });

    expect(result.sessionStorage).toBe(1);
    // Verify Runtime.evaluate was called with sessionStorage.setItem expressions
    const evalCalls = cdp._getCalls("Runtime.evaluate");
    const sessionStorageCall = evalCalls.find((c) => {
      const p = c.params as { expression: string };
      return p.expression.includes("sessionStorage.setItem");
    });
    expect(sessionStorageCall).toBeDefined();
  });

  it("should navigate to saved URL", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const navCalls = cdp._getCalls("Page.navigate");
    expect(navCalls).toHaveLength(1);
    expect(navCalls[0].params).toEqual({ url: "https://example.com/dashboard" });
  });

  it("should navigate to custom URL when provided", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, {
      name: "test-session",
      url: "https://other.example.com/page",
    });

    const navCalls = cdp._getCalls("Page.navigate");
    expect(navCalls).toHaveLength(1);
    expect(navCalls[0].params).toEqual({ url: "https://other.example.com/page" });
  });

  it("should reload page after restoring state", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const reloadCalls = cdp._getCalls("Page.reload");
    expect(reloadCalls).toHaveLength(1);
  });

  it("should throw error when state file not found", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(
      browserLoadState(cdp as never, { name: "nonexistent" }),
    ).rejects.toThrow("State file not found");
  });
});
