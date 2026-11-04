// =============================================================================
// Fleet Manager — diagnostics, Explorer, source discovery and AIM management.
//
// Ported from the original Mosaic Companion implementation
// (electron/nodeDiagnosticsService.ts, electron/aimManagerService.ts,
// electron/explorerService.ts in Mosaic-fleet-manager v1.0.0).
//
// The original ran these from the Electron main process, where an outbound
// request is a plain `fetch`. Here they run in the renderer, which is also a
// plain `fetch` — the add-on's webview sets no Content-Security-Policy, so
// the request is subject only to the target server's own CORS policy. A node
// that does not send CORS headers therefore fails the probe; that is reported
// as a failure rather than hidden.
//
// Every value produced here comes from a live response. A field the server did
// not send stays `undefined` — it is never estimated, defaulted or invented.
// =============================================================================

import type {
  AimManagerResult,
  DiagnosticCheck,
  ExplorerNodeInfo,
  HypercycleNode,
  NodeDiagnosticResult,
  SourceInspection,
  SourceProbe,
} from "./types";
import { baseUrlFor, cleanHost } from "./host.ts";

/** How long the Explorer page may take to load. */
const PAGE_TIMEOUT_MS = 10000;

/**
 * The terms the source-discovery pass looks for in the resources a public
 * license page loads. The pass only *reads* what the page itself loaded —
 * it sends no transaction and mutates no state.
 */
const RELEVANT_TERMS = [
  "api",
  "graphql",
  "json",
  "tilling",
  "computation",
  "reputation",
  "unlock",
  "uptime",
  "heartbeat",
  "scale",
];

/** The JSON keys the source-discovery pass treats as performance metrics. */
const METRIC_KEYS = [
  "uptime",
  "up_percent",
  "uptimepercent",
  "downtime",
  "heartbeat",
  "computation",
  "reputation",
  "tilling",
  "tilling_score",
  "tillingscore",
  "tilling_ratio",
  "tillingratio",
  "scaling_factor",
  "scalingfactor",
  "chypc",
  "online_hours",
  "offline_hours",
  "status",
  "level",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readText(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

/**
 * Runs the node's own diagnostic endpoints.
 *
 * The endpoint names and the ports are the ones the original implementation
 * used, so a node that answered the original Fleet Manager answers this one
 * identically. A node that does not serve an endpoint simply reports that
 * check as failed or skipped — it is never assumed to be healthy.
 */
export async function diagnoseNode(node: HypercycleNode): Promise<NodeDiagnosticResult> {
  const nodePort = String(node.apiPort || (node.network === "BASE" ? "8010" : "8000"));
  const aimManagerPort = String(node.aimManagerPort || "8005");
  const aimPort = String(node.aimPort || "9000");

  const checks: DiagnosticCheck[] = [];

  const base = (port: string) => `http://${cleanHost(node.apiHost)}:${port}`;

  const check = async (
    key: string,
    label: string,
    url: string,
    timeoutMs = 5000,
  ): Promise<DiagnosticCheck> => {
    const started = Date.now();
    try {
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      return { key, label, ok: response.ok, status: response.status, latencyMs: Date.now() - started, url };
    } catch (error) {
      return {
        key,
        label,
        ok: false,
        latencyMs: Date.now() - started,
        url,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  checks.push(await check("node-info", "Node /info", `${base(nodePort)}/info`));
  checks.push(await check("node-health", "Node /health", `${base(nodePort)}/health`));
  checks.push(await check("aim-manager", `AIM Manager :${aimManagerPort}`, `${base(aimManagerPort)}/`));
  checks.push(await check("aim-service", `AIM service :${aimPort}`, `${base(aimPort)}/`));

  if (node.hasAdminPanel || node.adminPort) {
    const adminPort = String(node.adminPort || "8006");
    const adminHost = cleanHost(node.adminHost || node.apiHost);
    checks.push(
      await check("admin-panel", `Admin Panel :${adminPort}`, `http://${adminHost}:${adminPort}/`),
    );
  } else {
    checks.push({
      key: "admin-panel",
      label: "Admin Panel",
      ok: null,
      skipped: true,
      error: "Admin panel is not configured for this node.",
    });
  }

  const passed = checks.filter((c) => c.ok === true).length;
  const failed = checks.filter((c) => c.ok === false).length;
  const skipped = checks.filter((c) => c.skipped).length;

  const nodeOk =
    checks.some((c) => c.key === "node-info" && c.ok === true) ||
    checks.some((c) => c.key === "node-health" && c.ok === true);
  const overall: NodeDiagnosticResult["overall"] = !nodeOk
    ? "OFFLINE"
    : failed
      ? "DEGRADED"
      : "HEALTHY";

  return { nodeId: node.id, testedAt: new Date().toISOString(), overall, checks, summary: { passed, failed, skipped } };
}

/** Runs diagnostics across the given nodes. */
export async function diagnoseFleet(nodes: HypercycleNode[]): Promise<NodeDiagnosticResult[]> {
  const results: NodeDiagnosticResult[] = [];
  for (const node of nodes) {
    if (node.isActive === false) continue;
    results.push(await diagnoseNode(node));
  }
  return results;
}

// -----------------------------------------------------------------------------
// AIM management — the officially documented Node Manager lifecycle endpoints
// -----------------------------------------------------------------------------

function aimManagerBase(node: HypercycleNode): string {
  return `http://${cleanHost(node.apiHost)}:${String(node.aimManagerPort || "8005")}`;
}

async function aimRequest(
  url: string,
  init?: RequestInit,
): Promise<AimManagerResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json, text/plain, */*", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 8000);
    }
    if (!response.ok) {
      // A failed operation must say why it failed. Returning `ok: false` with
      // no error left the operator looking at a failure with no explanation.
      const detail =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        latencyMs: Date.now() - started,
        url,
        data,
        error: detail,
      };
    }
    return { ok: true, status: response.status, latencyMs: Date.now() - started, url, data };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Deploys an AIM through the documented `POST /add_aim` endpoint. */
export async function deployAim(
  node: HypercycleNode,
  input: { name: string; tag: string; port: number },
): Promise<AimManagerResult> {
  const name = String(input.name || "").trim();
  const tag = String(input.tag || "").trim();
  const port = Number(input.port);
  const url = `${aimManagerBase(node)}/add_aim`;
  if (!name || !tag) {
    return { ok: false, latencyMs: 0, url, error: "Name and tag are required." };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, latencyMs: 0, url, error: "Invalid port." };
  }
  return aimRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, tag, port }),
  });
}

/** Removes an AIM through the documented `POST /remove_aim/<slot>` endpoint. */
export async function removeAim(node: HypercycleNode, slot: number): Promise<AimManagerResult> {
  const url = `${aimManagerBase(node)}/remove_aim/${slot}`;
  if (!Number.isInteger(slot) || slot < 0) {
    return { ok: false, latencyMs: 0, url, error: "Invalid slot." };
  }
  return aimRequest(url, { method: "POST" });
}

/** Retries an AIM through the documented `POST /retry_aim/<slot>` endpoint. */
export async function retryAim(node: HypercycleNode, slot: number): Promise<AimManagerResult> {
  const url = `${aimManagerBase(node)}/retry_aim/${slot}`;
  if (!Number.isInteger(slot) || slot < 0) {
    return { ok: false, latencyMs: 0, url, error: "Invalid slot." };
  }
  return aimRequest(url, { method: "POST" });
}

/** Describes the AIM Manager endpoint for a node, without contacting it. */
export function getAimManagerInfo(node: HypercycleNode): {
  host: string;
  port: string;
  baseUrl: string;
  documentedEndpoints: string[];
} {
  const port = String(node.aimManagerPort || "8005");
  return {
    host: node.apiHost,
    port,
    baseUrl: aimManagerBase(node),
    documentedEndpoints: ["/add_aim", "/remove_aim/<aim_slot>", "/retry_aim/<aim_slot>"],
  };
}

// -----------------------------------------------------------------------------
// Explorer
// -----------------------------------------------------------------------------

/**
 * Derives Explorer information from a JSON document.
 *
 * The document's shape is not guaranteed, so each field is looked up under
 * several plausible names. A field that is not present is left undefined —
 * the UI then shows "—" and, where relevant, "awaiting source".
 */
export function parseExplorerPayload(payload: unknown, licenseKey?: string): ExplorerNodeInfo {
  if (!isPlainObject(payload)) {
    return { licenseKey, error: "No structured response" };
  }
  const root = payload;
  const candidates: Record<string, unknown>[] = [root];
  for (const key of ["data", "result", "license", "node", "stats"]) {
    const nested = root[key];
    if (isPlainObject(nested)) candidates.push(nested);
  }

  const info: ExplorerNodeInfo = { licenseKey };

  for (const candidate of candidates) {
    if (info.status == null) info.status = readText(candidate, ["status", "state", "node_status"]);
    if (info.level == null) {
      const level = readNumber(candidate, ["level", "tier", "node_level"]);
      if (level != null) info.level = level;
    }
    if (info.upPercent == null) {
      const up = readNumber(candidate, ["up_percent", "uptimePercent", "uptime_percent"]);
      if (up != null) info.upPercent = up;
    }
    if (info.upTime == null) {
      const up = readNumber(candidate, ["uptime", "up_time", "upTime", "up_seconds"]);
      if (up != null) info.upTime = up;
    }
    if (info.downTime == null) {
      const down = readNumber(candidate, ["downtime", "down_time", "downTime", "down_seconds"]);
      if (down != null) info.downTime = down;
    }
    if (info.heartbeat == null) {
      const hb = readNumber(candidate, ["heartbeat", "heartbeats", "heartbeat_count"]);
      if (hb != null) info.heartbeat = hb;
    }
    if (info.computation == null) {
      const c = readNumber(candidate, ["computation", "computation_power", "computationPower"]);
      if (c != null) info.computation = c;
    }
    if (info.reputation == null) {
      const r = readNumber(candidate, ["reputation", "reputation_score", "reputationScore"]);
      if (r != null) info.reputation = r;
    }
    if (info.tillingScore == null) {
      const t = readNumber(candidate, ["tilling_score", "tillingScore"]);
      if (t != null) info.tillingScore = t;
    }
    if (info.tillingRatio == null) {
      const t = readNumber(candidate, ["tilling_ratio", "tillingRatio"]);
      if (t != null) info.tillingRatio = t;
    }
    if (info.scalingFactor == null) {
      const s = readNumber(candidate, ["scaling_factor", "scalingFactor", "scale_factor"]);
      if (s != null) info.scalingFactor = s;
    }
    if (info.chypc == null) {
      const c = readNumber(candidate, ["chypc", "chy_pc", "chypc_score"]);
      if (c != null) info.chypc = c;
    }
    if (info.onlineHours == null) {
      const h = readNumber(candidate, ["online_hours", "onlineHours", "total_online_hours", "totalOnlineHours"]);
      if (h != null) info.onlineHours = h;
    }
    if (info.offlineHours == null) {
      const h = readNumber(candidate, ["offline_hours", "offlineHours", "total_offline_hours", "totalOfflineHours"]);
      if (h != null) info.offlineHours = h;
    }
    if (info.totalOnlineHours == null && info.onlineHours != null) info.totalOnlineHours = info.onlineHours;
    if (info.totalOfflineHours == null && info.offlineHours != null) info.totalOfflineHours = info.offlineHours;
    if (info.network == null) info.network = readText(candidate, ["network", "chain"]);
  }

  if (info.upPercent == null && info.upTime != null && info.downTime != null) {
    const total = info.upTime + info.downTime;
    if (total > 0) info.upPercent = (info.upTime / total) * 100;
  }

  return info;
}

/**
 * Fetches Explorer information for a single license.
 *
 * `source` is the Explorer base URL the user configured; when it is not set
 * the function reports that no source is configured instead of guessing one.
 */
export async function explorerLicense(
  licenseKey: string,
  source: string | undefined,
): Promise<ExplorerNodeInfo> {
  const license = String(licenseKey || "").trim();
  if (!license) return { error: "No license configured" };
  if (!source) return { licenseKey: license, error: "No Explorer source configured" };

  const base = source.replace(/\/+$/, "");
  const url = `${base}/license/${encodeURIComponent(license)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) return { licenseKey: license, error: `HTTP ${response.status}` };
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return { licenseKey: license, error: "Response was not JSON" };
    }
    return parseExplorerPayload(payload, license);
  } catch (error) {
    return { licenseKey: license, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fetches Explorer information for every node that has a license. */
export async function explorerFleet(
  nodes: HypercycleNode[],
  source: string | undefined,
): Promise<Record<string, ExplorerNodeInfo>> {
  const result: Record<string, ExplorerNodeInfo> = {};
  for (const node of nodes) {
    const key = String(node.licenseKey || "").trim();
    if (!key) continue;
    result[key] = await explorerLicense(key, source);
  }
  return result;
}

/**
 * Inspects the resources a public license page loads, looking for API
 * endpoints that expose structured performance data.
 *
 * Read-only by construction: it fetches the page the user named and then
 * fetches only the resources that page itself referenced.
 */
export async function explorerSourceInspect(pageUrl: string): Promise<SourceInspection> {
  const url = String(pageUrl || "").trim();
  if (!url) return { error: "No URL to inspect" };

  let html: string;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    html = await response.text();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const matchingResources: string[] = [];
  const bodyHints: string[] = [];

  const urlPattern = /https?:\/\/[^\s"'<>)]+/gi;
  const seen = new Set<string>();
  for (const match of html.matchAll(urlPattern)) {
    const candidate = match[0].replace(/[.,;]+$/, "");
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const lower = candidate.toLowerCase();
    if (RELEVANT_TERMS.some((term) => lower.includes(term))) matchingResources.push(candidate);
  }

  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const term of RELEVANT_TERMS) {
    const index = text.toLowerCase().indexOf(term);
    if (index >= 0) {
      bodyHints.push(text.slice(Math.max(0, index - 60), index + 120).trim());
      if (bodyHints.length >= 40) break;
    }
  }

  return { matchingResources: matchingResources.slice(0, 60), bodyHints };
}

/**
 * Tests the discovered sources directly, reporting HTTP status, content type
 * and any performance-relevant JSON fields found. No transaction is sent.
 */
export async function probeSources(urls: string[]): Promise<SourceProbe[]> {
  const probes: SourceProbe[] = [];
  for (const url of urls.slice(0, 20)) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      const text = await response.text();
      const probe: SourceProbe = {
        url,
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") || undefined,
      };
      try {
        const payload = JSON.parse(text) as unknown;
        if (isPlainObject(payload)) {
          const jsonKeys = Object.keys(payload);
          probe.jsonKeys = jsonKeys.slice(0, 40);
          const metricHits = jsonKeys.filter((key) =>
            METRIC_KEYS.some((metric) => key.toLowerCase().includes(metric)),
          );
          if (metricHits.length) probe.metricHits = metricHits;
        }
      } catch {
        /* not JSON — the HTTP result alone is still reported */
      }
      probes.push(probe);
    } catch (error) {
      probes.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return probes;
}
