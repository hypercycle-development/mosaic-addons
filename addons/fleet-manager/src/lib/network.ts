// =============================================================================
// Fleet Manager — the public HyperCycle network data sources.
//
// The original Mosaic Companion Node Manager read Explorer data by loading
// `https://explorer.hypercycle.ai/license/<license>` in a hidden Electron
// BrowserWindow and scraping `document.body.innerText` after the client-rendered
// page had painted (electron/explorerService.ts → `fetchExplorerLicense`).
//
// That is not available to an add-on: `main.entry` is allowlisted to
// `hyperinsight` alone, so an add-on renderer has no BrowserWindow and cannot
// script a second document.
//
// The Explorer itself does not scrape — it reads public JSON REST APIs. Those
// APIs are CORS-open, so an add-on renderer can call them directly and get the
// same numbers the Explorer displays, from a more authoritative source than a
// text scrape:
//
//   https://services.hyperpg.site/node-rpc/hypercycle/nodes/
//     -> { nodes: [ { data: { status, license, network, address,
//                          uptime_summary: { total_time, up_time, down_time,
//                                             percent_up, heartbeats } } } ] }
//
//   https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet
//     -> [ { node_license, slot, tillers: [ { till_status, heartbeats, … } ] } ]
//
// The Explorer itself also exposes two per-license JSON endpoints, which are
// the source of the license-level figures the Explorer page displays:
//
//   https://explorer.hypercycle.ai/v1/licenses/status?license=<n>&network=<net>
//     -> { licenseStatus: { delegate_data: { owner: { chain, address },
//          key, block, message, signature, chypc, priority, did },
//          status, status-since },
//          licenseInfo: { count, license, id } }
//
//   https://explorer.hypercycle.ai/v1/licenses/details?license=<n>&network=<net>
//     -> { uptimeReports: { updates: [ { ts, status, computations, ... } ],
//          summary: { total_time, up_time, down_time, percent_up },
//          summary_inherited: { ... }, reference_license }, page, limit }
//
// Both were verified to answer 200 with `Access-Control-Allow-Origin: *`, so
// a renderer can call them directly.
//
// // Every field below is read from a live response. A field the response did not
// carry stays `undefined` — nothing is estimated or invented.
// =============================================================================

import type { ExplorerNodeInfo, HypercycleNode } from "./types";

/** The public node-registry API the Explorer itself uses. */
export const HYPERPG_NODES_URL = "https://services.hyperpg.site/node-rpc/hypercycle/nodes/";

/** The public tiller-data API, per network. */
export const HYPERPG_TILLER_DATA_URL =
  "https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet";

/** The authoritative Tilling license-status endpoint. */
export const TILLING_LICENSE_STATUS_URL = "http://tilling.ioai.services:8003/license_status";

/** The Explorer's public per-license status endpoint (CORS-open, verified). */
export const EXPLORER_LICENSE_STATUS_URL =
  "https://explorer.hypercycle.ai/v1/licenses/status";

/** The Explorer's public per-license details endpoint (CORS-open, verified). */
export const EXPLORER_LICENSE_DETAILS_URL =
  "https://explorer.hypercycle.ai/v1/licenses/details";

/** How long the network APIs may take to answer. */
const NETWORK_TIMEOUT_MS = 12000;

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

/**
 * Reads a license identifier.
 *
 * The public node list publishes `license` in two shapes: a bare string on
 * mainnet, and an object — `{ id, chain, owner_address, last_updated_at,
 * heartbeats }` — on the base chain. Reading it as a plain string dropped
 * every base-chain node from the fleet, so both shapes are accepted here and
 * the identifier is taken from `id` when the value is an object.
 */
function readLicenseId(source: Record<string, unknown>): string | undefined {
  const value = source.license;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (isPlainObject(value)) {
    const id = value.id;
    if (typeof id === "string" && id.trim() !== "") return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }
  return undefined;
}

/**
 * Reads the chain a license belongs to.
 *
 * The base-chain entries carry it on the license object itself; the mainnet
 * entries carry it on the node record.
 */
function readLicenseChain(source: Record<string, unknown>): string | undefined {
  const value = source.license;
  if (isPlainObject(value)) {
    const chain = value.chain;
    if (typeof chain === "string" && chain.trim() !== "") return chain;
  }
  return undefined;
}

/** One entry of the public node list, reduced to what the Fleet Manager shows. */
export interface NetworkNodeRecord {
  license: string;
  status?: string;
  network?: string;
  address?: string;
  name?: string;
  nodeId?: string;
  totalTime?: number;
  upTime?: number;
  downTime?: number;
  percentUp?: number;
  heartbeats?: number;
  /** The CHyPC figure, when the API carries it for this node. */
  chypc?: number;
  /** The chain this node's license belongs to, when the API carries it. */
  chain?: string;
}

/**
 * Fetches the public node list.
 *
 * Returns the raw records plus any error. It never throws and never returns a
 * partial list silently — a caller that gets an empty array with no error
 * knows the network answered with nothing, and a caller that gets an error
 * knows the network did not answer.
 */
export async function fetchNetworkNodes(): Promise<{
  nodes: NetworkNodeRecord[];
  error?: string;
}> {
  try {
    const response = await fetch(HYPERPG_NODES_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!response.ok) return { nodes: [], error: `HTTP ${response.status}` };

    const payload = (await response.json()) as unknown;
    if (!isPlainObject(payload) || !Array.isArray(payload.nodes)) {
      return { nodes: [], error: "Unexpected response shape" };
    }

    const nodes: NetworkNodeRecord[] = [];
    for (const entry of payload.nodes) {
      if (!isPlainObject(entry) || !isPlainObject(entry.data)) continue;
      const data = entry.data;
      const license = readLicenseId(data);
      if (!license) continue;

      const summary = isPlainObject(data.uptime_summary) ? data.uptime_summary : {};
      const percentUp = readNumber(summary, ["percent_up", "percentUp"]);

      nodes.push({
        license,
        status: readText(data, ["status"]),
        network: readText(data, ["network"]) ?? readLicenseChain(data),
        address: readText(data, ["address"]),
        name: readText(data, ["name"]),
        nodeId: readText(data, ["node_id", "nodeId"]),
        totalTime: readNumber(summary, ["total_time", "totalTime"]),
        upTime: readNumber(summary, ["up_time", "upTime"]),
        downTime: readNumber(summary, ["down_time", "downTime"]),
        // The API reports a 0–1 fraction; the UI shows a percentage.
        // Rounded to two decimals so the UI never shows 81.95429905427167%.
        percentUp: percentUp != null ? Math.round(percentUp * 100 * 100) / 100 : undefined,
        heartbeats: readNumber(summary, ["heartbeats", "heartbeat"]),
        chain: readLicenseChain(data),
      });
    }

    return { nodes };
  } catch (error) {
    return {
      nodes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetches the public tiller data and reduces it to per-license facts.
 *
 * The tiller list carries `till_status` ("ok" / other) and a heartbeat count
 * per tiller, plus the slots a node is running AIMs in.
 */
export async function fetchTillerData(): Promise<{
  byLicense: Record<
    string,
    { tillStatus?: string; heartbeats?: number; slots: number[]; timeLeft?: number }
  >;
  error?: string;
}> {
  try {
    const response = await fetch(HYPERPG_TILLER_DATA_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!response.ok) return { byLicense: {}, error: `HTTP ${response.status}` };

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return { byLicense: {}, error: "Unexpected response shape" };

    const byLicense: Record<
      string,
      { tillStatus?: string; heartbeats?: number; slots: number[]; timeLeft?: number }
    > = {};

    for (const entry of payload) {
      if (!isPlainObject(entry)) continue;
      const license = readText(entry, ["node_license", "nodeLicense"]);
      if (!license) continue;

      const record = byLicense[license] ?? { slots: [] };
      const slot = readNumber(entry, ["slot"]);
      if (slot != null && !record.slots.includes(slot)) record.slots.push(slot);

      const tillers = Array.isArray(entry.tillers) ? entry.tillers : [];
      for (const tiller of tillers) {
        if (!isPlainObject(tiller)) continue;
        const status = readText(tiller, ["till_status", "tillStatus"]);
        if (status) record.tillStatus = status;
        const heartbeats = readNumber(tiller, ["heartbeats"]);
        if (heartbeats != null) record.heartbeats = heartbeats;
        const timeLeft = readNumber(tiller, ["time_left", "timeLeft"]);
        if (timeLeft != null) record.timeLeft = timeLeft;
      }

      byLicense[license] = record;
    }

    return { byLicense };
  } catch (error) {
    return {
      byLicense: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Explorer's per-license status, as published.
 *
 * Source: https://explorer.hypercycle.ai/v1/licenses/status — verified to
 * answer 200 with `Access-Control-Allow-Origin: *`.
 *
 * Every field is read from the response. When the license carries no
 * delegate data the endpoint answers `delegate_data: {}` and every field
 * below stays undefined — the source published nothing, so nothing is shown.
 */
export interface ExplorerLicenseStatus {
  license: string;
  /** The chain the license's owner is registered on. */
  chain?: string;
  /** The owner's address, as published. */
  ownerAddress?: string;
  /** The last block the delegate was seen in. */
  block?: number;
  /** The CHyPC figure the Explorer publishes for this license. */
  chypc?: number;
  /** The delegate's priority. */
  priority?: number;
  /** The delegate identifier. */
  did?: string;
  /** The license's published status, e.g. "alive" or "dead". */
  status?: string;
  /** When that status began, as published (epoch seconds). */
  statusSince?: string;
  /** How many nodes the Explorer lists for this license. */
  count?: number;
  error?: string;
}

/**
 * Fetches the Explorer's published status for one license.
 *
 * Never throws. A source that does not answer yields an error field rather
 * than an exception, so a failed lookup cannot break the fleet view.
 */
export async function fetchExplorerLicenseStatus(
  licenseKey: string,
  network = "mainnet",
): Promise<ExplorerLicenseStatus> {
  const license = String(licenseKey || "").trim();
  if (!license) return { license, error: "License not configured" };

  try {
    const url = `${EXPLORER_LICENSE_STATUS_URL}?license=${encodeURIComponent(license)}&network=${encodeURIComponent(network)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!response.ok) return { license, error: `HTTP ${response.status}` };

    const payload = (await response.json()) as unknown;
    if (!isPlainObject(payload)) return { license, error: "Unexpected response shape" };

    const status = isPlainObject(payload.licenseStatus) ? payload.licenseStatus : {};
    const delegate = isPlainObject(status.delegate_data) ? status.delegate_data : {};
    const owner = isPlainObject(delegate.owner) ? delegate.owner : {};
    const info = isPlainObject(payload.licenseInfo) ? payload.licenseInfo : {};

    return {
      license,
      chain: readText(owner, ["chain"]),
      ownerAddress: readText(owner, ["address"]),
      block: readNumber(delegate, ["block"]),
      chypc: readNumber(delegate, ["chypc"]),
      priority: readNumber(delegate, ["priority"]),
      did: readText(delegate, ["did"]),
      status: readText(status, ["status"]),
      statusSince: readText(status, ["status-since"]),
      count: readNumber(info, ["count"]),
    };
  } catch (error) {
    return {
      license,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Explorer's per-license details, as published.
 *
 * Source: https://explorer.hypercycle.ai/v1/licenses/details — verified to
 * answer 200 with `Access-Control-Allow-Origin: *`.
 */
export interface ExplorerLicenseDetails {
  license: string;
  /** The uptime summary the Explorer publishes for this license. */
  totalTime?: number;
  upTime?: number;
  downTime?: number;
  /** The published uptime as a percentage, 0-100. */
  percentUp?: number;
  /** The per-update history the Explorer publishes. */
  updates?: Array<{
    timestamp: string;
    status?: string;
    /** The computation count the Explorer published for this update. */
    computationTotal?: number;
  }>;
  /** The license this license inherits its summary from. */
  referenceLicense?: string;
  error?: string;
}

/**
 * Fetches the Explorer's published details for one license.
 *
 * Never throws. An unreachable source yields an error field, not an
 * exception.
 */
export async function fetchExplorerLicenseDetails(
  licenseKey: string,
  network = "mainnet",
): Promise<ExplorerLicenseDetails> {
  const license = String(licenseKey || "").trim();
  if (!license) return { license, error: "License not configured" };

  try {
    const url = `${EXPLORER_LICENSE_DETAILS_URL}?license=${encodeURIComponent(license)}&network=${encodeURIComponent(network)}&page=1&limit=20`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!response.ok) return { license, error: `HTTP ${response.status}` };

    const payload = (await response.json()) as unknown;
    if (!isPlainObject(payload)) return { license, error: "Unexpected response shape" };

    const reports = isPlainObject(payload.uptimeReports) ? payload.uptimeReports : {};
    const summary = isPlainObject(reports.summary) ? reports.summary : {};
    const inherited = isPlainObject(reports.summary_inherited)
      ? reports.summary_inherited
      : {};

    // The Explorer publishes the license's own summary; when it is empty the
    // inherited summary is the one it computed for this license.
    const own = Object.keys(summary).length > 0;
    const effective = own ? summary : inherited;

    const percentUp = readNumber(effective, ["percent_up", "percentUp"]);
    const updates: ExplorerLicenseDetails["updates"] = [];
    if (Array.isArray(reports.updates)) {
      for (const update of reports.updates) {
        if (!isPlainObject(update)) continue;
        const ts = readNumber(update, ["ts"]);
        const computations = update.computations;
        const computationTotal = isPlainObject(computations)
          ? readNumber(computations, ["total"])
          : undefined;
        updates.push({
          timestamp: ts != null ? new Date(ts * 1000).toISOString() : "",
          status: readText(update, ["status"]),
          computationTotal,
        });
      }
    }

    return {
      license,
      totalTime: readNumber(effective, ["total_time", "totalTime"]),
      upTime: readNumber(effective, ["up_time", "upTime"]),
      downTime: readNumber(effective, ["down_time", "downTime"]),
      // The API reports a 0-1 fraction; the UI shows a percentage.
      percentUp: percentUp != null ? Math.round(percentUp * 100 * 100) / 100 : undefined,
      updates,
      referenceLicense:
        readNumber(reports, ["reference_license"]) != null
          ? String(reports.reference_license)
          : undefined,
    };
  } catch (error) {
    return {
      license,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Builds the per-license Explorer view from the public node list and tiller
 * data.
 *
 * The Explorer's own page shows uptime, status, heartbeats, level and the
 * tilling figures — all of which are present in the JSON APIs. Where the API
 * does not carry a field, it stays undefined and the UI shows "—"; it is never
 * substituted with a number the source did not publish.
 */
export async function fetchExplorerInfo(
  licenses?: string[],
): Promise<{
  byLicense: Record<string, ExplorerNodeInfo>;
  error?: string;
}> {
  const [nodes, tillers] = await Promise.all([fetchNetworkNodes(), fetchTillerData()]);
  if (nodes.error) return { byLicense: {}, error: nodes.error };

  const byLicense: Record<string, ExplorerNodeInfo> = {};
  for (const node of nodes.nodes) {
    const tiller = tillers.byLicense[node.license];
    byLicense[node.license] = {
      licenseKey: node.license,
      license: node.license,
      status: node.status,
      network: node.network,
      chain: node.chain,
      // The API publishes seconds; the UI shows hours.
      totalTime: node.totalTime,
      upTime: node.upTime,
      downTime: node.downTime,
      totalHours: node.totalTime != null ? node.totalTime / 3600 : undefined,
      upHours: node.upTime != null ? node.upTime / 3600 : undefined,
      downHours: node.downTime != null ? node.downTime / 3600 : undefined,
      totalOnlineHours: node.upTime != null ? node.upTime / 3600 : undefined,
      totalOfflineHours: node.downTime != null ? node.downTime / 3600 : undefined,
      onlineHours: node.upTime != null ? node.upTime / 3600 : undefined,
      offlineHours: node.downTime != null ? node.downTime / 3600 : undefined,
      upPercent: node.percentUp,
      heartbeat: node.heartbeats,
      chypc: node.chypc,
      tillingScore: tiller?.tillStatus,
      tillingRatio: tiller?.tillStatus,
      // The public node list does not publish these — they stay undefined
      // rather than being filled with a placeholder.
      computation: undefined,
      reputation: undefined,
      scalingFactor: undefined,
      fetchedAt: new Date().toISOString(),
    };
  }

  return { byLicense };
}

/**
 * Enriches the fleet view with the Explorer's per-license figures.
 *
 * The node list and the tiller data describe the whole fleet; the Explorer's
 * per-license endpoints carry the license-level facts (CHyPC, chain, block,
 * delegate, and the computation count published with each uptime update).
 *
 * Only the requested licenses are queried — the endpoints are per-license, so
 * asking for the whole fleet would issue one request per node. A license
 * whose source does not answer keeps the fleet-level figures it already had;
 * the fields the per-license source would have supplied stay undefined.
 */
export async function enrichExplorerLicenses(
  byLicense: Record<string, ExplorerNodeInfo>,
  licenses: string[],
): Promise<Record<string, ExplorerNodeInfo>> {
  const wanted = [...new Set(licenses.map((l) => String(l || "").trim()).filter(Boolean))];
  if (!wanted.length) return byLicense;

  const enriched: Record<string, ExplorerNodeInfo> = { ...byLicense };

  await Promise.all(
    wanted.map(async (license) => {
      const base = enriched[license] ?? { licenseKey: license, license };
      const network = base.network && base.network !== "mainnet" ? base.network : "mainnet";

      const [status, details] = await Promise.all([
        fetchExplorerLicenseStatus(license, network),
        fetchExplorerLicenseDetails(license, network),
      ]);

      const updates = details.updates ?? [];
      const computationTotal = updates.reduce((sum, u) => sum + (u.computationTotal ?? 0), 0);

      enriched[license] = {
        ...base,
        chypc: status.chypc ?? base.chypc,
        chain: status.chain ?? base.chain,
        block: status.block ?? base.block,
        did: status.did ?? base.did,
        priority: status.priority ?? base.priority,
        status: status.status ?? base.status,
        // The node list's uptime summary is the fleet-level figure; the
        // Explorer's own summary is the license-level one and wins when
        // the source published it.
        totalTime: details.totalTime ?? base.totalTime,
        upTime: details.upTime ?? base.upTime,
        downTime: details.downTime ?? base.downTime,
        upPercent: details.percentUp ?? base.upPercent,
        // The computation count the Explorer published with the uptime
        // updates. It is undefined when the source published no updates.
        computation: updates.length ? computationTotal : base.computation,
        reputation: base.reputation,
        scalingFactor: base.scalingFactor,
        reports: updates.length
          ? updates.map((u) => ({ timestamp: u.timestamp, status: u.status }))
          : base.reports,
        fetchedAt: new Date().toISOString(),
      };
    }),
  );

  return enriched;
}

/**
 * Queries the authoritative Tilling license-status endpoint.
 *
 * This is a read-only public API and it is called directly — but the endpoint
 * sends **no CORS headers**, so a renderer fetch is blocked by the browser.
 * The failure is reported honestly (`ok: false` with the browser's error) so
 * the UI can say the source did not answer, rather than silently showing
 * nothing.
 */
export async function queryTillingStatus(licenseKey: string): Promise<{
  ok: boolean;
  status?: string;
  statusSince?: string;
  latencyMs?: number;
  error?: string;
  skipped?: boolean;
}> {
  const license = String(licenseKey || "").trim();
  if (!license) return { ok: false, skipped: true, error: "License not configured" };

  const started = Date.now();
  try {
    const url = `${TILLING_LICENSE_STATUS_URL}?license=${encodeURIComponent(license)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    const errorValue = data && typeof data.error === "string" ? data.error : undefined;
    if (!response.ok || errorValue) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: errorValue || `HTTP ${response.status}`,
      };
    }
    const status = data && typeof data.status === "string" ? data.status : undefined;
    const rawSince =
      data && typeof data["status-since"] === "string" ? data["status-since"] : undefined;
    return {
      ok: true,
      latencyMs: Date.now() - started,
      status,
      statusSince: rawSince,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Explorer view of a single fleet node, from the public APIs.
 *
 * The node's own license is the key. When the public list does not carry the
 * license, the result says so — it does not fall back to the node's own
 * `/info`, which reports different things under different names.
 */
export async function explorerInfoForNode(
  node: HypercycleNode,
  cache?: { byLicense: Record<string, ExplorerNodeInfo> },
): Promise<ExplorerNodeInfo> {
  const license = String(node.licenseKey || "").trim();
  if (!license) return { error: "No license configured" };

  const byLicense = cache?.byLicense ?? (await fetchExplorerInfo()).byLicense;
  const found = byLicense[license];
  if (found) return found;
  return { licenseKey: license, error: "License not present in the public node list" };
}
