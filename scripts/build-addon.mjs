#!/usr/bin/env node
/**
 * Builds one addon's renderer (via its own `npm run build`) and tars up
 * `manifest.json` + `main/` + `renderer/` at the archive root (§6.7:
 * "Tarball layout: addon files at archive root (manifest.json at top
 * level)"). Writes `<id>-<version>.tgz` + a `.sha256` sidecar into
 * `release-build/`.
 *
 * Usage: node scripts/build-addon.mjs <addonId> [--out <dir>]
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import * as tar from "tar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const addonId = process.argv[2];
if (!addonId) {
  console.error("Usage: node scripts/build-addon.mjs <addonId> [--out <dir>]");
  process.exit(1);
}
const outIdx = process.argv.indexOf("--out");
const outDir = path.resolve(REPO_ROOT, outIdx >= 0 ? process.argv[outIdx + 1] : "release-build");

const addonDir = path.join(REPO_ROOT, "addons", addonId);
if (!fs.existsSync(addonDir)) {
  console.error(`No such addon: ${addonId} (expected ${addonDir})`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(addonDir, "manifest.json"), "utf8"));
if (manifest.id !== addonId) {
  console.error(`manifest.json id "${manifest.id}" does not match directory name "${addonId}"`);
  process.exit(1);
}

console.log(`[build-addon] Building ${addonId}@${manifest.version}...`);
if (fs.existsSync(path.join(addonDir, "package.json"))) {
  execSync("npm install --no-audit --no-fund", { cwd: addonDir, stdio: "inherit" });
  execSync("npm run build", { cwd: addonDir, stdio: "inherit" });
}

fs.mkdirSync(outDir, { recursive: true });
const stagingDir = fs.mkdtempSync(path.join(outDir, `.staging-${addonId}-`));

// LICENSE and NOTICE ship with the tarball, not just the repo: Apache-2.0
// obliges a redistributor to carry them, and HyperCycle is the redistributor
// here. Missing ones are skipped below, so an addon without them still builds.
for (const entry of ["manifest.json", "main", "renderer", "LICENSE", "NOTICE"]) {
  const src = path.join(addonDir, entry);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(stagingDir, entry), { recursive: true });
}

const tarballName = `${addonId}-${manifest.version}.tgz`;
const tarballPath = path.join(outDir, tarballName);
await tar.create({ gzip: true, file: tarballPath, cwd: stagingDir }, fs.readdirSync(stagingDir));
fs.rmSync(stagingDir, { recursive: true, force: true });

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
fs.writeFileSync(`${tarballPath}.sha256`, sha256 + "\n");

console.log(`[build-addon] Wrote ${tarballPath} (sha256 ${sha256})`);
console.log(JSON.stringify({ id: addonId, version: manifest.version, tarball: tarballName, sha256 }));
