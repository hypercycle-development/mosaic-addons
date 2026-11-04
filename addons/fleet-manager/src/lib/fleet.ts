// =============================================================================
// Fleet Manager — the pure logic of the fleet model.
//
// Everything here is a function of its arguments: no host access, no network,
// no clock (the caller passes the timestamp in). That makes it directly
// testable, and it keeps the parts that decide what the UI shows separate
// from the parts that fetch it.
//
// Ported from electron/nodeManagerService.ts in the original Mosaic Companion
// implementation, with the same semantics.
// =============================================================================

import type {
  FleetAnalytics,
  FleetHistoryPoint,
  HypercycleNode,
  NodeAlert,
  NodeHeartbeatAnalytics,
  NodeTestResult,
} from "./types";

/** Bounds on the persisted state. */
export const MAX_HISTORY = 5000;
export const MAX_ALERTS = 1000;
/** No more than one identical transition alert per node/type per hour. */
export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** Strips a scheme and trailing slashes from a host, as the original did. */
export function cleanHost(host: string): string {
  return String(host || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** The default API port for a node: BASE nodes use 8010, everything else 8000. */
export function defaultPortFor(node: HypercycleNode): string {
  return node.apiPort || (node.network === "BASE" ? "8010" : "8000");
}

/** The base URL of a node's HTTP API. */
export function baseUrlFor(node: HypercycleNode): string {
  return `http://${cleanHost(node.apiHost)}:${defaultPortFor(node)}`;
}

/**
 * Records an ALIVE/DEAD transition, honouring the hourly cooldown so a node
 * flapping does not flood the alert list.
 *
 * A transition is only a transition when the node's previous recorded state
 * differed — the first observation of a node is not a transition.
 */
export function recordTransition(
  alerts: NodeAlert[],
  history: NodeTestResult[],
  node: HypercycleNode,
  alive: boolean,
  testedAt: string,
): NodeAlert[] {
  const previous = history.filter((h) => h.nodeId === node.id).at(-1);
  if (!previous || previous.alive === alive) return alerts;

  const type = alive ? "ALIVE" : "DEAD";
  const now = Date.parse(testedAt);
  const recentDuplicate = [...alerts]
    .reverse()
    .find(
      (a) =>
        a.nodeId === node.id &&
        a.type === type &&
        now - Date.parse(a.createdAt) >= 0 &&
        now - Date.parse(a.createdAt) < ALERT_COOLDOWN_MS,
    );
  if (recentDuplicate) return alerts;

  const next = alerts.concat({
    id: `alert-${Date.now()}-${node.id}`,
    nodeId: node.id,
    type,
    createdAt: testedAt,
    message: `${node.name}: state changed to ${type}`,
  });
  return next.slice(-MAX_ALERTS);
}

/**
 * Derives heartbeat statistics for one node from the recorded history.
 *
 * `observedUptimePercent` is the share of recorded samples in which the node
 * was alive — an observation of the monitor, clearly distinguished from any
 * uptime the node reports about itself.
 */
export function heartbeatAnalytics(
  nodeId: string,
  history: NodeTestResult[],
): NodeHeartbeatAnalytics {
  const samples = history
    .filter((h) => h.nodeId === nodeId)
    .sort((a, b) => Date.parse(a.testedAt) - Date.parse(b.testedAt));
  if (!samples.length) {
    return {
      nodeId,
      firstObservedAt: null,
      lastHeartbeatAt: null,
      heartbeatCount: 0,
      aliveSamples: 0,
      observedUptimePercent: null,
      observedDurationSeconds: 0,
      reportedUptimeSeconds: null,
      reportedUptimeSource: null,
    };
  }

  const first = samples[0].testedAt;
  const last = samples[samples.length - 1].testedAt;
  const aliveSamples = samples.filter((h) => h.alive).length;

  // The observed uptime is the share of the *observed window* during which
  // the node was alive, not the share of samples. A node tested every minute
  // for an hour and one tested once a day are not comparable by sample
  // count. Each gap between two consecutive observations contributes its
  // own duration, capped at 120 seconds so one long gap — a laptop that
  // slept, a node that was unreachable for an afternoon — cannot dominate
  // the figure. This is the original Mosaic implementation's rule, kept
  // because the number it produces is the number operators already read.
  let onlineMs = 0;
  let spanMs = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = Date.parse(samples[i].testedAt);
    const b = Date.parse(samples[i + 1].testedAt);
    const gap = Math.max(0, b - a);
    spanMs += gap;
    if (samples[i].alive) onlineMs += Math.min(gap, 120_000);
  }

  const observedDurationSeconds = Math.max(
    0,
    Math.round((Date.parse(last) - Date.parse(first)) / 1000),
  );

  const reported = findReportedUptime(samples[samples.length - 1]?.info);

  return {
    nodeId,
    firstObservedAt: first,
    lastHeartbeatAt: last,
    heartbeatCount: samples.length,
    aliveSamples,
    observedUptimePercent: spanMs ? Math.round((onlineMs / spanMs) * 1000) / 10 : null,
    observedDurationSeconds,
    reportedUptimeSeconds: reported?.seconds ?? null,
    reportedUptimeSource: reported?.source ?? null,
  };
}

/**
 * Finds the uptime a node reports about itself.
 *
 * The node's `/info` payload carries it under one of several names and at
 * an unknown depth, so the payload is searched recursively. The original
 * Mosaic implementation looked for `uptimeSeconds`, `uptime_seconds`,
 * `uptime`, `nodeUptime` and `node_uptime`; the path it was found at is
 * reported, so the figure is traceable to the field it came from.
 */
export function findReportedUptime(
  info: unknown,
): { seconds: number; source: string } | null {
  const keys = ["uptimeSeconds", "uptime_seconds", "uptime", "nodeUptime", "node_uptime"];
  const visit = (value: unknown, path: string): { seconds: number; source: string } | null => {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const found = record[key];
      if (typeof found === "number" && Number.isFinite(found) && found >= 0) {
        return { seconds: found, source: path ? `${path}.${key}` : key };
      }
      if (typeof found === "string" && /^\d+(\.\d+)?$/.test(found.trim())) {
        return { seconds: Number(found), source: path ? `${path}.${key}` : key };
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      const result = visit(nested, path ? `${path}.${key}` : key);
      if (result) return result;
    }
    return null;
  };
  return visit(info, "");
}

/**
 * Fleet-wide analytics derived from the recorded history.
 *
 * `uptime24h` is the share of samples taken in the last 24 hours in which the
 * node was alive. A node with no samples in that window reports `null` — not
 * zero — because "not observed" and "observed dead" are different facts.
 */
export function fleetAnalytics(
  nodes: HypercycleNode[],
  history: NodeTestResult[],
  alerts: NodeAlert[],
  now: number,
): FleetAnalytics {
  // A node counts as active unless it is explicitly deactivated. The
  // original Mosaic implementation used the same rule: a registry entry with
  // no `isActive` flag is an enabled node, not a disabled one. Reading the
  // flag as a plain boolean made every node without the flag disappear from
  // the fleet's counts.
  const isActive = (node: HypercycleNode) => node.isActive !== false;
  const activeNodes = nodes.filter(isActive);
  const active = activeNodes.length;

  const latest = new Map<string, NodeTestResult>();
  for (const h of history) latest.set(h.nodeId, h);

  let alive = 0;
  let dead = 0;
  let untested = 0;
  let latencySum = 0;
  let latencyCount = 0;
  const uptime24h: Record<string, number | null> = {};

  const dayAgo = now - 24 * 60 * 60 * 1000;

  for (const node of activeNodes) {
    const last = latest.get(node.id);
    if (!last) {
      untested++;
      uptime24h[node.id] = null;
      continue;
    }
    if (last.alive) alive++;
    else dead++;
    latencySum += last.totalLatencyMs;
    latencyCount++;

    const samples24h = history.filter(
      (h) => h.nodeId === node.id && Date.parse(h.testedAt) >= dayAgo,
    );
    // Rounded to one decimal, as the original reported it.
    uptime24h[node.id] = samples24h.length
      ? Math.round((samples24h.filter((h) => h.alive).length / samples24h.length) * 1000) / 10
      : null;
  }

  const lastTestAt = history.length ? history[history.length - 1].testedAt : null;

  return {
    total: nodes.length,
    active,
    alive,
    dead,
    untested,
    avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
    lastTestAt,
    uptime24h,
    transitions: alerts.filter((a) => !a.acknowledged),
  };
}

/**
 * Measures how long each incident lasted.
 *
 * An incident is the interval between a transition and the transition that
 * closed it. The duration is therefore known only for closed incidents; an
 * open incident has no duration yet and keeps the field undefined rather
 * than reporting the time elapsed so far, which is a different fact.
 *
 * The result is returned as a map from alert id to duration in seconds.
 */
export function incidentDurations(
  alerts: NodeAlert[],
  history: NodeTestResult[],
): Record<string, number> {
  const durations: Record<string, number> = {};

  // The transitions of each node, in the order they happened.
  const transitionsByNode = new Map<string, NodeAlert[]>();
  for (const alert of alerts) {
    const list = transitionsByNode.get(alert.nodeId) ?? [];
    list.push(alert);
    transitionsByNode.set(alert.nodeId, list);
  }
  for (const list of transitionsByNode.values()) {
    list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  for (const alert of alerts) {
    const list = transitionsByNode.get(alert.nodeId) ?? [];
    const index = list.findIndex((a) => a.id === alert.id);
    if (index < 0) continue;
    const next = list[index + 1];
    // The incident is still open — it has no duration yet.
    if (!next) continue;
    const startedAt = Date.parse(alert.createdAt);
    const endedAt = Date.parse(next.createdAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) continue;
    const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
    durations[alert.id] = seconds;
  }

  return durations;
}

/** The fleet's test history, newest first. */
export function fleetHistory(history: NodeTestResult[]): FleetHistoryPoint[] {
  return history
    .map((h) => ({
      nodeId: h.nodeId,
      testedAt: h.testedAt,
      alive: h.alive,
      totalLatencyMs: h.totalLatencyMs,
    }))
    .reverse();
}

/** The test history of a single node, newest first. */
export function nodeHistory(nodeId: string, history: NodeTestResult[]): FleetHistoryPoint[] {
  return history
    .filter((h) => h.nodeId === nodeId)
    .map((h) => ({
      nodeId: h.nodeId,
      testedAt: h.testedAt,
      alive: h.alive,
      totalLatencyMs: h.totalLatencyMs,
    }))
    .reverse();
}
