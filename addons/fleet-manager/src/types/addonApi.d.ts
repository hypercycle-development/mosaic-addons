/**
 * The Mosaic add-on API, as exposed to a renderer running inside an add-on
 * webview — isolated context, no Node integration, sandbox on.
 *
 * Declared locally rather than imported, because the app does not publish its
 * preload types to add-ons. The surface below is the one the host exposes at
 * v0.1.13 — see electron/addon-preload.ts in mosaic-companion.
 */
export interface AddonApi {
  parseError(error: unknown): { code: string; message: string };
  system: {
    getManifest(): Promise<unknown>;
    getAppInfo(): Promise<unknown>;
    getTheme(): Promise<unknown>;
  };
  settings: {
    get(): Promise<unknown>;
    set(patch: Record<string, unknown>): Promise<unknown>;
    replace(value: Record<string, unknown>): Promise<unknown>;
    clear(): Promise<unknown>;
  };
  files: {
    read(relPath: string): Promise<string>;
    readBinary(relPath: string): Promise<Uint8Array | null>;
    write(relPath: string, contents: string | Uint8Array): Promise<unknown>;
    list(relDir?: string): Promise<unknown>;
    delete(relPath: string): Promise<unknown>;
    mkdir(relDir: string): Promise<unknown>;
  };
  events: {
    on(channel: string, cb: (payload: unknown) => void): () => void;
  };
  ui: {
    setTitle(title: string): Promise<unknown>;
    openExternal(url: string): Promise<unknown>;
  };
  wallet: {
    getAddress(): Promise<unknown>;
    getBalance(tokenSymbol?: string): Promise<unknown>;
    getNetworkInfo(): Promise<unknown>;
  };
  agents: {
    list(): Promise<unknown>;
    get(id: string): Promise<unknown>;
    add(agent: Record<string, unknown>): Promise<unknown>;
    update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  };
  mcp: {
    listServers(): Promise<unknown>;
    listTools(serverId: string): Promise<unknown>;
    callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  };
  nodes: {
    list(): Promise<unknown>;
    getSavedAims(license?: string): Promise<unknown>;
  };
  buckets: {
    write(bucketId: string, items: Array<{ id: string; data: unknown }>): Promise<unknown>;
    clear(bucketId: string, ids?: string[]): Promise<unknown>;
    list(): Promise<unknown>;
    read(ownerId: string, bucketId: string): Promise<unknown>;
  };
  invoke(method: string, ...args: unknown[]): Promise<unknown>;
  init(): Promise<unknown>;
}

declare global {
  interface Window {
    addonAPI?: AddonApi;
  }
}

export {};
