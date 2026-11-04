// =============================================================================
// Fleet Manager — tests for the public network data source parsing.
//
// The shapes below are the real ones, captured from
//   https://services.hyperpg.site/node-rpc/hypercycle/nodes/            (200)
//   https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet (200)
//   http://tilling.ioai.services:8003/license_status?license=<n>        (200)
//
// The fetch is stubbed so the tests are deterministic and offline.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchExplorerInfo, fetchNetworkNodes, fetchTillerData } from "../src/lib/network.ts";

// A trimmed but structurally exact capture of the public node list.
const NODES_PAYLOAD = {
  "60": 1784000000,
  nodes: [
    {
      _id: "6a444d4040d76e9fc2abe295",
      last_updated: 1783996021.79,
      schema_valid: true,
      data: {
        status: "offline",
        name: "Hypercycle Node",
        address: "52.73.19.138:8000",
        node_version: "0.4.15",
        node_id: "1d17d4fe6315f62b",
        network: "mainnet",
        license: "4503874505352752",
        uptime_summary: {
          total_time: 56894591.72921443,
          up_time: 46627563.93342161,
          down_time: 10267027.795792818,
          percent_up: 0.8195429905427167,
          heartbeats: 135419,
        },
      },
    },
    {
      _id: "6a444d4040d76e9fc2abe296",
      last_updated: 1783996022.79,
      schema_valid: true,
      data: {
        status: "alive",
        name: "Another Node",
        address: "18.236.42.238:8000",
        node_id: "2d17d4fe6315f62b",
        network: "mainnet",
        license: "4503874505352933",
        uptime_summary: {
          total_time: 1000,
          up_time: 800,
          down_time: 200,
          percent_up: 0.8,
          heartbeats: 10,
        },
      },
    },
  ],
};

const TILLER_PAYLOAD = [
  {
    _id: "6a444db9c84b31d15f67ccc2",
    original_node_id: "6a444d4040d76e9fc2abe2a1",
    slot: 0,
    available: 191,
    last_updated: 1783996021.791727,
    node_license: "4503874505352933",
    node_network: "mainnet",
    port: 0,
    tiller_address: "18.236.42.238:8000",
    tillers: [
      {
        number: 1,
        tiller_license: 562984313174157,
        heartbeats: 127584,
        till_status: "ok",
        time_left: 11754330.259109974,
      },
    ],
  },
];

/** Replaces globalThis.fetch with a stub that answers per URL. */
function stubFetch(handlers: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unstubbed URL: ${url}`);
    const body = handlers[key];
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("fetchNetworkNodes reduces the public node list to the fleet's fields", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD });
  try {
    const { nodes, error } = await fetchNetworkNodes();
    assert.equal(error, undefined);
    assert.equal(nodes.length, 2);

    const first = nodes[0];
    assert.equal(first.license, "4503874505352752");
    assert.equal(first.status, "offline");
    assert.equal(first.network, "mainnet");
    assert.equal(first.address, "52.73.19.138:8000");
    assert.equal(first.heartbeats, 135419);
  } finally {
    restore();
  }
});

test("fetchNetworkNodes converts percent_up from a fraction to a percentage", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD });
  try {
    const { nodes } = await fetchNetworkNodes();
    // 0.8195429905427167 -> 81.95% (rounded to two decimals so the UI never
    // shows a 17-digit float).
    assert.equal(nodes[0].percentUp, 81.95);
    assert.equal(nodes[1].percentUp, 80);
  } finally {
    restore();
  }
});

test("fetchNetworkNodes keeps the raw uptime seconds", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD });
  try {
    const { nodes } = await fetchNetworkNodes();
    assert.ok(Math.abs((nodes[0].upTime ?? 0) - 46627563.93342161) < 1e-6);
    assert.ok(Math.abs((nodes[0].downTime ?? 0) - 10267027.795792818) < 1e-6);
    assert.ok(Math.abs((nodes[0].totalTime ?? 0) - 56894591.72921443) < 1e-6);
  } finally {
    restore();
  }
});

test("fetchNetworkNodes skips an entry with no license rather than inventing one", async () => {
  const restore = stubFetch({
    "hypercycle/nodes": { nodes: [{ data: { status: "alive", uptime_summary: {} } }] },
  });
  try {
    const { nodes, error } = await fetchNetworkNodes();
    assert.equal(error, undefined);
    assert.equal(nodes.length, 0);
  } finally {
    restore();
  }
});

test("fetchNetworkNodes reports an error instead of an empty list when the shape is wrong", async () => {
  const restore = stubFetch({ "hypercycle/nodes": { unexpected: true } });
  try {
    const { nodes, error } = await fetchNetworkNodes();
    assert.equal(nodes.length, 0);
    assert.ok(error);
  } finally {
    restore();
  }
});

test("fetchTillerData reduces the tiller list to per-license facts", async () => {
  const restore = stubFetch({ "tiller-data": TILLER_PAYLOAD });
  try {
    const { byLicense, error } = await fetchTillerData();
    assert.equal(error, undefined);
    const record = byLicense["4503874505352933"];
    assert.ok(record);
    assert.equal(record.tillStatus, "ok");
    assert.equal(record.heartbeats, 127584);
    assert.deepEqual(record.slots, [0]);
  } finally {
    restore();
  }
});

test("fetchExplorerInfo maps the node list and tiller data onto the Explorer view", async () => {
  const restore = stubFetch({
    "hypercycle/nodes": NODES_PAYLOAD,
    "tiller-data": TILLER_PAYLOAD,
  });
  try {
    const { byLicense, error } = await fetchExplorerInfo();
    assert.equal(error, undefined);

    const withTiller = byLicense["4503874505352933"];
    assert.ok(withTiller);
    assert.equal(withTiller.status, "alive");
    assert.equal(withTiller.tillingScore, "ok");
    assert.equal(withTiller.heartbeat, 10);

    const withoutTiller = byLicense["4503874505352752"];
    assert.ok(withoutTiller);
    assert.equal(withoutTiller.status, "offline");
    // No tiller entry for this license: the tilling figures stay undefined
    // rather than being copied from another node.
    assert.equal(withoutTiller.tillingScore, undefined);
  } finally {
    restore();
  }
});

test("fetchExplorerInfo leaves the fields the API does not publish undefined", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD, "tiller-data": [] });
  try {
    const { byLicense } = await fetchExplorerInfo();
    const info = byLicense["4503874505352752"];
    assert.ok(info);
    // The public node list does not publish these — they must not appear.
    assert.equal(info.computation, undefined);
    assert.equal(info.reputation, undefined);
    assert.equal(info.scalingFactor, undefined);
    assert.equal(info.level, undefined);
  } finally {
    restore();
  }
});

test("fetchExplorerInfo reports the node-list failure and returns nothing", async () => {
  const restore = stubFetch({ "hypercycle/nodes": { unexpected: true }, "tiller-data": [] });
  try {
    const { byLicense, error } = await fetchExplorerInfo();
    assert.equal(Object.keys(byLicense).length, 0);
    assert.ok(error);
  } finally {
    restore();
  }
});


test("fetchExplorerInfo exposes the uptime figures in hours, as the UI reads them", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD, "tiller-data": [] });
  try {
    const { byLicense } = await fetchExplorerInfo();
    const info = byLicense["4503874505352752"];
    assert.ok(info);

    // The API publishes seconds; the UI reads hours.
    assert.equal(info.totalHours, 56894591.72921443 / 3600);
    assert.equal(info.upHours, 46627563.93342161 / 3600);
    assert.equal(info.downHours, 10267027.795792818 / 3600);

    // And the raw seconds stay available.
    assert.equal(info.upTime, 46627563.93342161);
    assert.equal(info.downTime, 10267027.795792818);
    assert.equal(info.totalTime, 56894591.72921443);
  } finally {
    restore();
  }
});

test("the reported uptime percentage is rounded to two decimals", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD, "tiller-data": [] });
  try {
    const { byLicense } = await fetchExplorerInfo();
    const info = byLicense["4503874505352752"];
    assert.ok(info);
    // 81.95429905427167 -> 81.95, never a 17-digit float in the UI.
    assert.equal(info.upPercent, 81.95);
    assert.ok(String(info.upPercent).length <= 5);
  } finally {
    restore();
  }
});

test("fetchExplorerInfo records when the source answered", async () => {
  const restore = stubFetch({ "hypercycle/nodes": NODES_PAYLOAD, "tiller-data": [] });
  try {
    const { byLicense } = await fetchExplorerInfo();
    const info = byLicense["4503874505352752"];
    assert.ok(info);
    assert.ok(info.fetchedAt);
    assert.ok(!Number.isNaN(Date.parse(info.fetchedAt)));
  } finally {
    restore();
  }
});
