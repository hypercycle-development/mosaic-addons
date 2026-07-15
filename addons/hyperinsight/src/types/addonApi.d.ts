/**
 * `window.addonAPI` surface, as exposed by mosaic-companion's
 * `electron/addon-preload.ts` (§5.3). This addon has no `electronAPI`
 * access at all — only this. HyperInsight's manifest grants only
 * `nodes:read` (§9.2) — everything else it does is between its own
 * `main/index.js` and `api.hyperinsight.app` directly via `ctx.ipc.handle`,
 * reached through `addonAPI.invoke()`, which needs no addonAPI permission
 * at all.
 */

interface AddonApiError {
  code: string;
  message: string;
}

declare global {
  interface Window {
    addonAPI: {
      parseError: (error: unknown) => AddonApiError;
      system: {
        getManifest: () => Promise<unknown>;
        getAppInfo: () => Promise<{ appVersion: string; platform: string; locale: string }>;
        getTheme: () => Promise<{ themeKey: string; cssVars: Record<string, string> }>;
      };
      settings: {
        get: () => Promise<Record<string, unknown>>;
        set: (patch: Record<string, unknown>) => Promise<void>;
        replace: (value: Record<string, unknown>) => Promise<void>;
        clear: () => Promise<void>;
      };
      files: {
        read: (relPath: string) => Promise<string | null>;
        readBinary: (relPath: string) => Promise<Uint8Array | null>;
        write: (relPath: string, contents: string | Uint8Array) => Promise<void>;
        list: (relDir?: string) => Promise<Array<{ name: string; isDir: boolean; size: number; mtime: number }>>;
        delete: (relPath: string) => Promise<void>;
        mkdir: (relDir: string) => Promise<void>;
      };
      events: {
        on: (channel: string, cb: (payload: unknown) => void) => () => void;
      };
      ui: {
        setTitle: (title: string) => Promise<void>;
        openExternal: (url: string) => Promise<void>;
      };
      nodes: {
        list: () => Promise<Array<{ id: string; name: string; apiHost: string; apiPort?: string; isActive: boolean; licenseKey?: string }>>;
        getSavedAims: (license?: string) => Promise<unknown>;
      };
      invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
      init: () => Promise<{
        addonId: string;
        manifest: unknown;
        theme: { themeKey: string; cssVars: Record<string, string> };
        platform: string;
        appVersion: string;
        locale: string;
      } | null>;
    };
    /** Must be undefined in this addon — verified by the Phase 7 test harness. */
    electronAPI?: undefined;
  }
}

export {};
