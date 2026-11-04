// =============================================================================
// Fleet Manager — the `api.nodes.*` compatibility surface.
//
// The original Mosaic Companion Fleet Manager called its main process through
// a `window.<hostBridge>.nodes.*` namespace. This module presents the same
// names and the same call signatures, so the ported UI is unchanged, and
// implements each one against the capabilities a Mosaic add-on actually has:
//
//   - addonAPI.nodes.list()  — the user's node registry (read-only, nodes:read)
//   - addonAPI.files.*       — persistent storage, jailed to this add-on's
//                              own data/ directory
//   - fetch()                — direct HTTP to the node APIs, the AIM Manager
//                              and the public Tilling license-status endpoint
//
// The node-registry write methods (add / update / delete) are the one genuine
// difference: the registry belongs to the Mosaic application and the add-on
// API exposes it read-only. Those methods reject with a descriptive error
// rather than pretending to succeed.
//
// Every method returns a promise that rejects when the underlying operation is
// unavailable. No method fabricates a result.
// =============================================================================

import type { AddonApi } from "../types/addonApi";
import type {
  AimManagerResult,
  ExplorerNodeInfo,
  FleetAnalytics,
  FleetHistoryPoint,
  FleetSources,
  FleetState,
  HypercycleNode,
  NodeAlert,
  NodeDiagnosticResult,
  NodeHeartbeatAnalytics,
  NodeTestResult,
  SourceInspection,
  SourceProbe,
} from "./types";
import {
  deployAim,
  diagnoseFleet,
  diagnoseNode,
  getAimManagerInfo,
  removeAim,
  retryAim,
} from "./explorer.ts";
import {
  enrichExplorerLicenses,
  EXPLORER_LICENSE_DETAILS_URL,
  EXPLORER_LICENSE_STATUS_URL,
  fetchExplorerInfo,
  HYPERPG_NODES_URL,
  HYPERPG_TILLER_DATA_URL,
} from "./network.ts";
import {
  fleetAnalytics,
  fleetHistory,
  heartbeatAnalytics,
  incidentDurations,
  listNodes,
  loadState,
  nodeHistory,
  recordTransition,
  saveState,
  testNode,
} from "./host.ts";

/** Thrown when an operation is not available to an add-on. */
export class UnsupportedOperation extends Error {
  constructor(operation: string, reason: string) {
    super(`${operation} is not available to a Mosaic add-on: ${reason}`);
    this.name = "UnsupportedOperation";
  }
}

/**
 * The add-on's fleet state.
 *
 * The original kept its history and alerts in the main process, shared across
 * windows. An add-on's renderer is a single page, so the state lives here and
 * is mirrored to the add-on's data directory so it survives a reload.
 */
class FleetStore {
  private state: FleetState = { history: [], alerts: [], sources: {} };
  private loaded = false;
  private listeners = new Set<() => void>();

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.state = await loadState();
    this.loaded = true;
  }

  get(): FleetState {
    return this.state;
  }

  async update(mutator: (state: FleetState) => FleetState): Promise<void> {
    await this.ensureLoaded();
    this.state = mutator(this.state);
    await saveState(this.state);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const store = new FleetStore();

/**
 * Notifies the UI that the fleet state changed.
 *
 * The original main process pushed an event over IPC. An add-on renderer has
 * no equivalent channel, so the store notifies its own subscribers directly.
 */
export function onChanged(listener: () => void): () => void {
  return store.subscribe(listener);
}

// -----------------------------------------------------------------------------
// Node registry — read-only from an add-on
// -----------------------------------------------------------------------------

export async function get(): Promise<HypercycleNode[]> {
  return listNodes();
}

export async function list(): Promise<HypercycleNode[]> {
  return listNodes();
}

export async function add(_node: Partial<HypercycleNode>): Promise<HypercycleNode> {
  throw new UnsupportedOperation(
    "Adding a node",
    "the node registry is owned by the Mosaic application and exposed read-only via nodes:read",
  );
}

export async function update(
  _nodeId: string,
  _patch: Partial<HypercycleNode>,
): Promise<HypercycleNode> {
  throw new UnsupportedOperation(
    "Updating a node",
    "the node registry is owned by the Mosaic application and exposed read-only via nodes:read",
  );
}

export async function remove(_nodeId: string): Promise<void> {
  throw new UnsupportedOperation(
    "Deleting a node",
    "the node registry is owned by the Mosaic application and exposed read-only via nodes:read",
  );
}

// -----------------------------------------------------------------------------
// Testing
// -----------------------------------------------------------------------------

/** Tests one node and records the result in the fleet history. */
export async function test(node: HypercycleNode): Promise<NodeTestResult> {
  await store.ensureLoaded();
  const result = await testNode(node);
  await store.update((state) => {
    const previous = state.history;
    return {
      history: [...previous, result].slice(-5000),
      alerts: recordTransition(state.alerts, previous, node, result.alive, result.testedAt),
      sources: state.sources,
    };
  });
  return result;
}

/** Tests every given node and records all results. */
export async function testAll(nodes: HypercycleNode[]): Promise<NodeTestResult[]> {
  await store.ensureLoaded();
  const results: NodeTestResult[] = [];
  for (const node of nodes) results.push(await testNode(node));

  await store.update((state) => {
    let alerts = state.alerts;
    let history = [...state.history];
    for (const result of results) {
      const node = nodes.find((n) => n.id === result.nodeId);
      if (!node) continue;
      alerts = recordTransition(alerts, history, node, result.alive, result.testedAt);
      history = [...history, result].slice(-5000);
    }
    return { history, alerts, sources: state.sources };
  });

  return results;
}

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

export async function diagnose(node: HypercycleNode): Promise<NodeDiagnosticResult> {
  return diagnoseNode(node);
}

export async function diagnoseFleetFor(nodes: HypercycleNode[]): Promise<NodeDiagnosticResult[]> {
  return diagnoseFleet(nodes);
}

// -----------------------------------------------------------------------------
// Explorer
// -----------------------------------------------------------------------------

/**
 * Explorer information for a single license.
 *
 * The data comes from the public HyperCycle node list, which the Explorer
 * itself uses — see ./network.ts for why the add-on reads the JSON API
 * instead of scraping the Explorer page.
 */
export async function explorerLicenseInfo(licenseKey: string): Promise<ExplorerNodeInfo> {
  const license = String(licenseKey || "").trim();
  if (!license) return { error: "No license configured" };

  const { byLicense, error } = await fetchExplorerInfo();
  if (error) return { licenseKey: license, error };

  // The per-license endpoints carry the license-level facts the fleet-wide
  // node list does not (CHyPC, chain, block, delegate, computation count).
  const enriched = await enrichExplorerLicenses(byLicense, [license]);
  const found = enriched[license];
  if (found && (byLicense[license] || hasPublishedFacts(found))) return found;
  return { licenseKey: license, error: "License not present in the public node list" };
}

/**
 * Whether a source published anything about a license.
 *
 * A license that appears in neither the public node list nor the Explorer's
 * own per-license endpoints is reported as missing. It is not given an empty
 * record, because an empty record reads as "a license with no figures" —
 * which is a different claim from "a license nobody publishes".
 */
function hasPublishedFacts(info: ExplorerNodeInfo): boolean {
  return (
    info.status != null ||
    info.chypc != null ||
    info.chain != null ||
    info.block != null ||
    info.upPercent != null ||
    info.heartbeat != null ||
    info.computation != null
  );
}

/**
 * Explorer information for a set of licenses.
 *
 * The shape matches what the original main-process API returned: one row per
 * license, each with the parsed data or the reason it is missing.
 */
export async function explorerFleetInfo(
  licenses?: string[],
): Promise<Array<{ license: string; data?: ExplorerNodeInfo; error?: string }>> {
  const { byLicense, error } = await fetchExplorerInfo();
  if (error) {
    return (licenses ?? []).map((license) => ({ license, error }));
  }

  const keys = licenses && licenses.length ? licenses : Object.keys(byLicense);

  // The per-license sources are queried only for the licenses asked for. The
  // fleet-wide view already has the uptime and status figures; the extra
  // endpoints are per-license, so requesting the whole fleet would mean one
  // request per node.
  const requested = keys.map((license) => String(license || "").trim()).filter(Boolean);
  const enriched = await enrichExplorerLicenses(byLicense, requested);

  return keys.map((license) => {
    const key = String(license || "").trim();
    const found = enriched[key];
    if (found) return { license: key, data: found };
    return { license: key, error: "License not present in the public node list" };
  });
}

/**
 * Inspects the public sources for structured performance data.
 *
 * The Explorer page is a client-rendered SPA with no HTML endpoint to inspect,
 * so this reads the JSON APIs the Explorer itself uses and reports which
 * performance fields they actually carry.
 */
export async function explorerSourceInspect(license: string): Promise<SourceInspection> {
  const key = String(license || "").trim();
  if (!key) return { error: "No license to inspect" };

  const { byLicense, error } = await fetchExplorerInfo();
  if (error) return { error };

  const info = byLicense[key];

  const metricHits = Object.entries({
    status: info?.status,
    upPercent: info?.upPercent,
    upTime: info?.upTime,
    downTime: info?.downTime,
    heartbeat: info?.heartbeat,
    chypc: info?.chypc,
    tillingScore: info?.tillingScore,
  })
    .filter(([, value]) => value != null)
    .map(([name]) => name);

  // Each candidate source is really requested. The previous implementation
  // returned a hand-written `ok: true, status: 200` for a source it had
  // never contacted, which reported a successful check that never happened.
  const candidates = [
    HYPERPG_NODES_URL,
    HYPERPG_TILLER_DATA_URL,
    `${EXPLORER_LICENSE_STATUS_URL}?license=${encodeURIComponent(key)}&network=mainnet`,
    `${EXPLORER_LICENSE_DETAILS_URL}?license=${encodeURIComponent(key)}&network=mainnet&page=1&limit=5`,
  ];

  const probes: SourceProbe[] = await Promise.all(
    candidates.map(async (url) => {
      const started = Date.now();
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        const contentType = response.headers.get("Content-Type") ?? undefined;
        const text = await response.text();
        let jsonKeys: string[] = [];
        try {
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === "object") {
            jsonKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 20);
          }
        } catch {
          jsonKeys = [];
        }
        return {
          url,
          ok: response.ok,
          status: response.status,
          contentType,
          metricHits: response.ok ? metricHits : [],
          jsonKeys,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (probeError) {
        return {
          url,
          ok: false,
          error: probeError instanceof Error ? probeError.message : String(probeError),
          metricHits: [],
          jsonKeys: [],
        };
      } finally {
        void started;
      }
    }),
  );

  return {
    matchingResources: probes.filter((p) => p.ok).map((p) => p.url),
    bodyHints: metricHits.length
      ? metricHits.map((name) => `${name} published by the public node list`)
      : [],
    probes,
  };
}

// -----------------------------------------------------------------------------
// AIM
// -----------------------------------------------------------------------------

export async function aimManagerInfo(node: HypercycleNode): Promise<ReturnType<typeof getAimManagerInfo>> {
  return getAimManagerInfo(node);
}

export async function aimDeploy(
  node: HypercycleNode,
  input: { name: string; tag: string; port: number },
): Promise<AimManagerResult> {
  return deployAim(node, input);
}

export async function aimRemove(node: HypercycleNode, slot: number): Promise<AimManagerResult> {
  return removeAim(node, slot);
}

export async function aimRetry(node: HypercycleNode, slot: number): Promise<AimManagerResult> {
  return retryAim(node, slot);
}

// -----------------------------------------------------------------------------
// Analytics and history
// -----------------------------------------------------------------------------

export async function analytics(): Promise<FleetAnalytics> {
  await store.ensureLoaded();
  const nodes = await listNodes();
  const { history, alerts } = store.get();
  return fleetAnalytics(nodes, history, alerts, Date.now());
}

export async function heartbeat(nodeId: string): Promise<NodeHeartbeatAnalytics> {
  await store.ensureLoaded();
  return heartbeatAnalytics(nodeId, store.get().history);
}

export async function history(nodeId: string, limit = 300): Promise<FleetHistoryPoint[]> {
  await store.ensureLoaded();
  return nodeHistory(nodeId, store.get().history).slice(0, limit);
}

export async function fleetHistoryPoints(limit = 1500): Promise<FleetHistoryPoint[]> {
  await store.ensureLoaded();
  return fleetHistory(store.get().history).slice(0, limit);
}

// -----------------------------------------------------------------------------
// Alerts
// -----------------------------------------------------------------------------

export async function alerts(nodeId?: string, limit = 100): Promise<NodeAlert[]> {
  await store.ensureLoaded();
  const { alerts: all, history } = store.get();
  const durations = incidentDurations(all, history);
  const filtered = nodeId ? all.filter((a) => a.nodeId === nodeId) : all;
  return filtered
    .slice(-limit)
    .reverse()
    .map((alert) => {
      const durationSec = durations[alert.id];
      // An open incident has no duration yet — the field stays absent
      // rather than reporting the elapsed time as if it were the length.
      return durationSec != null ? { ...alert, durationSec } : { ...alert };
    });
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  await store.update((state) => ({
    ...state,
    alerts: state.alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
  }));
}

export async function acknowledgeAllAlerts(): Promise<void> {
  await store.update((state) => ({
    ...state,
    alerts: state.alerts.map((a) => ({ ...a, acknowledged: true })),
  }));
}

export async function clearAlerts(): Promise<void> {
  await store.update((state) => ({ ...state, alerts: [] }));
}

// -----------------------------------------------------------------------------
// Sources
// -----------------------------------------------------------------------------

export async function sourcesGet(): Promise<FleetSources> {
  await store.ensureLoaded();
  return store.get().sources;
}

export async function sourcesSet(sources: FleetSources): Promise<void> {
  await store.update((state) => ({ ...state, sources: { ...state.sources, ...sources } }));
}

/**
 * Reads one source's current reachability.
 *
 * The result reports whether the URL answered. It never substitutes a stored
 * value for a live one, and it never invents a value when the source is
 * unreachable.
 */
export async function sourceRead(key: keyof FleetSources): Promise<{
  key: string;
  ok: boolean;
  status?: number;
  error?: string;
}> {
  await store.ensureLoaded();
  const url = store.get().sources[key];
  if (!url) return { key: String(key), ok: false, error: "Not configured" };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { key: String(key), ok: response.ok, status: response.status };
  } catch (error) {
    return {
      key: String(key),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

/**
 * Exports the fleet history and alerts as sanitised JSON.
 *
 * "Sanitised" means: no license keys, no sender addresses, no hostnames and
 * no probe payloads — only the node id, the timestamps and the outcome. The
 * export is meant to be shareable, so it carries nothing that identifies the
 * operator's infrastructure.
 */
export async function exportSanitized(): Promise<{
  generatedAt: string;
  nodes: Array<{
    nodeId: string;
    alive: boolean;
    totalLatencyMs: number;
    testedAt: string;
  }>;
  alerts: Array<{ type: string; createdAt: string }>;
}> {
  await store.ensureLoaded();
  const { history, alerts: allAlerts } = store.get();
  return {
    generatedAt: new Date().toISOString(),
    nodes: history.map((h) => ({
      nodeId: h.nodeId,
      alive: h.alive,
      totalLatencyMs: h.totalLatencyMs,
      testedAt: h.testedAt,
    })),
    alerts: allAlerts.map((a) => ({ type: a.type, createdAt: a.createdAt })),
  };
}

// -----------------------------------------------------------------------------
// External links
// -----------------------------------------------------------------------------

/**
 * Opens a URL in the user's browser.
 *
 * The host routes this through `ui.openExternal`, which requires the
 * `shell:open-external` permission. It is the only way an add-on can hand a
 * user a link to the public Explorer page for a license.
 */
export async function openExternal(url: string): Promise<void> {
  const addonAPI = (globalThis as unknown as { addonAPI?: AddonApi }).addonAPI;
  if (!addonAPI?.ui?.openExternal) {
    throw new UnsupportedOperation("Opening an external link", "the host does not expose ui.openExternal");
  }
  await addonAPI.ui.openExternal(url);
}

// -----------------------------------------------------------------------------
// The surface the UI uses
// -----------------------------------------------------------------------------

/** The namespaced API object, matching the shape the ported UI expects. */
export const api = {
  nodes: {
    get,
    list,
    add,
    update,
    delete: remove,
    test,
    testAll,
    diagnose,
    diagnoseFleet: diagnoseFleetFor,
    explorerLicense: explorerLicenseInfo,
    explorerFleet: explorerFleetInfo,
    explorerSourceInspect,
    aimManagerInfo,
    aimDeploy,
    aimRemove,
    aimRetry,
    analytics,
    heartbeat,
    history,
    fleetHistory: fleetHistoryPoints,
    alerts,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    clearAlerts,
    sourcesGet,
    sourcesSet,
    sourceRead,
    exportSanitized,
    onChanged,
    openExternal,
  },
};
