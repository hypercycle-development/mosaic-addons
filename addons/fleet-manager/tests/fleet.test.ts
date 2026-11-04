// =============================================================================
// Fleet Manager — unit tests for the pure fleet model.
//
// Run with: npm test  (node --test tests/)
//
// These cover the decisions the UI depends on: which alerts are raised, what
// "uptime" means, and what happens when a source has no data. The property
// under test throughout is that **nothing is invented** — a missing value
// stays missing.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_COOLDOWN_MS,
  baseUrlFor,
  cleanHost,
  defaultPortFor,
  fleetAnalytics,
  fleetHistory,
  heartbeatAnalytics,
  nodeHistory,
  recordTransition,
} from "../src/lib/fleet.ts";
import type { HypercycleNode, NodeAlert, NodeTestResult } from "../src/lib/types.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function node(overrides: Partial<HypercycleNode> = {}): HypercycleNode {
  return {
    id: "node-1",
    name: "Node One",
    apiHost: "10.0.0.1",
    apiPort: "8000",
    isActive: true,
    network: "TODA",
    licenseKey: "4503874505352752",
    ...overrides,
  };
}

function result(overrides: Partial<NodeTestResult> = {}): NodeTestResult {
  return {
    nodeId: "node-1",
    testedAt: "2026-11-03T10:00:00.000Z",
    alive: true,
    totalLatencyMs: 100,
    tests: {},
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Host and port handling
// -----------------------------------------------------------------------------

test("cleanHost strips a scheme and trailing slashes", () => {
  assert.equal(cleanHost("http://10.0.0.1"), "10.0.0.1");
  assert.equal(cleanHost("https://10.0.0.1/"), "10.0.0.1");
  assert.equal(cleanHost("https://10.0.0.1///"), "10.0.0.1");
  assert.equal(cleanHost("10.0.0.1"), "10.0.0.1");
  assert.equal(cleanHost(""), "");
});

test("defaultPortFor falls back to 8010 for BASE nodes and 8000 otherwise", () => {
  // The fixture sets apiPort, so the network default only applies without one.
  assert.equal(defaultPortFor(node({ network: "BASE", apiPort: undefined })), "8010");
  assert.equal(defaultPortFor(node({ network: "TODA", apiPort: undefined })), "8000");
  assert.equal(defaultPortFor(node({ network: undefined, apiPort: undefined })), "8000");
});

test("an explicit apiPort always wins over the network default", () => {
  assert.equal(defaultPortFor(node({ network: "BASE", apiPort: "9999" })), "9999");
});

test("baseUrlFor builds an http URL from host and port", () => {
  assert.equal(baseUrlFor(node({ apiHost: "http://10.0.0.1/" })), "http://10.0.0.1:8000");
});

// -----------------------------------------------------------------------------
// Transitions and alerts
// -----------------------------------------------------------------------------

test("the first observation of a node is not a transition", () => {
  const alerts = recordTransition([], [], node(), true, "2026-11-03T10:00:00.000Z");
  assert.equal(alerts.length, 0);
});

test("a change of state raises one alert", () => {
  const history = [result({ alive: true })];
  const alerts = recordTransition([], history, node(), false, "2026-11-03T11:00:00.000Z");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "DEAD");
  assert.equal(alerts[0].nodeId, "node-1");
});

test("an unchanged state raises no alert", () => {
  const history = [result({ alive: true })];
  const alerts = recordTransition([], history, node(), true, "2026-11-03T11:00:00.000Z");
  assert.equal(alerts.length, 0);
});

test("an identical transition inside the cooldown does not raise a second alert", () => {
  const history = [result({ alive: true })];
  const first = recordTransition([], history, node(), false, "2026-11-03T11:00:00.000Z");
  assert.equal(first.length, 1);

  // Same transition again, 30 minutes later — inside the one-hour cooldown.
  const history2 = [result({ alive: true }), result({ alive: false, testedAt: "2026-11-03T11:00:00.000Z" })];
  const second = recordTransition(
    first,
    history2,
    node(),
    false,
    new Date(Date.parse("2026-11-03T11:00:00.000Z") + 30 * 60 * 1000).toISOString(),
  );
  assert.equal(second.length, 1);
});

test("the same transition after the cooldown raises a new alert", () => {
  const history = [result({ alive: true })];
  const first = recordTransition([], history, node(), false, "2026-11-03T11:00:00.000Z");

  const later = new Date(Date.parse("2026-11-03T11:00:00.000Z") + ALERT_COOLDOWN_MS + 1000).toISOString();
  const history2 = [
    result({ alive: true }),
    result({ alive: false, testedAt: "2026-11-03T11:00:00.000Z" }),
    result({ alive: true, testedAt: later }),
  ];
  const second = recordTransition(first, history2, node(), false, later);
  assert.equal(second.length, 2);
  assert.equal(second[1].type, "DEAD");
});

test("alerts for different nodes do not suppress each other", () => {
  const history = [result({ nodeId: "node-1", alive: true })];
  const first = recordTransition([], history, node(), false, "2026-11-03T11:00:00.000Z");
  assert.equal(first.length, 1);

  // A different node with its own history gets its own alert — the cooldown
  // lookup is scoped to the node, not to the fleet.
  const other = node({ id: "node-2", name: "Node Two" });
  const otherHistory = [result({ nodeId: "node-2", alive: true })];
  const second = recordTransition(first, otherHistory, other, false, "2026-11-03T11:00:00.000Z");
  assert.equal(second.length, 2);
  assert.equal(second[1].nodeId, "node-2");
});

test("a node with no prior observation raises no transition", () => {
  // The first sighting of a node is a baseline, not a change of state.
  const other = node({ id: "node-2", name: "Node Two" });
  const alerts = recordTransition([], [], other, false, "2026-11-03T11:00:00.000Z");
  assert.equal(alerts.length, 0);
});

// -----------------------------------------------------------------------------
// Heartbeat analytics
// -----------------------------------------------------------------------------

test("heartbeatAnalytics reports the observed uptime share", () => {
  // The uptime is the share of the observed *window* during which the node
  // was alive, not the share of samples. Four samples one minute apart:
  // the node was alive for the first minute, dead for the second, and alive
  // for the third — so it was alive for 120 s of the 180 s observed.
  const history = [
    result({ alive: true }),
    result({ alive: false, testedAt: "2026-11-03T10:01:00.000Z" }),
    result({ alive: true, testedAt: "2026-11-03T10:02:00.000Z" }),
    result({ alive: true, testedAt: "2026-11-03T10:03:00.000Z" }),
  ];
  const stats = heartbeatAnalytics("node-1", history);
  assert.equal(stats.heartbeatCount, 4);
  assert.equal(stats.aliveSamples, 3);
  assert.equal(stats.observedUptimePercent, 66.7);
});

test("heartbeatAnalytics weights the uptime by the time between observations", () => {
  // Three observations an hour and then ten minutes apart. Each gap counts
  // for the state that was observed at its start, and each gap is capped at
  // 120 s so a long silence cannot be read as a long outage:
  //   gap 1 (1 h, alive)   -> 120 s counted alive
  //   gap 2 (10 min, alive) -> 120 s counted alive
  //   span                  -> 4 200 s observed
  // The uptime is therefore 5.7% — not the 66.7% a per-sample average
  // would report, and not the 50% an uncapped gap-weighted average would
  // report.
  const history = [
    result({ alive: true, testedAt: "2026-11-03T10:00:00.000Z" }),
    result({ alive: true, testedAt: "2026-11-03T11:00:00.000Z" }),
    result({ alive: false, testedAt: "2026-11-03T11:10:00.000Z" }),
  ];
  const stats = heartbeatAnalytics("node-1", history);
  assert.equal(stats.observedUptimePercent, 5.7);
});

test("heartbeatAnalytics caps a single long gap so it cannot dominate the uptime", () => {
  // The node was alive, then there was a ten-hour gap, then it was alive
  // again. Without the cap the ten-hour silence would be counted as ten
  // hours alive and the node would look perfect; with it, the gap
  // contributes at most 120 s, and the long silence shows up as a low
  // uptime — which is the truth the operator needs to see.
  const history = [
    result({ alive: true, testedAt: "2026-11-03T10:00:00.000Z" }),
    result({ alive: true, testedAt: "2026-11-03T20:00:00.000Z" }),
    result({ alive: false, testedAt: "2026-11-03T20:01:00.000Z" }),
  ];
  const stats = heartbeatAnalytics("node-1", history);
  // 180 s counted alive out of 36 060 s observed.
  assert.equal(stats.observedUptimePercent, 0.5);
});

test("heartbeatAnalytics reports no uptime for a node never observed", () => {
  const stats = heartbeatAnalytics("node-unknown", []);
  assert.equal(stats.heartbeatCount, 0);
  assert.equal(stats.observedUptimePercent, null);
  assert.equal(stats.firstObservedAt, null);
  assert.equal(stats.lastHeartbeatAt, null);
});

test("heartbeatAnalytics separates the node's own uptime from the observed one", () => {
  // The node reports its own uptime; the observer reports what it saw. A
  // single observation establishes no observed window, so the observed
  // uptime stays unknown rather than being reported as a perfect 100%.
  const history = [result({ alive: true, info: { uptime: 4242 } })];
  const stats = heartbeatAnalytics("node-1", history);
  assert.equal(stats.reportedUptimeSeconds, 4242);
  assert.equal(stats.reportedUptimeSource, "uptime");
  assert.equal(stats.observedUptimePercent, null);
});

test("heartbeatAnalytics reports the path the reported uptime was found at", () => {
  // The node's payload carries the uptime under a different name and at a
  // different depth; the source reported is the path it was found at, so
  // the figure stays traceable.
  const history = [
    result({
      alive: true,
      testedAt: "2026-11-03T10:00:00.000Z",
      info: { metrics: { nodeUptime: 900 } },
    }),
    result({
      alive: true,
      testedAt: "2026-11-03T10:01:00.000Z",
      info: { metrics: { nodeUptime: 960 } },
    }),
  ];
  const stats = heartbeatAnalytics("node-1", history);
  assert.equal(stats.reportedUptimeSeconds, 960);
  assert.equal(stats.reportedUptimeSource, "metrics.nodeUptime");
});

test("heartbeatAnalytics leaves the reported uptime unknown when the node did not send one", () => {
  const stats = heartbeatAnalytics("node-1", [result({ info: { something_else: 1 } })]);
  assert.equal(stats.reportedUptimeSeconds, null);
  assert.equal(stats.reportedUptimeSource, null);
});

// -----------------------------------------------------------------------------
// Fleet analytics
// -----------------------------------------------------------------------------

const NOW = Date.parse("2026-11-03T12:00:00.000Z");

test("fleetAnalytics counts alive, dead and untested nodes", () => {
  const nodes = [
    node({ id: "a" }),
    node({ id: "b" }),
    node({ id: "c" }),
  ];
  const history = [
    result({ nodeId: "a", alive: true }),
    result({ nodeId: "b", alive: false }),
  ];
  const stats = fleetAnalytics(nodes, history, [], NOW);
  assert.equal(stats.total, 3);
  assert.equal(stats.alive, 1);
  assert.equal(stats.dead, 1);
  assert.equal(stats.untested, 1);
});

test("fleetAnalytics reports null uptime for a node never observed", () => {
  const stats = fleetAnalytics([node({ id: "unseen" })], [], [], NOW);
  assert.equal(stats.uptime24h["unseen"], null);
  assert.equal(stats.avgLatencyMs, null);
});

test("fleetAnalytics computes the 24h uptime from the samples in that window", () => {
  const nodes = [node({ id: "a" })];
  const inside = result({ nodeId: "a", alive: true, testedAt: "2026-11-03T11:00:00.000Z" });
  const insideDead = result({ nodeId: "a", alive: false, testedAt: "2026-11-03T11:30:00.000Z" });
  const outside = result({ nodeId: "a", alive: false, testedAt: "2026-11-01T10:00:00.000Z" });
  const stats = fleetAnalytics(nodes, [outside, inside, insideDead], [], NOW);
  assert.equal(stats.uptime24h["a"], 50);
});

test("fleetAnalytics averages the latency of the observed nodes only", () => {
  const nodes = [node({ id: "a" }), node({ id: "b" })];
  const history = [
    result({ nodeId: "a", totalLatencyMs: 100 }),
    result({ nodeId: "b", totalLatencyMs: 300 }),
  ];
  const stats = fleetAnalytics(nodes, history, [], NOW);
  assert.equal(stats.avgLatencyMs, 200);
});

test("fleetAnalytics counts only unacknowledged alerts as open transitions", () => {
  const alerts: NodeAlert[] = [
    { id: "1", nodeId: "a", type: "DEAD", createdAt: "2026-11-03T11:00:00.000Z" },
    {
      id: "2",
      nodeId: "a",
      type: "ALIVE",
      createdAt: "2026-11-03T11:30:00.000Z",
      acknowledged: true,
    },
  ];
  const stats = fleetAnalytics([node({ id: "a" })], [], alerts, NOW);
  assert.equal(stats.transitions.length, 1);
  assert.equal(stats.transitions[0].id, "1");
});

test("fleetAnalytics counts only active nodes as active", () => {
  const nodes = [node({ id: "a", isActive: true }), node({ id: "b", isActive: false })];
  const stats = fleetAnalytics(nodes, [], [], NOW);
  assert.equal(stats.total, 2);
  assert.equal(stats.active, 1);
});

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

test("fleetHistory is newest first", () => {
  const history = [
    result({ testedAt: "2026-11-03T10:00:00.000Z" }),
    result({ testedAt: "2026-11-03T10:01:00.000Z" }),
  ];
  const points = fleetHistory(history);
  assert.equal(points[0].testedAt, "2026-11-03T10:01:00.000Z");
  assert.equal(points[1].testedAt, "2026-11-03T10:00:00.000Z");
});

test("nodeHistory keeps only that node's samples", () => {
  const history = [
    result({ nodeId: "a" }),
    result({ nodeId: "b" }),
    result({ nodeId: "a", testedAt: "2026-11-03T10:05:00.000Z" }),
  ];
  const points = nodeHistory("a", history);
  assert.equal(points.length, 2);
  assert.ok(points.every((p) => p.nodeId === "a"));
});
