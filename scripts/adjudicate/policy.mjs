// ============================================================================
// Adjudication policy — the fixed vocabularies and pattern sets the
// deterministic checker enforces against a contributed addon patch.
//
// SOURCE OF TRUTH for the manifest vocabularies below is the app itself:
//   mosaic-companion/electron/addons/manifest.ts
//     - PERMISSION_VOCABULARY
//     - RESERVED_PERMISSIONS
//     - RESERVED_IPC_NAMESPACES
// The app's validateManifest() is the authoritative FULL validator, run at
// install time. This file mirrors only the policy subset that matters for
// *review* (what capabilities a contribution may declare), so a reviewer sees
// a violation before install rather than after. Keep these in sync by hand;
// `adjudicate.mjs --app-src <path>` can cross-check for drift when a
// mosaic-companion checkout is available.
// ============================================================================

/** Permissions an addon may declare in v1. (manifest.ts §5.2) */
export const PERMISSION_VOCABULARY = [
  "wallet:read",
  "agents:read",
  "agents:write",
  "mcp:read",
  "mcp:call",
  "nodes:read",
  "shell:open-external",
];

/** Named so the strings are stable, but REJECTED at install in v1. Declaring
 * any of these is a hard failure. (manifest.ts §5.2) */
export const RESERVED_PERMISSIONS = [
  "wallet:sign",
  "agents:delete",
  "vault:read",
  "vault:write",
  "notifications",
];

/** ipcNamespace values an addon may not claim (collision with core). */
export const RESERVED_IPC_NAMESPACES = [
  "nodes", "ai-agents", "ai-agents-history", "themes", "gmail", "web3",
  "vault", "media", "window", "dialog", "sandbox", "toolSandbox",
  "chronicle", "tools", "mcp", "chat", "ide", "aimnodes", "payments-jit",
  "addon", "addon-api", "addons", "tab-prefs",
];

// Manifest field constraints mirrored from manifest.ts.
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const IPC_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const MAX_NAME_LENGTH = 40;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_TAB_LABEL_LENGTH = 24;
// Subset of node-semver — mosaic-addons has no semver dependency. Good enough
// to catch a malformed version; the app applies the full check at install.
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ── Scope: everything a patch touches must live under addons/<id>/ ──────────
// Paths matching these are never part of a legitimate addon contribution and,
// if touched, escalate the scope violation from "unexpected" to "critical".
export const SENSITIVE_PATH_PATTERNS = [
  { re: /(^|\/)addon-registry\.json$/, why: "the signed addon registry" },
  { re: /\.sig$/, why: "a signature file" },
  { re: /(^|\/)fixtures\//, why: "signing-key fixtures" },
  { re: /(^|\/)\.github\//, why: "CI / release workflows" },
  { re: /(^|\/)scripts\//, why: "build / signing / adjudication tooling" },
  { re: /^package(-lock)?\.json$/, why: "root repo tooling manifest" },
];

// npm lifecycle script names that run code on `npm install` — an addon must
// never ship these (arbitrary code execution at install). Hard failure.
export const INSTALL_LIFECYCLE_SCRIPTS = [
  "preinstall", "install", "postinstall", "prepare", "prepublish",
  "prepublishOnly", "preuninstall", "postuninstall",
];

// A dependency specifier that is not a plain semver/range from the registry
// (git URLs, tarball URLs, local paths, github: shorthand, bare user/repo, or
// an aliased package) — hard failure: each defeats source review by pinning to
// something mutable, or by installing a package other than the one named.
//
// Two forms are easy to miss and both were live here until 2026-08-25:
//
//   "lodash": "attacker/lodash"   bare user/repo. npm resolves this to a
//                                 GitHub tarball at the default branch HEAD —
//                                 mutable, and reviewed by nobody. Only the
//                                 `user/repo#ref` form used to be caught.
//   "lodash": "npm:evil@1.0.0"    an alias. The name in the manifest is not
//                                 the package that gets installed.
//
// Anything that is not a bare semver range should be treated as suspect here;
// the allowlist below is deliberately narrow.
// The path forms are anchored to a following slash on purpose: a bare `~` or
// `.` prefix also matches ordinary semver ranges, and `~2.0.0` is about as
// common a dependency spec as exists. The previous character class rejected it.
export const NON_REGISTRY_DEP_RE =
  /^(git\+|git:|https?:|file:|link:|portal:|github:|npm:|workspace:|patch:|[^@\s]+\/[^@\s]+(#|$)|\.{1,2}\/|~\/|\/)/i;

// The app's own trust boundary for main-process code, mirrored. An addon whose
// id is not here may not ship `main.entry` at all: main-process code runs
// unsandboxed with full Node and Electron access, and the permission model
// does not apply to it. The app rejects the install outright
// (`electron/addons/manifest.ts`), so a patch that adds `main.entry` to any
// other addon cannot ever be published — the pipeline must say so rather than
// leaving it to a reviewer to notice.
export const MAIN_ENTRY_ALLOWLIST = ["hyperinsight"];

// ── Capability scan — produces the JUDGMENT QUEUE, never a verdict ──────────
// Each hit is a file:line a human must read and rule on. Categories are
// ordered roughly by how much they matter for an isolated addon.
export const SCAN_CATEGORIES = [
  {
    key: "native-exec",
    label: "Native/process execution (runs outside the webview sandbox)",
    patterns: [
      /\bchild_process\b/,
      /\bspawn(Sync)?\s*\(/,
      /\bexec(File)?(Sync)?\s*\(/,
      /["']node:child_process["']/,
    ],
  },
  {
    key: "sandbox-escape",
    label: "Direct Electron/IPC access (addons must use window.addonAPI only)",
    patterns: [
      /require\(\s*["']electron["']\s*\)/,
      /\bipcRenderer\b/,
      /\bwindow\.electronAPI\b/,
      /\bnodeIntegration\b/,
      /\bwebPreferences\b/,
    ],
  },
  {
    key: "dynamic-eval",
    label: "Dynamic code evaluation",
    patterns: [/\beval\s*\(/, /new\s+Function\s*\(/, /\bvm\.(runIn|compile)/],
  },
  {
    key: "wallet-signing",
    label: "Transaction signing / submission (the withheld wallet:sign surface)",
    patterns: [/\bsignTx\b/, /\bsubmitTx\b/, /\bsignData\b/, /\bpartialSign\b/, /\.enable\s*\(\s*\)/],
  },
  {
    key: "network",
    label: "Network egress (no host allowlist exists yet — enumerate & judge)",
    patterns: [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\baxios\b/, /\bnet\.connect\b/, /\bdns\./],
  },
  {
    key: "fs-write",
    label: "Filesystem writes (must stay within ctx.paths.data)",
    patterns: [/fs\.(write|append|unlink|rm|rmdir|mkdir|chmod|symlink)/, /writeFileSync/],
  },
  {
    key: "secrets",
    label: "Secret / key material handling",
    patterns: [
      /\b(privateKey|mnemonic|seedPhrase|secretKey)\b/i,
      /process\.env\.[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)/,
    ],
  },
  {
    key: "obfuscation",
    label: "Possible obfuscation (hand-review the source it hides)",
    patterns: [/[A-Za-z0-9+/]{240,}={0,2}/, /(\\x[0-9a-fA-F]{2}){8,}/, /String\.fromCharCode\s*\(/],
  },
];

// Extract bare hostnames from any URL literals, for the network judgment list.
export const URL_RE = /\bhttps?:\/\/([^\s/"'`)]+)/g;
