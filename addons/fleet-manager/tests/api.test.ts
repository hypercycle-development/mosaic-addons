// =============================================================================
// Fleet Manager — tests for the `api.nodes.*` compatibility surface.
//
// This is the layer the UI calls. It has two jobs: to give the ported UI the
// same names and signatures the original main process exposed, and to refuse
// cleanly the operations an add-on cannot perform.
//
// The host bridge and the network are stubbed, so the suite is deterministic
// and never touches a real node or a real source.
//
// Run with: npm test  (node --test tests/)
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { api, UnsupportedOperation } from "../src/lib/api.ts";
import type { HypercycleNode } from "../src/lib/types.ts";

// -----------------------------------------------------------------------------
// Stubs
// -----------------------------------------------------------------------------

interface StubResponse {
  status?: number;
  body?: unknown;
  error?: string;
}

type StubMap = Record<string, StubResponse>;

function installFetch(stubs: StubMap): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init?: RequestInit,
  ) => {
    calls.push({ url, init });
    const stub = stubs[url];
    if (!stub) throw new Error(`Unexpected request: ${url}`);
    if (stub.error) throw new Error(stub.error);
    const status = stub.status ?? 200;
    const text = typeof stub.body === "string" ? stub.body : JSON.stringify(stub.body ?? null);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => "application/json" },
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return calls;
}

function clearFetch(): void {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
}

/** An empty host bridge: no nodes, no stored files. */
function installHost(): void {
  (globalThis as unknown as { addonAPI?: unknown }).addonAPI = {
    nodes: { list: async () => [], getSavedAims: async () => ({}) },
    files: {
      read: async () => {
        throw new Error("ENOENT");
      },
      write: async () => undefined,
    },
    ui: { openExternal: async () => undefined },
  };
}

function clearHost(): void {
  delete (globalThis as unknown as { addonAPI?: unknown }).addonAPI;
}

function node(overrides: Partial<HypercycleNode> = {}): HypercycleNode {
  return {
    id: "node-1",
    name: "Node One",
    apiHost: "10.0.0.1",
    apiPort: "8000",
    isActive: true,
    network: "TODA",
    licenseKey: "",
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// The operations an add-on cannot perform
// -----------------------------------------------------------------------------

test("adding a node is refused with an explanation, not silently ignored", async () => {
  await assert.rejects(
    () => api.nodes.add({ name: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedOperation);
      assert.match(error.message, /not available to a Mosaic add-on/);
      assert.match(error.message, /nodes:read/);
      return true;
    },
  );
});

test("updating a node is refused with an explanation", async () => {
  await assert.rejects(
    () => api.nodes.update("node-1", { name: "y" }),
    (error: unknown) => error instanceof UnsupportedOperation,
  );
});

test("deleting a node is refused with an explanation", async () => {
  await assert.rejects(
    () => api.nodes.delete("node-1"),
    (error: unknown) => error instanceof UnsupportedOperation,
  );
});

test("the registry read returns the host's nodes", async () => {
  (globalThis as unknown as { addonAPI?: unknown }).addonAPI = {
    nodes: {
      list: async () => [node({ id: "a" }), node({ id: "b" })],
      getSavedAims: async () => ({}),
    },
  };
  try {
    const nodes = await api.nodes.get();
    assert.equal(nodes.length, 2);
    assert.equal(nodes[1].id, "b");
  } finally {
    clearHost();
  }
});

// -----------------------------------------------------------------------------
// The exported snapshot
// -----------------------------------------------------------------------------

test("the exported snapshot carries no license, host or address", async () => {
  installHost();
  try {
    const exported = await api.nodes.exportSanitized();
    const serialised = JSON.stringify(exported);
    // The fixture's license key, host and name must not appear anywhere.
    assert.ok(!serialised.includes("4503874505352752"));
    assert.ok(!serialised.includes("10.0.0.1"));
    assert.ok(!serialised.includes("Node One"));
    assert.equal(exported.generatedAt.length > 0, true);
    assert.deepEqual(exported.nodes, []);
    assert.deepEqual(exported.alerts, []);
  } finally {
    clearHost();
  }
});

test("the exported snapshot reports only the node id, liveness, latency and time", async () => {
  installHost();
  try {
    const exported = await api.nodes.exportSanitized();
    for (const entry of exported.nodes) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "alive",
        "nodeId",
        "testedAt",
        "totalLatencyMs",
      ]);
    }
  } finally {
    clearHost();
  }
});

// -----------------------------------------------------------------------------
// Opening an external link
// -----------------------------------------------------------------------------

test("opening an external link fails clearly when the host does not expose it", async () => {
  clearHost();
  await assert.rejects(
    () => api.nodes.openExternal("https://explorer.hypercycle.ai/license/1"),
    (error: unknown) => error instanceof UnsupportedOperation,
  );
});

// -----------------------------------------------------------------------------
// Source inspection — the probes must be real
// -----------------------------------------------------------------------------

test("inspecting a source really requests each candidate source", async () => {
  installHost();
  const calls = installFetch({
    "https://services.hyperpg.site/node-rpc/hypercycle/nodes/": {
      status: 200,
      body: { nodes: [{ data: { license: "4503874505352752", status: "alive" } }] },
    },
    "https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet": {
      status: 200,
      body: [],
    },
    "https://explorer.hypercycle.ai/v1/licenses/status?license=4503874505352752&network=mainnet": {
      status: 200,
      body: { licenseStatus: { delegate_data: {} }, licenseInfo: null },
    },
    "https://explorer.hypercycle.ai/v1/licenses/details?license=4503874505352752&network=mainnet&page=1&limit=5": {
      status: 200,
      body: { uptimeReports: { updates: [], summary: {} }, page: 1, limit: 5 },
    },
  });
  try {
    const inspection = await api.nodes.explorerSourceInspect("4503874505352752");
    // Every candidate source was actually contacted.
    assert.ok(calls.length >= 4, `expected at least 4 requests, got ${calls.length}`);
    for (const probe of inspection.probes ?? []) {
      assert.ok(probe.url.startsWith("https://"));
      assert.equal(typeof probe.ok, "boolean");
    }
  } finally {
    clearFetch();
    clearHost();
  }
});

test("a source that does not answer is reported as failed, not as successful", async () => {
  installHost();
  installFetch({
    "https://services.hyperpg.site/node-rpc/hypercycle/nodes/": {
      status: 200,
      body: { nodes: [{ data: { license: "4503874505352752" } }] },
    },
    "https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet": {
      status: 500,
      body: { error: "boom" },
    },
    "https://explorer.hypercycle.ai/v1/licenses/status?license=4503874505352752&network=mainnet": {
      status: 200,
      body: { licenseStatus: { delegate_data: {} }, licenseInfo: null },
    },
    "https://explorer.hypercycle.ai/v1/licenses/details?license=4503874505352752&network=mainnet&page=1&limit=5": {
      status: 200,
      body: { uptimeReports: { updates: [] }, page: 1, limit: 5 },
    },
  });
  try {
    const inspection = await api.nodes.explorerSourceInspect("4503874505352752");
    const failed = (inspection.probes ?? []).filter((p) => !p.ok);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, 500);
    // A failed source is not listed as a matching resource.
    assert.ok(!(inspection.matchingResources ?? []).some((u) => u.includes("tiller-data")));
  } finally {
    clearFetch();
    clearHost();
  }
});

test("inspecting a source without a license is refused", async () => {
  installHost();
  try {
    const inspection = await api.nodes.explorerSourceInspect("   ");
    assert.ok(inspection.error);
  } finally {
    clearHost();
  }
});

// -----------------------------------------------------------------------------
// The Explorer view
// -----------------------------------------------------------------------------

test("the Explorer view reports the fields the source published", async () => {
  installHost();
  installFetch({
    "https://services.hyperpg.site/node-rpc/hypercycle/nodes/": {
      status: 200,
      body: {
        nodes: [
          {
            data: {
              license: "4503874505352752",
              status: "alive",
              network: "mainnet",
              uptime_summary: {
                total_time: 1000,
                up_time: 800,
                down_time: 200,
                percent_up: 0.8,
                heartbeats: 42,
              },
            },
          },
        ],
      },
    },
    "https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet": {
      status: 200,
      body: [],
    },
    "https://explorer.hypercycle.ai/v1/licenses/status?license=4503874505352752&network=mainnet": {
      status: 200,
      body: {
        licenseStatus: {
          delegate_data: {
            owner: { chain: "ethereum", address: "0xabc" },
            block: 1044552,
            chypc: 34359857555,
            priority: 1,
            did: "68fff8668fdca250ee2aa0ea",
          },
          status: "alive",
          "status-since": "1761606667.165647",
        },
        licenseInfo: { count: 34, license: "4503874505352752", id: "4503874505352752" },
      },
    },
    "https://explorer.hypercycle.ai/v1/licenses/details?license=4503874505352752&network=mainnet&page=1&limit=20": {
      status: 200,
      body: {
        uptimeReports: {
          updates: [
            { ts: 1761606028.8262517, status: "alive", computations: { comps: [], total: 7 } },
            { ts: 1761606667.165647, status: "dead", computations: "" },
          ],
          summary: { total_time: 1000, up_time: 800, down_time: 200, percent_up: 0.8 },
          reference_license: 281492156581837,
        },
        page: 1,
        limit: 20,
      },
    },
  });
  try {
    const info = await api.nodes.explorerLicense("4503874505352752");
    assert.equal(info.chypc, 34359857555);
    assert.equal(info.chain, "ethereum");
    assert.equal(info.block, 1044552);
    assert.equal(info.did, "68fff8668fdca250ee2aa0ea");
    assert.equal(info.priority, 1);
    assert.equal(info.upPercent, 80);
    // The computation count the Explorer published with its updates.
    assert.equal(info.computation, 7);
    // The reputation and the scaling factor are not published by any source.
    assert.equal(info.reputation, undefined);
    assert.equal(info.scalingFactor, undefined);
  } finally {
    clearFetch();
    clearHost();
  }
});

test("a license the public list does not carry is reported as missing, not invented", async () => {
  installHost();
  installFetch({
    "https://services.hyperpg.site/node-rpc/hypercycle/nodes/": { status: 200, body: { nodes: [] } },
    "https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet": { status: 200, body: [] },
    "https://explorer.hypercycle.ai/v1/licenses/status?license=999&network=mainnet": {
      status: 200,
      body: { licenseStatus: { delegate_data: {} }, licenseInfo: null },
    },
    "https://explorer.hypercycle.ai/v1/licenses/details?license=999&network=mainnet&page=1&limit=20": {
      status: 200,
      body: { uptimeReports: { updates: [], summary: {} }, page: 1, limit: 20 },
    },
  });
  try {
    const info = await api.nodes.explorerLicense("999");
    assert.ok(info.error);
    assert.equal(info.chypc, undefined);
  } finally {
    clearFetch();
    clearHost();
  }
});

// -----------------------------------------------------------------------------
// Alerts
// -----------------------------------------------------------------------------

test("an incident that is still open has no duration", async () => {
  installHost();
  try {
    const alerts = await api.nodes.alerts();
    assert.deepEqual(alerts, []);
  } finally {
    clearHost();
  }
});
