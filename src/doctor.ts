/**
 * Runs browsirai diagnostics — checks environment, browser availability, and CDP connectivity.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectPlatform, getInstallConfig } from "./adapters/detect.js";
import type { DiagnosticResult } from "./adapters/types.js";
import { VERSION } from "./version.js";
import { getInstallMethod, getInstallPath, getUpgradeStatus, checkForUpgrade } from "./upgrade.js";
import { findChrome, connectChrome } from "./chrome-launcher.js";

/**
 * Checks if the current Node.js version meets the minimum requirement (>= 18).
 */
function checkNodeVersion(): DiagnosticResult {
  const versionStr = process.version.replace(/^v/, "");
  const major = parseInt(versionStr.split(".")[0]!, 10);
  const ok = major >= 18;
  return {
    ok,
    label: "Node.js version",
    message: ok
      ? `v${versionStr} (>= 18 required)`
      : `v${versionStr} — Node.js >= 18 is required`,
  };
}


/**
 * Resolve ~ to home directory in config paths.
 */
function resolvePath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Check if browsirai is configured in a specific config file.
 */
function checkConfigFile(
  filePath: string,
  configKey: string,
  platform: string,
): DiagnosticResult | null {
  const resolved = resolvePath(filePath);
  if (!existsSync(resolved)) return null;

  try {
    const content = readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(content) as Record<string, Record<string, unknown>>;
    const servers = parsed[configKey];
    if (servers && typeof servers === "object" && "browsirai" in servers) {
      return {
        ok: true,
        label: "Platform config",
        message: `browsirai found in ${resolved} (platform: ${platform})`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks if browsirai is configured in any known platform config file.
 * First checks the detected platform, then scans all known paths.
 */
function checkPlatformConfig(): DiagnosticResult {
  const detection = detectPlatform();
  const config = getInstallConfig(detection.platform);

  // 1. Check detected platform's config
  const detected = checkConfigFile(config.configPath, config.configKey, detection.platform);
  if (detected) return detected;

  // 2. Scan all known config paths (including global ~/.mcp.json for Claude Code)
  const knownPaths: Array<{ path: string; key: string; platform: string }> = [
    { path: "~/.mcp.json", key: "mcpServers", platform: "claude-code (global)" },
    { path: ".mcp.json", key: "mcpServers", platform: "claude-code" },
    { path: ".cursor/mcp.json", key: "mcpServers", platform: "cursor" },
    { path: "~/.gemini/settings.json", key: "mcpServers", platform: "gemini-cli" },
    { path: ".vscode/mcp.json", key: "servers", platform: "vscode-copilot" },
    { path: "~/.codeium/windsurf/mcp_config.json", key: "mcpServers", platform: "windsurf" },
  ];

  for (const entry of knownPaths) {
    const result = checkConfigFile(entry.path, entry.key, entry.platform);
    if (result) return result;
  }

  return {
    ok: false,
    label: "Platform config",
    message: `browsirai not found in any known config file (detected: ${detection.platform})`,
  };
}

/**
 * Runs all browsirai diagnostics and returns an array of check results.
 *
 * Checks performed:
 * 1. Chrome/Chromium installation
 * 2. Node.js version >= 22
 * 3. CDP port (9222) reachability
 * 4. Platform detection and config
 */
export async function runDoctor(): Promise<DiagnosticResult[]> {
  const checks: DiagnosticResult[] = [];

  // 0. browsirai version + install info
  const method = getInstallMethod();
  checks.push({
    ok: true,
    label: "browsirai version",
    message: `v${VERSION} (${method})`,
  });

  checks.push({
    ok: true,
    label: "Install path",
    message: getInstallPath(),
  });

  // 0b. Latest version check
  let status = getUpgradeStatus();
  if (!status) {
    status = await checkForUpgrade();
  }
  if (status) {
    const upToDate = status.current === status.latest;
    checks.push({
      ok: upToDate,
      label: "Latest version",
      message: upToDate
        ? `v${status.latest} (up to date)`
        : `v${status.latest} available (current: v${status.current}, restart to apply)`,
    });
  }

  // 1. Check Chrome/Chromium installation
  const chromePath = findChrome();
  checks.push({
    ok: chromePath !== null,
    label: "Chrome/Chromium installed",
    message: chromePath
      ? `Found at ${chromePath}`
      : "Chrome or Chromium not found in PATH",
  });

  // 2. Check Node.js version
  checks.push(checkNodeVersion());

  // 3. Check CDP connectivity — auto-launch Chrome with debugging if needed
  const connection = await connectChrome({ autoLaunch: !!chromePath });

  if (connection.success) {
    checks.push({
      ok: true,
      label: "CDP connection",
      message: connection.wsEndpoint
        ? `Connected (port ${connection.port}, --remote-debugging-port)`
        : `CDP reachable on port ${connection.port}`,
    });
  } else {
    checks.push({
      ok: false,
      label: "CDP connection",
      message: connection.error ?? "CDP not available",
    });
  }

  // 4. Check platform detection and config
  checks.push(checkPlatformConfig());

  // Log results
  console.log("browsirai doctor: running diagnostics...\n");
  for (const check of checks) {
    const icon = check.ok ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.label}`);
    if (check.message) {
      console.log(`         ${check.message}`);
    }
  }

  const allPassed = checks.every((c) => c.ok);
  console.log(allPassed ? "\nAll checks passed!" : "\nSome checks failed.");

  return checks;
}
