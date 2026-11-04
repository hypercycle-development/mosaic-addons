// =============================================================================
// Fleet Manager — tests for the diagnostics and the AIM lifecycle.
//
// The diagnostics run against the node's own endpoints and the AIM lifecycle
// against the AIM Manager's documented REST endpoints. Both are stubbed here.
//
// IMPORTANT: the lifecycle operations change a real AIM service, so the
// suite never performs one against a real host. It asserts on the request
// that would be sent, using a stub that records it.
//
// Run with: npm test  (node --test tests/)
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deployAim,
  diagnoseFleet,
  diagnoseNode,
  getAimManagerInfo,
  removeAim,
  retryAim,
} from "../src/lib/explorer.ts";
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

interface Recorded {
  url: string;
  init?: RequestInit;
}

function installFetch(stubs: StubMap): Recorded[] {
  const calls: Recorded[] = [];
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

function node(overrides: Partial<HypercycleNode> = {}): HypercycleNode {
  return {
    id: "node-1",
    name: "Node One",
    apiHost: "10.0.0.1",
    apiPort: "8000",
    isActive: true,
    network: "TODA",
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

test("a node whose endpoints all answer is HEALTHY", async () => {
  installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: { status: "alive" } },
    "http://10.0.0.1:8000/health": { status: 200, body: {} },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
  });
  try {
    const result = await diagnoseNode(node());
    assert.equal(result.overall, "HEALTHY");
    assert.equal(result.summary.passed, 4);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.skipped, 1);
  } finally {
    clearFetch();
  }
});

test("a node whose /info answers 405 but whose /health answers is not OFFLINE", async () => {
  // Measured on the live network: node versions 0.5.x answer /health with
  // HTTP 405 and /info with HTTP 200. The node is alive; the diagnostic
  // must not call it offline.
  installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: { status: "alive" } },
    "http://10.0.0.1:8000/health": { status: 405, body: "Method Not Allowed" },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
  });
  try {
    const result = await diagnoseNode(node());
    assert.equal(result.overall, "DEGRADED");
    assert.notEqual(result.overall, "OFFLINE");
  } finally {
    clearFetch();
  }
});

test("a node that answers nothing is OFFLINE", async () => {
  installFetch({
    "http://10.0.0.1:8000/info": { error: "connection refused" },
    "http://10.0.0.1:8000/health": { error: "connection refused" },
    "http://10.0.0.1:8005/": { error: "connection refused" },
    "http://10.0.0.1:9000/": { error: "connection refused" },
  });
  try {
    const result = await diagnoseNode(node());
    assert.equal(result.overall, "OFFLINE");
  } finally {
    clearFetch();
  }
});

test("the admin panel is skipped when it is not configured", async () => {
  installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: {} },
    "http://10.0.0.1:8000/health": { status: 200, body: {} },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
  });
  try {
    const result = await diagnoseNode(node());
    const admin = result.checks.find((c) => c.key === "admin-panel");
    assert.ok(admin);
    assert.equal(admin.skipped, true);
    assert.equal(admin.ok, null);
  } finally {
    clearFetch();
  }
});

test("the admin panel is checked when it is configured", async () => {
  installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: {} },
    "http://10.0.0.1:8000/health": { status: 200, body: {} },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
    "http://10.0.0.1:8006/": { status: 200, body: {} },
  });
  try {
    const result = await diagnoseNode(node({ hasAdminPanel: true }));
    const admin = result.checks.find((c) => c.key === "admin-panel");
    assert.ok(admin);
    assert.equal(admin.skipped, undefined);
    assert.equal(admin.ok, true);
  } finally {
    clearFetch();
  }
});

test("the diagnostic reports the node's own ports", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: {} },
    "http://10.0.0.1:8000/health": { status: 200, body: {} },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
  });
  try {
    await diagnoseNode(node());
    const urls = calls.map((c) => c.url);
    assert.ok(urls.includes("http://10.0.0.1:8000/info"));
    assert.ok(urls.includes("http://10.0.0.1:8005/"));
    assert.ok(urls.includes("http://10.0.0.1:9000/"));
  } finally {
    clearFetch();
  }
});

test("the fleet diagnostic skips a node that is explicitly deactivated", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8000/info": { status: 200, body: {} },
    "http://10.0.0.1:8000/health": { status: 200, body: {} },
    "http://10.0.0.1:8005/": { status: 200, body: {} },
    "http://10.0.0.1:9000/": { status: 200, body: {} },
  });
  try {
    const results = await diagnoseFleet([
      node({ id: "a" }),
      node({ id: "b", isActive: false }),
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].nodeId, "a");
  } finally {
    clearFetch();
  }
});

// -----------------------------------------------------------------------------
// The AIM Manager's documented endpoints
// -----------------------------------------------------------------------------

test("the AIM Manager info names the endpoints it can reach", () => {
  const info = getAimManagerInfo(node());
  assert.equal(info.baseUrl, "http://10.0.0.1:8005");
  assert.ok(info.documentedEndpoints.includes("/add_aim"));
  assert.ok(info.documentedEndpoints.includes("/remove_aim/<aim_slot>"));
  assert.ok(info.documentedEndpoints.includes("/retry_aim/<aim_slot>"));
});

test("the AIM Manager info uses the configured port", () => {
  const info = getAimManagerInfo(node({ aimManagerPort: "9999" }));
  assert.equal(info.baseUrl, "http://10.0.0.1:9999");
});

// -----------------------------------------------------------------------------
// The AIM lifecycle — the requests are asserted, never performed for real
// -----------------------------------------------------------------------------

test("deploying an AIM posts to the documented endpoint", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8005/add_aim": { status: 200, body: { ok: true } },
  });
  try {
    const result = await deployAim(node(), { name: "my-aim", tag: "0.1.0", port: 9000 });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://10.0.0.1:8005/add_aim");
    assert.equal(calls[0].init?.method, "POST");
    const body = String(calls[0].init?.body ?? "");
    assert.ok(body.includes("my-aim"));
    assert.ok(body.includes("0.1.0"));
  } finally {
    clearFetch();
  }
});

test("deploying an AIM without a name is refused before any request is made", async () => {
  const calls = installFetch({});
  try {
    const result = await deployAim(node(), { name: "", tag: "0.1.0", port: 9000 });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  } finally {
    clearFetch();
  }
});

test("removing an AIM posts to the documented endpoint", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8005/remove_aim/2": { status: 200, body: { ok: true } },
  });
  try {
    const result = await removeAim(node(), 2);
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "http://10.0.0.1:8005/remove_aim/2");
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    clearFetch();
  }
});

test("removing an AIM from a negative slot is refused before any request", async () => {
  const calls = installFetch({});
  try {
    const result = await removeAim(node(), -1);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  } finally {
    clearFetch();
  }
});

test("retrying an AIM posts to the documented endpoint", async () => {
  const calls = installFetch({
    "http://10.0.0.1:8005/retry_aim/0": { status: 200, body: { ok: true } },
  });
  try {
    const result = await retryAim(node(), 0);
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "http://10.0.0.1:8005/retry_aim/0");
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    clearFetch();
  }
});

test("an AIM operation that fails is reported as a failure, not as a success", async () => {
  installFetch({
    "http://10.0.0.1:8005/retry_aim/0": { status: 500, body: { error: "boom" } },
  });
  try {
    const result = await retryAim(node(), 0);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  } finally {
    clearFetch();
  }
});

test("an AIM operation whose host does not answer is reported as a failure", async () => {
  installFetch({
    "http://10.0.0.1:8005/retry_aim/0": { error: "connection refused" },
  });
  try {
    const result = await retryAim(node(), 0);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  } finally {
    clearFetch();
  }
});
