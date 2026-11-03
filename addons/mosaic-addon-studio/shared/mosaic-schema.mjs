/**
 * Mosaic add-on schema — the single source of truth.
 *
 * Every vocabulary, pattern and limit the Studio enforces lives here. The
 * validator, the project generator, the local API and the UI all import from
 * this module, so they cannot disagree with each other.
 *
 * The values below are transcribed from the Mosaic Companion runtime's own
 * validator, `electron/addons/manifest.ts`, and from the catalogue's
 * submission policy, `mosaic-open-platform/scripts/adjudicate/policy.mjs`.
 * Where the two disagree, the app wins — it is the code that runs at install
 * time.
 *
 * When Mosaic updates its schema, this file is the one place to update, and
 * `scripts/check-schema-drift.mjs` proves the transcription still matches.
 *
 * This module is deliberately dependency-free and side-effect-free: it must
 * stay importable from a browser renderer as well as from Node, so that the
 * same rules can run inside a Mosaic add-on.
 */

// ── Identity ─────────────────────────────────────────────────────────────────

/** Add-on id and IPC namespace pattern. 2–41 characters. */
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

/** Bucket id and bucket kind pattern. */
export const BUCKET_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

export const MAX_NAME_LENGTH = 40;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_TAB_LABEL_LENGTH = 24;
export const MAX_BUCKET_LABEL_LENGTH = 40;
export const MAX_BUCKETS_PUBLISHED = 8;
export const MAX_BUCKET_KINDS_READ = 8;

/** The only manifest version this runtime accepts. */
export const MANIFEST_VERSION = 1;

/** The only mount point in v1. */
export const MOUNT_POINTS = ['tab'];

/** The only update check modes. */
export const UPDATE_CHECK_MODES = ['manual', 'automatic'];

/** Default tab order when the manifest omits one. */
export const DEFAULT_TAB_ORDER = 100;

// ── Reserved IPC namespaces ──────────────────────────────────────────────────
//
// Transcribed from `electron/addons/manifest.ts` (RESERVED_IPC_NAMESPACES).
// The runtime compares by exact match, not by prefix.

export const RESERVED_IPC_NAMESPACES = [
  'nodes',
  'ai-agents',
  'ai-agents-history',
  'themes',
  'gmail',
  'web3',
  'vault',
  'media',
  'window',
  'dialog',
  'sandbox',
  'toolSandbox',
  'chronicle',
  'tools',
  'mcp',
  'chat',
  'ide',
  'aimnodes',
  'payments-jit',
  'addon',
  'addon-api',
  'addons',
  'tab-prefs',
];

// ── Permissions ──────────────────────────────────────────────────────────────
//
// Transcribed from `electron/addons/manifest.ts` (PERMISSION_VOCABULARY and
// RESERVED_PERMISSIONS). Reserved permissions are refused at install time —
// they are not "request and be denied".

export const PERMISSION_VOCABULARY = [
  'wallet:read',
  'agents:read',
  'agents:write',
  'mcp:read',
  'mcp:call',
  'nodes:read',
  'shell:open-external',
  'buckets:publish',
];

export const RESERVED_PERMISSIONS = [
  'wallet:sign',
  'agents:delete',
  'vault:read',
  'vault:write',
  'notifications',
];

// ── Main-process entry ───────────────────────────────────────────────────────
//
// An add-on's `main.entry` is imported into the Mosaic main process, where
// the permission model does not apply. The runtime restricts it to a
// one-entry allowlist, keyed on add-on id.
//
// Transcribed from `electron/addons/manifest.ts` (MAIN_ENTRY_ALLOWLIST).

export const MAIN_ENTRY_ALLOWLIST = ['hyperinsight'];

// ── npm script names ─────────────────────────────────────────────────────────
//
// Transcribed from `mosaic-open-platform/scripts/adjudicate/policy.mjs`
// (ALLOWED_ADDON_SCRIPTS).
//
// This is an allowlist, not a denylist, and deliberately so: npm decides
// which script names it runs on install, and for any script `X` it also runs
// `preX` and `postX`. A denylist is a list of names npm controls, where
// anything unlisted is safe by default — which is not true.
//
// A namespaced name (`test:unit`) is permitted when the segment BEFORE the
// colon is on the list. npm has no namespaced lifecycle hooks, so nothing
// installs, publishes or runs a script by reaching such a name. The segment
// before the colon is what gets checked, so `pretest:unit` is refused exactly
// like `pretest`.

export const ALLOWED_ADDON_SCRIPTS = [
  'build',
  'dev',
  'test',
  'lint',
  'typecheck',
  'format',
  'clean',
  'watch',
  'preview',
];

/**
 * Is this an npm script name an add-on may declare?
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isPermittedScriptName(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (ALLOWED_ADDON_SCRIPTS.includes(name)) return true;
  return ALLOWED_ADDON_SCRIPTS.includes(name.split(':')[0]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Is this a plain object (not an array, not null)?
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Is this a string whose trimmed length falls within [min, max]?
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
export function validText(value, min, max) {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max
  );
}

/**
 * Does this relative path escape its own root?
 *
 * Rejects any path with a `..` segment, on either separator.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function hasPathTraversal(relPath) {
  return String(relPath).split(/[\\/]/).some(segment => segment === '..');
}

/**
 * Is this an absolute path? True for POSIX roots and Windows drive roots.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Derive an IPC namespace from an add-on id, avoiding the reserved list.
 *
 * The Mosaic guide advises prefixing with the id, which makes a collision
 * very unlikely. When the id itself is reserved, the `-addon` suffix keeps
 * the namespace distinct from the reserved one.
 *
 * @param {string} id
 * @returns {string}
 */
export function deriveIpcNamespace(id) {
  const trimmed = String(id ?? '').trim();
  return RESERVED_IPC_NAMESPACES.includes(trimmed)
    ? `${trimmed}-addon`
    : trimmed;
}

/**
 * The licence texts an add-on may declare, by SPDX identifier.
 */
export const SUPPORTED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'GPL-3.0-or-later',
  'pending',
];
