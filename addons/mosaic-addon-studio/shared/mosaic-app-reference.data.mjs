/**
 * Pinned Mosaic app reference — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   node scripts/generate-app-reference.mjs --app-src <mosaic-companion checkout>
 *
 * Source:    https://github.com/hypercycle-development/mosaic-companion
 * Revision:  v0.1.13
 * Commit:    7af40c8ba2ed283a67852a2d8378eec425d1f943
 * Generated: 2026-11-01T00:03:38.502Z
 *
 * These are the facts the Mosaic Companion actually implements, read from the
 * revision above. A check that blocks a contributor must be traceable to the
 * application it describes, so the provenance travels with the data.
 */

export const APP_REFERENCE = {
  "provenance": {
    "repository": "https://github.com/hypercycle-development/mosaic-companion",
    "revision": "v0.1.13",
    "commit": "7af40c8ba2ed283a67852a2d8378eec425d1f943",
    "generatedAt": "2026-11-01T00:03:38.502Z",
    "source": "electron/addon-preload.ts, electron/addons/api/*.ts, src/components/Sidebar.tsx"
  },
  "icons": [
    "Server",
    "Zap",
    "Cpu",
    "Activity",
    "Trophy",
    "BarChart3",
    "Globe",
    "Database",
    "Layers",
    "Box",
    "Shield",
    "Hash",
    "Rocket",
    "Store",
    "Wallet",
    "Network",
    "Boxes",
    "Telescope",
    "Sparkles",
    "Lock",
    "Bot",
    "MessageSquare",
    "Settings",
    "Home",
    "Plug",
    "BrainCircuit",
    "Code2",
    "Star",
    "Clock",
    "Power",
    "LayoutGrid"
  ],
  "api": {
    "namespaces": {
      "system": [
        "getAppInfo",
        "getManifest",
        "getTheme"
      ],
      "settings": [
        "clear",
        "get",
        "replace",
        "set"
      ],
      "files": [
        "delete",
        "list",
        "mkdir",
        "read",
        "readBinary",
        "write"
      ],
      "events": [
        "on"
      ],
      "ui": [
        "openExternal",
        "setTitle"
      ],
      "wallet": [
        "getAddress",
        "getBalance",
        "getNetworkInfo"
      ],
      "agents": [
        "add",
        "get",
        "list",
        "update"
      ],
      "mcp": [
        "callTool",
        "listServers",
        "listTools"
      ],
      "nodes": [
        "getSavedAims",
        "list"
      ],
      "buckets": [
        "clear",
        "list",
        "read",
        "write"
      ]
    },
    "root": [
      "init",
      "invoke",
      "parseError"
    ]
  },
  "permissions": {
    "system.getManifest": null,
    "system.getAppInfo": null,
    "system.getTheme": null,
    "settings.get": null,
    "settings.set": null,
    "settings.replace": null,
    "settings.clear": null,
    "files.read": null,
    "files.readBinary": null,
    "files.write": null,
    "files.list": null,
    "files.delete": null,
    "files.mkdir": null,
    "events.subscribe": null,
    "events.unsubscribe": null,
    "ui.setTitle": null,
    "ui.openExternal": "shell:open-external",
    "wallet.getAddress": "wallet:read",
    "wallet.getBalance": "wallet:read",
    "wallet.getNetworkInfo": "wallet:read",
    "agents.list": "agents:read",
    "agents.get": "agents:read",
    "agents.add": "agents:write",
    "agents.update": "agents:write",
    "mcp.listServers": "mcp:read",
    "mcp.listTools": "mcp:read",
    "mcp.callTool": "mcp:call",
    "buckets.write": "buckets:publish",
    "buckets.clear": "buckets:publish",
    "buckets.list": null,
    "buckets.read": null,
    "nodes.list": "nodes:read",
    "nodes.getSavedAims": "nodes:read"
  },
  "since": {
    "system.getManifest": "0.1.10",
    "system.getAppInfo": "0.1.10",
    "system.getTheme": "0.1.10",
    "settings.get": "0.1.10",
    "settings.set": "0.1.10",
    "settings.replace": "0.1.10",
    "settings.clear": "0.1.10",
    "files.read": "0.1.10",
    "files.readBinary": "0.1.10",
    "files.write": "0.1.10",
    "files.list": "0.1.10",
    "files.delete": "0.1.10",
    "files.mkdir": "0.1.10",
    "events.subscribe": "0.1.10",
    "events.unsubscribe": "0.1.10",
    "ui.setTitle": "0.1.10",
    "ui.openExternal": "0.1.10",
    "wallet.getAddress": "0.1.10",
    "wallet.getBalance": "0.1.10",
    "wallet.getNetworkInfo": "0.1.10",
    "agents.list": "0.1.10",
    "agents.get": "0.1.10",
    "agents.add": "0.1.10",
    "agents.update": "0.1.10",
    "mcp.listServers": "0.1.10",
    "mcp.listTools": "0.1.10",
    "mcp.callTool": "0.1.10",
    "buckets.write": "0.1.13",
    "buckets.clear": "0.1.13",
    "buckets.list": "0.1.13",
    "buckets.read": "0.1.13",
    "nodes.list": "0.1.10",
    "nodes.getSavedAims": "0.1.10",
    "events.on": "0.1.10"
  }
};

export default APP_REFERENCE;
