// =============================================================================
// Fleet Manager — tests for the host layer.
//
// The host layer is the only place that talks to the Mosaic host bridge
// (`window.addonAPI`) and to the node's own HTTP endpoints. Both are stubbed
// here, so the suite is deterministic and never touches a real node.
//
// The property under test throughout is the one the add-on promises: a node
// is reported alive because the node itself answered, never because the
// monitor inferred it.
//
// Run with: npm test  (node --test tests/)
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isNodeAlive,
  listNodes,
  loadState,
  saveState,
  testNode,
} from "../src/lib/host.ts";
import type { HypercycleNode } from "../src/lib/types.ts";

// -----------------------------------------------------------------------------
// The host bridge
// -----------------------------------------------------------------------------

/** A minimal stand-in for the `window.addonAPI` bridge the host exposes. */
interface FakeHost {
  nodes?: unknown[];
  files?: Record<string, string>;
  openExternalCalls?: string[];
}

function installHost(host: FakeHost): void {
  // In the browser `window` and `globalThis` are the same object, so the
  // bridge is reachable through either. The test installs it on both so the
  // stub matches the environment the add-on actually runs in.
  const bridge = {
      nodes: {
        list: async () => host.nodes ?? [],
        getSavedAims: async () => ({}),
      },
      files: {
        read: async (name: string) => {
          const value = host.files?.[name];
          if (value === undefined) throw new Error("ENOENT");
          return value;
        },
        write: async (name: string, contents: string) => {
          host.files = host.files ?? {};
          host.files[name] = contents;
        },
      },
      ui: {
        openExternal: async (url: string) => {
          host.openExternalCalls = host.openExternalCalls ?? [];
          host.openExternalCalls.push(url);
        },
      },
  };
  (globalThis as unknown as { addonAPI?: unknown }).addonAPI = bridge;
  (globalThis as unknown as { window: unknown }).window = { addonAPI: bridge };
}

function clearHost(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { addonAPI?: unknown }).addonAPI;
}

// -----------------------------------------------------------------------------
// Fetch stubbing
// -----------------------------------------------------------------------------

interface StubResponse {
  status?: number;
  body?: unknown;
  /** When set, the request rejects with this message instead of answering. */
  error?: string;
}

type StubMap = Record<string, StubResponse>;

/** Replaces `globalThis.fetch` with a stub that answers per URL. */
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
    licenseKey: "",
    ...overrides,
  };
}

const BASE = "http://10.0.0.1:8000";

// -----------------------------------------------------------------------------
// The node registry
// -----------------------------------------------------------------------------

test("listNodes returns the registry the host exposes", async () => {
  installHost({ nodes: [node({ id: "a" }), node({ id: "b" })] });
  try {
    const nodes = await listNodes();
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].id, "a");
  } finally {
    clearHost();
  }
});

test("listNodes returns an empty list rather than failing when the host has none", async () => {
  installHost({ nodes: [] });
  try {
    assert.deepEqual(await listNodes(), []);
  } finally {
    clearHost();
  }
});

test("listNodes returns an empty list when the host bridge is absent", async () => {
  clearHost();
  assert.deepEqual(await listNodes(), []);
});

// -----------------------------------------------------------------------------
// The persisted state
// -----------------------------------------------------------------------------

test("saveState writes the state and loadState reads it back", async () => {
  const host: FakeHost = { files: {} };
  installHost(host);
  try {
    await saveState({
      history: [],
      alerts: [{ id: "a1", nodeId: "n1", type: "DEAD", createdAt: "2026-11-03T10:00:00.000Z", message: "x" }],
      sources: { explorerUrl: "https://example.test/nodes" },
    });
    const state = await loadState();
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0].id, "a1");
    assert.equal(state.sources.explorerUrl, "https://example.test/nodes");
  } finally {
    clearHost();
  }
});

test("loadState returns an empty state when the file is absent", async () => {
  installHost({ files: {} });
  try {
    const state = await loadState();
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.alerts, []);
    assert.deepEqual(state.sources, {});
  } finally {
    clearHost();
  }
});

test("loadState returns an empty state when the file is corrupt", async () => {
  installHost({ files: { "fleet-manager-state.json": "{not json" } });
  try {
    const state = await loadState();
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.alerts, []);
  } finally {
    clearHost();
  }
});

test("loadState ignores a state file whose fields have the wrong shape", async () => {
  installHost({
    files: {
      "fleet-manager-state.json": JSON.stringify({ history: "nope", alerts: 7, sources: [] }),
    },
  });
  try {
    const state = await loadState();
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.alerts, []);
    assert.deepEqual(state.sources, {});
  } finally {
    clearHost();
  }
});

// -----------------------------------------------------------------------------
// Liveness — the decision the whole product rests on
// -----------------------------------------------------------------------------

test("a node whose /health answers is alive", () => {
  assert.equal(
    isNodeAlive({ ok: false, latencyMs: 1 }, { ok: true, status: 200, latencyMs: 1 }),
    true,
  );
});

test("a node whose /info answers is alive even when /health refuses the method", () => {
  // Measured on the live network: node versions 0.5.x answer /health with
  // HTTP 405 while /info answers HTTP 200 with "status": "alive". Treating
  // /health as the only liveness signal marked six live nodes DEAD.
  assert.equal(
    isNodeAlive(
      { ok: true, status: 200, latencyMs: 1, data: { status: "alive" } },
      { ok: false, status: 405, latencyMs: 1 },
    ),
    true,
  );
});

test("a node that answers neither endpoint is not alive", () => {
  assert.equal(
    isNodeAlive({ ok: false, latencyMs: 1 }, { ok: false, latencyMs: 1 }),
    false,
  );
});

test("a node that reports itself offline is not alive even though it answered", () => {
  // The node's own report is preferred over the transport-level code.
  assert.equal(
    isNodeAlive(
      { ok: true, status: 200, latencyMs: 1, data: { status: "offline" } },
      { ok: false, latencyMs: 1 },
    ),
    false,
  );
});

test("a node that reports itself dead is not alive", () => {
  assert.equal(
    isNodeAlive(
      { ok: true, status: 200, latencyMs: 1, data: { status: "dead" } },
      { ok: true, status: 200, latencyMs: 1 },
    ),
    false,
  );
});

test("an unknown reported status does not override the fact that the node answered", () => {
  assert.equal(
    isNodeAlive(
      { ok: true, status: 200, latencyMs: 1, data: { status: "starting" } },
      { ok: false, latencyMs: 1 },
    ),
    true,
  );
});

// -----------------------------------------------------------------------------
// Testing a node end to end
// -----------------------------------------------------------------------------

test("testNode reports a node alive when its /info answers", async () => {
  installFetch({
    [`${BASE}/health`]: { status: 405, body: "Method Not Allowed" },
    [`${BASE}/info`]: { status: 200, body: { status: "alive", node_id: "abc" } },
  });
  try {
    const result = await testNode(node());
    assert.equal(result.alive, true);
    assert.equal(result.tests.health?.status, 405);
    assert.equal(result.tests.info?.ok, true);
  } finally {
    clearFetch();
  }
});

test("testNode reports a node dead when neither endpoint answers", async () => {
  installFetch({
    [`${BASE}/health`]: { error: "connection refused" },
    [`${BASE}/info`]: { error: "connection refused" },
  });
  try {
    const result = await testNode(node());
    assert.equal(result.alive, false);
    assert.equal(result.tests.health?.ok, false);
    assert.ok(result.tests.health?.error);
  } finally {
    clearFetch();
  }
});

test("testNode records a failed probe as a result rather than throwing", async () => {
  installFetch({
    [`${BASE}/health`]: { error: "connection refused" },
    [`${BASE}/info`]: { error: "connection refused" },
  });
  try {
    const result = await testNode(node());
    assert.ok(result.tests.health);
    assert.equal(result.tests.health?.ok, false);
    assert.equal(result.tests.health?.error, "connection refused");
  } finally {
    clearFetch();
  }
});

test("testNode skips the Tilling lookup when the node has no license", async () => {
  const calls = installFetch({
    [`${BASE}/health`]: { status: 200, body: { ok: true } },
    [`${BASE}/info`]: { status: 200, body: { status: "alive" } },
  });
  try {
    const result = await testNode(node({ licenseKey: "" }));
    assert.equal(result.tilling?.skipped, true);
    assert.equal(result.tilling?.ok, false);
    // No license means no Tilling request at all.
    assert.equal(calls.length, 2);
  } finally {
    clearFetch();
  }
});

test("testNode queries the Tilling endpoint when the node has a license", async () => {
  const calls = installFetch({
    [`${BASE}/health`]: { status: 200, body: { ok: true } },
    [`${BASE}/info`]: { status: 200, body: { status: "alive" } },
    "http://tilling.ioai.services:8003/license_status?license=4503874505352752": {
      status: 200,
      body: { status: "alive", "status-since": "2026-11-01T10:00:00.000Z" },
    },
  });
  try {
    const result = await testNode(node({ licenseKey: "4503874505352752" }));
    assert.equal(result.tilling?.ok, true);
    assert.equal(result.tilling?.status, "alive");
    assert.equal(calls.length, 3);
  } finally {
    clearFetch();
  }
});

test("testNode uses the BASE default port when the node has none", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8010/health": { status: 200, body: {} },
    "http://10.0.0.1:8010/info": { status: 200, body: { status: "alive" } },
  });
  try {
    const result = await testNode(node({ apiPort: undefined, network: "BASE" }));
    assert.equal(result.alive, true);
    assert.equal(calls[0].url, "http://10.0.0.1:8010/health");
  } finally {
    clearFetch();
  }
});
