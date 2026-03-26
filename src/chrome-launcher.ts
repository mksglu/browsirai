/**
 * Chrome connection — connects to Chrome via CDP.
 *
 * Strategy (ordered by preference):
 * 1. If Chrome is already running with --remote-debugging-port → connect via DevToolsActivePort
 * 2. If Chrome is running without debugging → quit & relaunch with --remote-debugging-port
 * 3. If Chrome is not running → launch with --remote-debugging-port
 *
 * Using --remote-debugging-port avoids the Chrome M144 "Allow remote debugging?" modal
 * entirely. The default user data directory is preserved, so cookies, logins, tabs,
 * and extensions remain intact.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createConnection } from "node:net";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectOptions {
  /** CDP port override (normally read from DevToolsActivePort) */
  port?: number;
  /** If true, auto-launch Chrome with --remote-debugging-port when not connected */
  autoLaunch?: boolean;
  /** If true, launch Chrome in headless mode (no visible window) */
  headless?: boolean;
}

export interface ConnectResult {
  /** Whether connection to Chrome succeeded */
  success: boolean;
  /** Port Chrome is listening on */
  port: number;
  /** Full WebSocket endpoint URL */
  wsEndpoint?: string;
  /** Whether DevToolsActivePort file was found */
  activePortFound: boolean;
  /** Error message if connection failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Well-known Chrome paths per platform
// ---------------------------------------------------------------------------

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ],
};

// ---------------------------------------------------------------------------
// Default Chrome data directory per platform
// ---------------------------------------------------------------------------

export function getDefaultChromeDataDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "Google", "Chrome");
    case "win32":
      return join(home, "AppData", "Local", "Google", "Chrome", "User Data");
    default: // linux
      return join(home, ".config", "google-chrome");
  }
}

// ---------------------------------------------------------------------------
// Find Chrome
// ---------------------------------------------------------------------------

export function findChrome(): string | null {
  const platform = process.platform;
  const candidates = CHROME_PATHS[platform] ?? [];

  for (const candidate of candidates) {
    if (platform === "darwin" || platform === "win32") {
      if (existsSync(candidate)) return candidate;
    } else {
      try {
        const result = execSync(`which ${candidate}`, { stdio: "pipe" });
        const path = result.toString().trim();
        if (path) return path;
      } catch {
        // try next
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Port check
// ---------------------------------------------------------------------------

export function isPortReachable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.end(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

/**
 * Verifies CDP is truly usable by hitting /json/version.
 * Chrome's M144 approach (chrome://inspect) opens the port but returns 404 on /json/version
 * and 403 on WebSocket connections. Only --remote-debugging-port gives real CDP access.
 */
export function isCDPHealthy(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/json/version`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

// ---------------------------------------------------------------------------
// DevToolsActivePort reader
// ---------------------------------------------------------------------------

export interface ActivePortInfo {
  /** The debug port Chrome is listening on */
  port: number;
  /** The WebSocket path (e.g. /devtools/browser/...) */
  wsPath: string;
  /** Full WebSocket endpoint: ws://127.0.0.1:{port}{wsPath} */
  wsEndpoint: string;
}

/**
 * Reads the DevToolsActivePort file from Chrome's data directory.
 *
 * Chrome writes this file when remote debugging is enabled via
 * chrome://inspect/#remote-debugging (Chrome M144+).
 *
 * File format:
 *   Line 1: port number (e.g. "9222")
 *   Line 2: WebSocket path (e.g. "/devtools/browser/abc-123")
 *
 * @param chromeDataDir - Override Chrome data dir (for testing)
 */
export function readDevToolsActivePort(chromeDataDir?: string): ActivePortInfo | null {
  const dataDir = chromeDataDir ?? getDefaultChromeDataDir();
  const portFile = join(dataDir, "DevToolsActivePort");

  if (!existsSync(portFile)) {
    return null;
  }

  try {
    const content = readFileSync(portFile, "utf-8");
    const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length < 2) return null;

    const port = parseInt(lines[0]!, 10);
    const wsPath = lines[1]!;

    if (isNaN(port) || !wsPath.startsWith("/")) return null;

    return {
      port,
      wsPath,
      wsEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Open chrome://inspect to guide user
// ---------------------------------------------------------------------------

/**
 * Opens chrome://inspect/#remote-debugging in the user's Chrome.
 * On macOS uses `open`, on Linux uses `xdg-open`, on Windows uses `start`.
 */
export function openChromeInspect(): boolean {
  const url = "chrome://inspect/#remote-debugging";
  try {
    if (process.platform === "darwin") {
      execSync(`open -a "Google Chrome" "${url}"`, { stdio: "pipe", timeout: 5000 });
    } else if (process.platform === "win32") {
      execSync(`start chrome "${url}"`, { stdio: "pipe", timeout: 5000 });
    } else {
      execSync(`google-chrome "${url}" || chromium "${url}"`, { stdio: "pipe", timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Launch Chrome with remote debugging (zero modals)
// ---------------------------------------------------------------------------

export interface LaunchResult {
  success: boolean;
  port: number;
  wsEndpoint?: string;
  error?: string;
}

/**
 * Checks if Chrome is currently running.
 */
export function isChromeRunning(): boolean {
  try {
    if (process.platform === "win32") {
      const r = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { stdio: "pipe" }).toString();
      return r.includes("chrome.exe");
    }
    const r = execSync("pgrep -x 'Google Chrome' || pgrep -x chrome || pgrep -x chromium", { stdio: "pipe" }).toString().trim();
    return r.length > 0;
  } catch {
    return false;
  }
}

/**
 * Quits Chrome gracefully, waits for it to fully exit.
 * Falls back to force kill if graceful quit doesn't work (e.g. macOS session restore).
 */
export async function quitChrome(): Promise<void> {
  try {
    if (process.platform === "darwin") {
      execSync('osascript -e \'tell application "Google Chrome" to quit\'', { stdio: "pipe", timeout: 5000 });
    } else if (process.platform === "win32") {
      execSync("taskkill /IM chrome.exe", { stdio: "pipe", timeout: 5000 });
    } else {
      execSync("pkill -TERM chrome || pkill -TERM chromium", { stdio: "pipe", timeout: 5000 });
    }
  } catch {
    // May not be running
  }

  // Wait for Chrome to fully exit (up to 3 seconds)
  for (let i = 0; i < 15; i++) {
    if (!isChromeRunning()) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // Force kill if still running (macOS session restore can relaunch Chrome)
  if (isChromeRunning()) {
    try {
      if (process.platform === "win32") {
        execSync("taskkill /F /IM chrome.exe", { stdio: "pipe", timeout: 5000 });
      } else {
        execSync("pkill -9 'Google Chrome' || pkill -9 chrome || pkill -9 chromium", { stdio: "pipe", timeout: 5000 });
      }
    } catch {
      // best effort
    }

    // Wait for force kill to take effect
    for (let i = 0; i < 15; i++) {
      if (!isChromeRunning()) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Small delay for profile lock release
  await new Promise(r => setTimeout(r, 500));
}

const SEPARATE_PORT = 9444;

/**
 * Launches Chrome with --remote-debugging-port to avoid the M144 "Allow?" modal.
 *
 * NEVER quits the user's running Chrome. If Chrome is already running without
 * CDP, a separate instance is launched with a temp profile + cookie sync
 * (same strategy as headless, but with a visible window).
 *
 * @param port - CDP port (default 9222)
 * @returns LaunchResult with wsEndpoint if successful
 */
export async function launchChromeWithDebugging(port = 9222, headless = false): Promise<LaunchResult> {
  // Already healthy (launched with --remote-debugging-port)? Don't touch Chrome.
  const healthy = await isCDPHealthy(port);
  if (healthy) {
    const ws = await getWsEndpoint(port);
    return { success: true, port, wsEndpoint: ws };
  }

  // Check if a separate browsirai instance is already running
  const sepHealthy = await isCDPHealthy(SEPARATE_PORT);
  if (sepHealthy) {
    const ws = await getWsEndpoint(SEPARATE_PORT);
    return { success: true, port: SEPARATE_PORT, wsEndpoint: ws };
  }

  const chromePath = findChrome();
  if (!chromePath) {
    return { success: false, port, error: "Chrome not found. Install Chrome and try again." };
  }

  // If Chrome is running without CDP, launch a SEPARATE instance.
  // NEVER quit the user's Chrome — their tabs, work, and session are sacred.
  const usesSeparateInstance = isChromeRunning();
  const targetPort = usesSeparateInstance ? SEPARATE_PORT : port;

  const dataDir = usesSeparateInstance
    ? join(tmpdir(), "browsirai-normal")
    : undefined; // use default Chrome profile when no Chrome is running

  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    syncCookiesToHeadless(dataDir); // reuse cookie sync for the separate instance
  }

  const args = [
    `--remote-debugging-port=${targetPort}`,
    "--remote-allow-origins=*",
    "--no-sandbox",
  ];

  if (dataDir) {
    args.push(`--user-data-dir=${dataDir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions");
  }

  if (headless) {
    args.push("--headless=new");
  }

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait for CDP to become healthy (up to 15 seconds)
  for (let i = 0; i < 75; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ok = await isCDPHealthy(targetPort);
    if (ok) {
      const ws = await getWsEndpoint(targetPort);
      return { success: true, port: targetPort, wsEndpoint: ws };
    }
  }

  return {
    success: false,
    port: targetPort,
    error: "Chrome launched but CDP port not reachable after 15s. Check if another Chrome instance is blocking the profile.",
  };
}

// ---------------------------------------------------------------------------
// Headless Chrome — separate instance, doesn't touch user's Chrome
// ---------------------------------------------------------------------------

const HEADLESS_PORT = 9333;

/**
 * Fetches the webSocketDebuggerUrl from /json/version.
 */
async function getWsEndpoint(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => {
        try {
          const data = JSON.parse(body) as { webSocketDebuggerUrl?: string };
          resolve(data.webSocketDebuggerUrl);
        } catch { resolve(undefined); }
      });
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(undefined); });
    req.on("error", () => resolve(undefined));
  });
}

// ---------------------------------------------------------------------------
// Cookie sync state — tracks last sync for navigate-hook resync detection
// ---------------------------------------------------------------------------

interface CookieSyncState {
  profileName: string;
  cookieMtime: number;
}

let cookieSyncState: CookieSyncState | null = null;

/**
 * Returns the current cookie sync state (profile name + cookie file mtime).
 * Returns null if no sync has been performed yet.
 */
export function getCookieSyncState(): CookieSyncState | null {
  return cookieSyncState;
}

/**
 * Checks if cookies need re-syncing by comparing current cookie file mtime
 * and active profile against the last sync state.
 * Returns true if: cookie file modified, profile switched, or no prior sync.
 * Returns false if: nothing changed or Chrome data dir doesn't exist.
 */
export function needsCookieResync(chromeDataDir?: string): boolean {
  if (!cookieSyncState) return false; // no prior sync → nothing to compare

  const dataDir = chromeDataDir ?? getDefaultChromeDataDir();
  const localStatePath = join(dataDir, "Local State");
  if (!existsSync(localStatePath)) return false;

  try {
    const localState = JSON.parse(readFileSync(localStatePath, "utf-8")) as {
      profile?: { last_used?: string };
    };
    const profileName = localState.profile?.last_used ?? "Default";

    // Profile changed?
    if (profileName !== cookieSyncState.profileName) return true;

    // Cookie file mtime changed?
    const cookiePath = join(dataDir, profileName, "Cookies");
    if (!existsSync(cookiePath)) return false;
    const mtime = statSync(cookiePath).mtimeMs;
    return mtime !== cookieSyncState.cookieMtime;
  } catch {
    return false;
  }
}

/**
 * Detects the user's active Chrome profile, copies cookies to the dest profile,
 * and tracks sync state (mtime + profile name) for later resync detection.
 */
export function syncCookiesAndTrack(destDataDir: string, chromeDataDir?: string): void {
  const dataDir = chromeDataDir ?? getDefaultChromeDataDir();
  try {
    const localStatePath = join(dataDir, "Local State");
    if (!existsSync(localStatePath)) return;

    const localState = JSON.parse(readFileSync(localStatePath, "utf-8")) as {
      profile?: { last_used?: string };
    };
    const profileName = localState.profile?.last_used ?? "Default";
    const srcProfileDir = join(dataDir, profileName);

    if (!existsSync(join(srcProfileDir, "Cookies"))) return;

    // Ensure Default profile dir exists in dest data dir
    const destProfileDir = join(destDataDir, "Default");
    mkdirSync(destProfileDir, { recursive: true });

    // Copy all Cookies-related files
    const files = readdirSync(srcProfileDir).filter(f => f.startsWith("Cookies"));
    for (const file of files) {
      copyFileSync(join(srcProfileDir, file), join(destProfileDir, file));
    }

    // Track sync state
    const mtime = statSync(join(srcProfileDir, "Cookies")).mtimeMs;
    cookieSyncState = { profileName, cookieMtime: mtime };
  } catch {
    // Best-effort — don't fail launch
  }
}

/** @deprecated Use syncCookiesAndTrack instead. Kept for internal compatibility. */
function syncCookiesToHeadless(headlessDataDir: string): void {
  syncCookiesAndTrack(headlessDataDir);
}

/**
 * Launches a separate headless Chrome on port 9333 with a temp profile.
 * Does NOT quit or affect the user's running Chrome.
 */
export async function launchHeadlessChrome(): Promise<LaunchResult> {
  // Already running?
  const healthy = await isCDPHealthy(HEADLESS_PORT);
  if (healthy) {
    const ws = await getWsEndpoint(HEADLESS_PORT);
    return { success: true, port: HEADLESS_PORT, wsEndpoint: ws };
  }

  const chromePath = findChrome();
  if (!chromePath) {
    return { success: false, port: HEADLESS_PORT, error: "Chrome not found." };
  }

  const dataDir = join(tmpdir(), "browsirai-headless");
  mkdirSync(dataDir, { recursive: true });

  // Copy user's cookies to headless profile before launch
  syncCookiesToHeadless(dataDir);

  const child = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${HEADLESS_PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${dataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-gpu",
    "--no-sandbox",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait for CDP to become healthy
  for (let i = 0; i < 75; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isCDPHealthy(HEADLESS_PORT)) {
      const ws = await getWsEndpoint(HEADLESS_PORT);
      return { success: true, port: HEADLESS_PORT, wsEndpoint: ws };
    }
  }

  return { success: false, port: HEADLESS_PORT, error: "Headless Chrome did not start in 15s." };
}

// ---------------------------------------------------------------------------
// Connect to Chrome
// ---------------------------------------------------------------------------

/**
 * Connects to Chrome via CDP.
 *
 * Strategy:
 * 1. Try DevToolsActivePort (Chrome already has debugging enabled)
 * 2. Try manual port override or default port 9222
 * 3. If autoLaunch is true, quit Chrome and relaunch with --remote-debugging-port
 *
 * @returns ConnectResult with wsEndpoint if successful
 */
export async function connectChrome(options: ConnectOptions = {}): Promise<ConnectResult> {
  const targetPort = options.port ?? 9222;

  // 1. Try DevToolsActivePort first (must be CDP-healthy, not just TCP-reachable)
  const activePort = readDevToolsActivePort();

  if (activePort) {
    const healthy = await isCDPHealthy(activePort.port);
    if (healthy) {
      return {
        success: true,
        port: activePort.port,
        wsEndpoint: activePort.wsEndpoint,
        activePortFound: true,
      };
    }
  }

  // 2. Try port directly (must be CDP-healthy to avoid M144 modal)
  const healthy = await isCDPHealthy(targetPort);
  if (healthy) {
    return {
      success: true,
      port: targetPort,
      activePortFound: false,
    };
  }

  // 3. Auto-launch if enabled
  if (options.autoLaunch) {
    const launch = await launchChromeWithDebugging(targetPort, options.headless);
    if (launch.success) {
      return {
        success: true,
        port: launch.port,
        wsEndpoint: launch.wsEndpoint,
        activePortFound: false,
      };
    }
    return {
      success: false,
      port: targetPort,
      activePortFound: false,
      error: launch.error,
    };
  }

  // 4. Not connected
  return {
    success: false,
    port: targetPort,
    activePortFound: activePort !== null,
    error: "Chrome remote debugging is not enabled. Enable it at chrome://inspect/#remote-debugging",
  };
}
