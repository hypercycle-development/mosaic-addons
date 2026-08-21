#!/usr/bin/env node
/**
 * Assembles `addon-registry.json` from every `<id>-<version>.tgz` already
 * built into `release-build/` (run `build-addon.mjs` per addon first), using
 * each addon's `manifest.json` for name/description/permissions/icon.
 *
 * `tarballUrl` here is a placeholder path (`./<tarball>`) — the real release
 * workflow rewrites it to the actual GitHub Release asset URL after upload
 * (see `.github/workflows/release.yml`). For local/offline testing, a static
 * file server rooted at `release-build/` makes these relative paths resolve
 * correctly if you pass `--base-url`.
 *
 * WHICH addons are published is declared in `catalogue.json` (`{ "published":
 * [...] }`), not inferred from what happens to be in `addons/`. That is what
 * lets the repo hold an addon that is not ready to ship — an addon is
 * published because it was named, never because it was present.
 *
 * `--require-all` makes a skipped addon a hard error instead of a warning.
 * Release CI passes it: a registry that quietly omits an addon delists it
 * for every user, which is exactly how a one-addon catalogue was published
 * before. Leave it off for local partial builds.
 *
 * `--sequence <n>` stamps the registry's rollback counter. It MUST strictly
 * increase across publishes: the app persists the highest sequence it has ever
 * verified and refuses anything lower, which is what stops an attacker
 * replaying an old — but still validly signed — registry to erase a
 * withdrawal. Release CI derives it from the `catalogue-vN` tag.
 *
 * Withdrawals are read from `withdrawn.json` at the repo root (an array of
 * `{ id, versions, reason, severity, withdrawnAt }`), so pulling an addon is a
 * reviewable diff rather than a hand-edited release artifact.
 *
 * Usage: node scripts/build-registry.mjs [--out <dir>] [--base-url <url>]
 *                                        [--require-all] [--sequence <n>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const outIdx = process.argv.indexOf("--out");
const outDir = path.resolve(REPO_ROOT, outIdx >= 0 ? process.argv[outIdx + 1] : "release-build");
const baseUrlIdx = process.argv.indexOf("--base-url");
const baseUrl = baseUrlIdx >= 0 ? process.argv[baseUrlIdx + 1].replace(/\/$/, "") : "";
const requireAll = process.argv.includes("--require-all");
const seqIdx = process.argv.indexOf("--sequence");
const sequence = seqIdx >= 0 ? Number(process.argv[seqIdx + 1]) : 0;
if (seqIdx >= 0 && (!Number.isInteger(sequence) || sequence < 1)) {
  console.error(`[build-registry] --sequence must be a positive integer, got "${process.argv[seqIdx + 1]}"`);
  process.exit(1);
}

// Withdrawals: publisher's source of truth, committed and reviewable.
const withdrawnPath = path.join(REPO_ROOT, "withdrawn.json");
let withdrawn = [];
if (fs.existsSync(withdrawnPath)) {
  withdrawn = JSON.parse(fs.readFileSync(withdrawnPath, "utf8"));
  if (!Array.isArray(withdrawn)) {
    console.error("[build-registry] withdrawn.json must contain an array");
    process.exit(1);
  }
  for (const w of withdrawn) {
    if (!w || typeof w.id !== "string" || !w.id) {
      console.error(`[build-registry] withdrawn.json entry missing an id: ${JSON.stringify(w)}`);
      process.exit(1);
    }
    // Severity is REQUIRED here, not defaulted. The app defaults an absent
    // severity to "security" — correct defensively, since a truncated or
    // tampered field must not downgrade enforcement — but that same default
    // on the publisher side would mean forgetting one word silently disables
    // the addon for every user who has it. Disabling someone's working addon
    // has to be a thing you deliberately typed.
    if (w.severity !== "security" && w.severity !== "advisory") {
      console.error(
        `[build-registry] withdrawn.json "${w.id}": severity is required and must be "security" ` +
          `(deactivates it for every user) or "advisory" (warns only, keeps working).`,
      );
      process.exit(1);
    }
    if (typeof w.reason !== "string" || w.reason.trim().length === 0) {
      // The reason is shown to the user in place of the addon they lost.
      console.error(`[build-registry] withdrawn.json "${w.id}": a reason is required — the user is shown it.`);
      process.exit(1);
    }
  }
}

const addonsRoot = path.join(REPO_ROOT, "addons");
const presentIds = fs.readdirSync(addonsRoot).filter((d) => fs.statSync(path.join(addonsRoot, d)).isDirectory());

// The publish set. Explicit opt-in: an addon ships because catalogue.json
// names it, never because it exists on disk. Without this, adding a
// work-in-progress addon to the repo would publish it on the next release.
const cataloguePath = path.join(REPO_ROOT, "catalogue.json");
let addonIds = presentIds;
let unpublished = [];
if (fs.existsSync(cataloguePath)) {
  const catalogue = JSON.parse(fs.readFileSync(cataloguePath, "utf8"));
  if (!Array.isArray(catalogue.published)) {
    console.error('[build-registry] catalogue.json must contain { "published": [ids] }');
    process.exit(1);
  }
  const missingDirs = catalogue.published.filter((id) => !presentIds.includes(id));
  if (missingDirs.length > 0) {
    console.error(`[build-registry] catalogue.json publishes addons with no directory: ${missingDirs.join(", ")}`);
    process.exit(1);
  }
  addonIds = catalogue.published;
  unpublished = presentIds.filter((id) => !catalogue.published.includes(id));
  if (unpublished.length > 0) {
    // Loud, because "why is my addon not in the catalogue" should never need
    // debugging. Deliberate omission, not a silent build accident.
    console.log(`[build-registry] Not published (absent from catalogue.json): ${unpublished.join(", ")}`);
  }
} else {
  console.warn("[build-registry] No catalogue.json — publishing every addon present. Add one to be explicit.");
}

const entries = [];
const skipped = [];
for (const id of addonIds) {
  const manifestPath = path.join(addonsRoot, id, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const tarballName = `${id}-${manifest.version}.tgz`;
  const tarballPath = path.join(outDir, tarballName);
  const shaPath = `${tarballPath}.sha256`;
  if (!fs.existsSync(tarballPath) || !fs.existsSync(shaPath)) {
    console.warn(`[build-registry] Skipping ${id} — run build-addon.mjs ${id} first (missing ${tarballName})`);
    skipped.push(id);
    continue;
  }
  const sha256 = fs.readFileSync(shaPath, "utf8").trim();

  entries.push({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    minAppVersion: manifest.minAppVersion,
    tarballUrl: baseUrl ? `${baseUrl}/${tarballName}` : `./${tarballName}`,
    sha256,
    permissions: manifest.permissions ?? [],
    icon: manifest.tab?.icon,
    homepage: manifest.homepage,
  });
}

if (requireAll && skipped.length > 0) {
  console.error(
    `[build-registry] --require-all: ${skipped.length} published addon(s) missing a built tarball: ${skipped.join(", ")}. ` +
      `Publishing this registry would delist them for every user. Run build-addon.mjs for each, ` +
      `or remove them from catalogue.json if they are not meant to ship.`,
  );
  process.exit(1);
}

// A withdrawn addon must not also be listed for install. Catching it here
// means the publisher cannot ship a registry that both offers and withdraws
// the same thing — the app resolves that in favour of withdrawal, but a
// registry that needs resolving is a mistake.
const withdrawnIds = new Set(withdrawn.map((w) => w.id));
const contradictions = entries.filter((e) => withdrawnIds.has(e.id)).map((e) => e.id);
if (contradictions.length > 0) {
  console.error(
    `[build-registry] these addons are both listed and withdrawn: ${contradictions.join(", ")}. ` +
      `Remove them from addons/ (or from withdrawn.json) before publishing.`,
  );
  process.exit(1);
}

const registry = {
  schemaVersion: 1,
  sequence,
  publishedAt: new Date().toISOString(),
  addons: entries,
  withdrawn,
};
fs.mkdirSync(outDir, { recursive: true });
const registryPath = path.join(outDir, "addon-registry.json");
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log(
  `[build-registry] Wrote ${registryPath} (sequence ${sequence}, ${entries.length} addon(s): ` +
    `${entries.map((e) => e.id).join(", ") || "none"}; ${withdrawn.length} withdrawn)`,
);
