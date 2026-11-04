// =============================================================================
// Fleet Manager — host layer.
//
// The original Mosaic Companion implementation of the Fleet Manager ran in the
// Electron main process and exposed ~31 methods over the `nodes` IPC namespace
// (electron/nodeManagerService.ts + electron/main.ts). A Mosaic add-on runs in
// a sandboxed webview — isolated context, no Node integration, sandbox on —
// and reaches the host only through the `window.addonAPI` bridge.
//
// `main.entry` — the one way an add-on could get a Node/Electron module — is
// restricted by the host to an allowlist containing only "hyperinsight"
// (electron/addons/manifest.ts, MAIN_ENTRY_ALLOWLIST). A new add-on cannot
// ship one. So the whole Fleet Manager is reimplemented in the renderer, on
// top of the three capabilities an add-on actually has:
//
//   1. addonAPI.nodes.list()        — the user's local node registry (nodes:read)
//   2. addonAPI.files.*             — persistent storage, jailed to this
//                                    add-on's own data/ directory
//   3. fetch()                      — direct HTTP to the node APIs and the
//                                    public HyperCycle data sources
//
// Nothing here fabricates a statistic. When a value cannot be obtained from
// an authoritative source it stays undefined and the UI shows "—".
//
// The pure parts of the model — the transitions, the analytics, the history —
// live in ./fleet.ts, which has no host or network dependency so it can be
// tested directly.
// =============================================================================

import {
  ALERT_COOLDOWN_MS,
  MAX_ALERTS,
  MAX_HISTORY,
  baseUrlFor,
  cleanHost,
  defaultPortFor,
  findReportedUptime,
  fleetAnalytics,
  fleetHistory,
  heartbeatAnalytics,
  incidentDurations,
  nodeHistory,
  recordTransition,
} from "./fleet.ts";
import { queryTillingStatus } from "./network.ts";
import type { AddonApi } from "../types/addonApi";
import type {
  FleetSources,
  FleetState,
  HypercycleNode,
  NodeAlert,
  NodeHeartbeatAnalytics,
  NodeTestResult,
  ProbeResult,
  TillingResult,
} from "./types";

/** How long a single HTTP probe may take before it is considered failed. */
const PROBE_TIMEOUT_MS = 5000;

/** Where the add-on's persistent state lives, relative to its files jail. */
const STATE_FILE = "fleet-manager-state.json";

export {
  ALERT_COOLDOWN_MS,
  MAX_ALERTS,
  MAX_HISTORY,
  baseUrlFor,
  cleanHost,
  defaultPortFor,
  findReportedUptime,
  fleetAnalytics,
  fleetHistory,
  heartbeatAnalytics,
  incidentDurations,
  nodeHistory,
  recordTransition,
};

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fetches a URL and reports how it went. Never throws: a failed probe is a
 * result, not an exception, because "the node did not answer" is exactly the
 * information the Fleet Manager exists to show.
 */
async function probe(
  url: string,
  init?: RequestInit,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; status?: number; latencyMs: number; data?: unknown; error?: string }> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 4000);
    }
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, data };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// -----------------------------------------------------------------------------
// Host access — the three capabilities an add-on actually has
// -----------------------------------------------------------------------------

/**
 * The host bridge, bound once.
 *
 * `addonAPI` is the whole of what a Mosaic add-on can reach the host through.
 * It is absent outside Mosaic (a plain browser, a test harness), so every use
 * goes through `hostApi()`, which fails loudly rather than silently returning
 * nothing.
 */
/**
 * Reads the host bridge.
 *
 * The bridge is looked up on each call rather than captured when the module
 * is loaded. Capturing it at load time made importing this module fail
 * outright anywhere `window` does not exist — which is exactly what the
 * test suite does — and it also meant the add-on could not notice the host
 * being replaced.
 */
function hostApi(): AddonApi {
  const addonAPI = (globalThis as unknown as { addonAPI?: AddonApi }).addonAPI;
  if (!addonAPI) {
    throw new Error(
      "window.addonAPI is unavailable — this page is not running inside Mosaic Companion",
    );
  }
  return addonAPI;
}

/**
 * Reads the node registry through the host. The registry is the user's own
 * configuration (names, hosts, ports, license keys) — read-only, and the only
 * Mosaic permission this add-on needs to declare for it.
 */
export async function listNodes(): Promise<HypercycleNode[]> {
  try {
    const raw = await hostApi().nodes.list();
    if (!Array.isArray(raw)) return [];
    return raw.filter(isPlainObject).map((n) => n as unknown as HypercycleNode);
  } catch {
    return [];
  }
}

/** Reads the AIM data the host has cached locally for a license, if any. */
export async function getSavedAims(license?: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await hostApi().nodes.getSavedAims(license);
    return isPlainObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Persistent state — the add-on's own data/ directory
// -----------------------------------------------------------------------------

const EMPTY_STATE: FleetState = { history: [], alerts: [], sources: {} };

/**
 * Loads the persisted state. A corrupt or absent file yields an empty state
 * rather than an error: losing history must never stop the add-on from
 * working.
 */
export async function loadState(): Promise<FleetState> {
  try {
    const text = await hostApi().files.read(STATE_FILE);
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) return { ...EMPTY_STATE };
    return {
      history: Array.isArray(parsed.history) ? (parsed.history as NodeTestResult[]) : [],
      alerts: Array.isArray(parsed.alerts) ? (parsed.alerts as NodeAlert[]) : [],
      sources: isPlainObject(parsed.sources) ? (parsed.sources as FleetSources) : {},
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Persists the state, trimmed to the configured bounds. */
export async function saveState(state: FleetState): Promise<void> {
  const trimmed: FleetState = {
    history: state.history.slice(-MAX_HISTORY),
    alerts: state.alerts.slice(-MAX_ALERTS),
    sources: state.sources,
  };
  try {
    await hostApi().files.write(STATE_FILE, JSON.stringify(trimmed, null, 2));
  } catch {
    /* a failed write loses history, never the session */
  }
}

// -----------------------------------------------------------------------------
// Node testing
// -----------------------------------------------------------------------------

/**
 * Queries the authoritative Tilling license-status endpoint for a license.
 *
 * Implemented in ./network.ts, which documents why the endpoint is reachable
 * from a renderer and what happens when it is not.
 */
export async function queryTilling(licenseKey: string): Promise<TillingResult> {
  return queryTillingStatus(licenseKey);
}

/**
 * Decides whether a node answered, from the two endpoints that answer for it.
 *
 * A node is alive when **either** of its own endpoints answered:
 *
 *   - `/info` — the node's own description of itself. It carries
 *     `"status": "alive"` and is the endpoint every HyperCycle node
 *     implements.
 *   - `/health` — a liveness endpoint that only some node versions expose.
 *
 * The two are not interchangeable, and the difference was measured against
 * the live network rather than assumed:
 *
 *   - On node versions 0.5.x, `/health` answers **HTTP 405 Method Not
 *     Allowed** while `/info` answers **HTTP 200** with
 *     `"status": "alive"`. Six public nodes were in exactly this state.
 *   - A node that is genuinely down answers neither.
 *
 * Treating `/health` as the only source of liveness therefore marked six
 * live nodes DEAD. The original Mosaic implementation used
 * `info.ok || health.ok` for the same reason, and this restores that
 * semantics.
 *
 * When `/info` answers, its own `status` field is preferred when it is
 * present, because that is the node reporting on itself rather than the
 * monitor inferring from a transport-level code.
 */
export function isNodeAlive(info: ProbeResult, health: ProbeResult): boolean {
  if (info.ok) {
    const reported = readReportedStatus(info.data);
    if (reported) return reported === "alive";
    return true;
  }
  return health.ok;
}

/** Reads a node's self-reported status from its `/info` payload. */
function readReportedStatus(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string") return undefined;
  const normalized = status.trim().toLowerCase();
  if (!normalized) return undefined;
  // The node reports its own liveness in one of these words.
  if (normalized === "alive" || normalized === "offline" || normalized === "dead") {
    return normalized;
  }
  return undefined;
}

/**
 * Tests one node: health, info and Tilling.
 *
 * `alive` follows the node's own answer — see `isNodeAlive` for the
 * measured behaviour this encodes.
 */
export async function testNode(node: HypercycleNode): Promise<NodeTestResult> {
  const started = Date.now();
  const base = baseUrlFor(node);
  const tests: Record<string, ProbeResult> = {};

  const health = await probe(`${base}/health`);
  tests.health = health;

  const info = await probe(`${base}/info`);
  tests.info = info;

  const tilling = await queryTilling(String(node.licenseKey || ""));
  tests.tilling = {
    ok: tilling.ok,
    latencyMs: tilling.latencyMs,
    skipped: tilling.skipped,
    error: tilling.error,
    data: { status: tilling.status, statusSince: tilling.statusSince },
  };

  return {
    nodeId: node.id,
    testedAt: new Date().toISOString(),
    alive: isNodeAlive(info, health),
    totalLatencyMs: Date.now() - started,
    tests,
    info: info.data,
    tilling,
  };
}

/** Tests every node in the registry, sequentially, preserving order. */
export async function testAllNodes(nodes: HypercycleNode[]): Promise<NodeTestResult[]> {
  const results: NodeTestResult[] = [];
  for (const node of nodes) results.push(await testNode(node));
  return results;
}
