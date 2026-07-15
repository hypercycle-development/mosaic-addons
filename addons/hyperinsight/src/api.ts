// =============================================================================
// hyperinsightApi — drop-in replacement for the old
// `window.electronAPI.hyperinsight.*` surface (plugins/hyperinsight/main/
// index.js's `registerHyperInsightIpc`), now routed through the generic
// `addonAPI.invoke(method, ...args)` bridge (§5.3) into this addon's own
// `main/index.js` (§5.4's `ctx.ipc.handle`). Every method name here is
// exactly the old IPC channel's suffix (e.g. `hyperinsight:get-aims` ->
// `get-aims`), so main/index.js and this file must be kept in sync by name.
//
// Ported components import `hyperinsightApi` from here instead of reaching
// for `window.electronAPI.hyperinsight` directly — every other line of
// business logic in the ported components is unchanged.
// =============================================================================

import type { NodeSearchParams } from "./types";

// `T = any` (not `unknown`) deliberately mirrors the old
// `window.electronAPI.hyperinsight.*` surface, which was typed as
// `Promise<any>` throughout in mosaic-companion's global.d.ts — this is a
// straight port, not a type-safety upgrade, and the ported components'
// call sites already assume `any`-shaped responses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call<T = any>(method: string, ...args: unknown[]): Promise<T> {
  return window.addonAPI.invoke(method, ...args) as Promise<T>;
}

export const hyperinsightApi = {
  getStatus: () => call<{ registered: boolean; tier?: string; clientId?: string }>("get-status"),
  ensureKey: () => call<{ success: boolean; clientId?: string; error?: string }>("ensure-key"),
  resetKey: () => call<{ success: boolean; error?: string }>("reset-key"),

  getAims: () => call("get-aims"),
  getLeaderboard: () => call("get-leaderboard"),
  getNodes: (params?: NodeSearchParams) => call("get-nodes", params),
  getNodeDetail: (license: string) => call("get-node-detail", license),
  getNodeProfile: (license: number | string) => call("get-node-profile", license),
  getAimManifest: (license: string, aimName: string) => call("get-node-aim-manifest", license, aimName),
  getNetworkStats: () => call("get-network-stats"),
  getNetworkHistory: () => call("get-network-history"),
  getAimStats: (name: string, range?: string) => call("get-aim-stats", name, range),
  getAimStatsCurrent: (name: string) => call("get-aim-stats-current", name),
  getAimDetails: (name: string) => call("get-aim-details", name),
  getAimReleases: (name: string) => call("get-aim-releases", name),
  getAimReleaseDetail: (name: string, tag: string) => call("get-aim-release-detail", name, tag),

  getAimProfile: (name: string) => call("get-aim-profile", name),
  getAimNodes: (name: string, opts?: Record<string, unknown>) => call("get-aim-nodes", name, opts),
  getAimBestNode: (name: string, opts?: Record<string, unknown>) => call("get-aim-best-node", name, opts),

  getAimDeployments: (aimId: number | string) => call("get-aim-deployments", aimId),
  getToolStatus: (toolId: string) => call("get-tool-status", toolId),
  subscribe: (payload: unknown) => call("subscribe", payload),
  getSubscriptions: () => call("get-subscriptions"),
  unsubscribe: (subscriptionId: string) => call("unsubscribe", subscriptionId),
  getVerificationHistory: (subscriptionId: string) => call("get-verification-history", subscriptionId),

  getToolScore: (endpointUrl: string) => call("get-tool-score", endpointUrl),
  getAllToolScores: () => call("get-all-tool-scores"),
  getToolScoresLastUpdated: () => call("get-tool-scores-last-updated"),

  // Returns { success, relPath } — relPath is inside this addon's own
  // files-jail (ctx.paths.data), unlike the old core mosaic-media:// URL.
  // Callers read it back via addonAPI.files.readBinary + a blob URL (see
  // saveAndOpenImage below) since the addon has no core protocol access.
  saveGeneratedImage: (base64Data: string) => call<{ success: boolean; relPath?: string; error?: string }>(
    "save-generated-image",
    base64Data,
  ),

  clearCache: () => call<{ success: boolean }>("clear-cache"),
};

/** Convenience wrapper: save a generated image and hand back a blob: URL
 * usable directly as an <img src> or download link, without the caller
 * needing to know about the files-jail relPath indirection. */
export async function saveAndOpenImage(base64Data: string): Promise<string | null> {
  const result = await hyperinsightApi.saveGeneratedImage(base64Data);
  if (!result.success || !result.relPath) return null;
  const bytes = await window.addonAPI.files.readBinary(result.relPath);
  if (!bytes) return null;
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
}
