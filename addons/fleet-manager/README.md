# Fleet Manager

A Mosaic Companion add-on for operating a fleet of HyperCycle nodes.

The Fleet Manager answers three questions an operator of several nodes has
to answer repeatedly: **which nodes are alive right now**, **what happened
during the last few hours**, and **what should I look at next**.

## What it is

This add-on is the HyperCycle Fleet Manager — the node-management surface of
the Mosaic Companion desktop application — packaged for Mosaic as an add-on.
The domain model, the nine tabs, the diagnostics, the AIM lifecycle and the
Explorer integration are the same ones the desktop application shipped.

The port is a re-plumbing, not a rewrite. The original ran in the Electron
main process; an add-on runs in a sandboxed webview with no Node
integration, so the parts that need the host were reimplemented against the
three capabilities an add-on actually has:

| Capability | Used for |
| --- | --- |
| `addonAPI.nodes.list()` | reading the user's node registry (`nodes:read`) |
| `addonAPI.files.*` | persisting history and alerts in the add-on's own `data/` jail |
| `fetch()` | talking to the nodes, the AIM Manager and the public HyperCycle sources |

`main.entry` — the only way an add-on could reach a Node/Electron module —
is allowlisted to `hyperinsight` alone, so an add-on cannot ship one.

## The nine tabs

| Tab | What it is for |
| --- | --- |
| **Dashboard** | Fleet overview: 14 panels across six sections (summary, intelligence, operations, health, history, Explorer), with the fleet's health score, ranking, incident list and command board. |
| **Nodes** | The node list with search, state and tag filters, bulk testing, and a per-node view with endpoint diagnostics and history charts. |
| **Licenças & Factory** | The HyperCycle Explorer view for a license: uptime, downtime, heartbeats, CHyPC, chain, block and the published uptime history. |
| **AIM Manager** | The AIM Manager's documented lifecycle endpoints: pre-flight check, deploy, retry and remove, plus the endpoint catalogue. |
| **Desempenho & Tilling** | Uptime from the local observations and from the Explorer, Tilling status, and a per-node performance table. |
| **Diagnóstico** | Per-node endpoint diagnostics with coverage, reliability ranking, an intervention queue and automatic monitoring. |
| **Ganhos** | **Not implemented.** There is no authoritative source for fleet earnings, so the tab says so instead of showing numbers nobody published. |
| **Alertas** | ALIVE/DEAD transitions with a one-hour cooldown, acknowledgement and clearing. |
| **Configuração** | Data sources, language, number masking and the sanitised export. |

## Data sources

Every figure shown comes from one of these, and every one of them was
verified to answer before it was used:

| Source | What it provides |
| --- | --- |
| `https://services.hyperpg.site/node-rpc/hypercycle/nodes/` | The public node list: status, uptime summary, heartbeats. |
| `https://services.hyperpg.site/node-rpc/tiller-data/by-network/mainnet` | Tiller status, heartbeat counts and AIM slots per license. |
| `https://explorer.hypercycle.ai/v1/licenses/status` | Per license: CHyPC, chain, block, delegate, priority, published status. |
| `https://explorer.hypercycle.ai/v1/licenses/details` | Per license: the uptime summary and the published uptime history with its computation counts. |
| The node's own `/info` and `/health` | Whether the node answers, and what it says about itself. |
| `http://tilling.ioai.services:8003/license_status` | The authoritative Tilling status — **not reachable from the renderer**: the endpoint sends no CORS headers, so the browser blocks the request. The add-on reports the failure rather than hiding it. |

### What is deliberately not shown

A field a source does not publish stays empty and the interface shows `—`.
The add-on does not estimate, and it does not fill a gap with a plausible
number.

In particular, **reputation** and **scaling factor** are not published by
any public source: the Explorer's own bundle carries no such field. They
remain unavailable rather than being approximated.

**Earnings** are not implemented at all, for the same reason.

## Liveness

A node is reported alive when **either** of its own endpoints answers:

- `/info` — the node's description of itself, which carries
  `"status": "alive"`.
- `/health` — a liveness endpoint that only some node versions expose.

The two are not interchangeable, and the difference was measured against the
live network rather than assumed: on node versions 0.5.x, `/health` answers
**HTTP 405 Method Not Allowed** while `/info` answers **HTTP 200**. Treating
`/health` as the only liveness signal marked six live nodes DEAD. When
`/info` answers, its own `status` field is preferred, because that is the
node reporting on itself rather than the monitor inferring from a
transport-level code.

## Operations that change a service

Three operations modify an AIM on the node:

| Operation | Endpoint |
| --- | --- |
| Deploy | `POST :8005/add_aim` |
| Retry | `POST :8005/retry_aim/<slot>` |
| Remove | `POST :8005/remove_aim/<slot>` |

They are only ever performed on an explicit action from the interface, never
automatically, and the test suite asserts on the request that would be sent
rather than performing one.

## Permissions

The manifest declares exactly two:

- `nodes:read` — to read the node registry.
- `shell:open-external` — to open the Explorer's page for a license in the
  user's browser.

Nothing else is requested. The registry is read-only: creating, editing,
removing, activating and tagging nodes are refused with an explanation,
because the registry belongs to the Mosaic application.

## Privacy

The export is meant to be shareable. It carries the node id, whether the node
was alive, the latency and the timestamp — and no license key, no sender
address, no hostname and no probe payload.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test tests/
npm run build       # vite build -> renderer/
npm run dev         # vite dev server
```

The test suite is offline and deterministic: the host bridge and the network
are stubbed, and no test contacts a real node or a real source.

## Layout

```
addons/fleet-manager/
  manifest.json          the add-on's manifest and its permissions
  LICENSE                Apache-2.0
  NOTICE                 the copyright notice
  src/
    NodeManagerPage.tsx  the nine tabs
    lib/
      api.ts             the api.nodes.* surface the UI calls
      host.ts            the bridge to the Mosaic host and to the node's API
      network.ts         the public HyperCycle data sources
      fleet.ts           the pure fleet model (transitions, analytics, history)
      explorer.ts        diagnostics and the AIM lifecycle
      types.ts           the domain types
    types/addonApi.d.ts  the host bridge's surface, declared locally
  tests/                 the offline test suite
```

## Licence

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
