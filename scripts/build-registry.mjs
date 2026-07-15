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
 * Usage: node scripts/build-registry.mjs [--out <dir>] [--base-url <url>]
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

const addonsRoot = path.join(REPO_ROOT, "addons");
const addonIds = fs.readdirSync(addonsRoot).filter((d) => fs.statSync(path.join(addonsRoot, d)).isDirectory());

const entries = [];
for (const id of addonIds) {
  const manifestPath = path.join(addonsRoot, id, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const tarballName = `${id}-${manifest.version}.tgz`;
  const tarballPath = path.join(outDir, tarballName);
  const shaPath = `${tarballPath}.sha256`;
  if (!fs.existsSync(tarballPath) || !fs.existsSync(shaPath)) {
    console.warn(`[build-registry] Skipping ${id} — run build-addon.mjs ${id} first (missing ${tarballName})`);
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

const registry = { schemaVersion: 1, addons: entries };
fs.mkdirSync(outDir, { recursive: true });
const registryPath = path.join(outDir, "addon-registry.json");
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log(`[build-registry] Wrote ${registryPath} (${entries.length} addon(s))`);
