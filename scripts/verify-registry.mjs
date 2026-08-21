#!/usr/bin/env node
/**
 * Verifies a signed `addon-registry.json` against the PUBLIC publisher keys
 * in `publisher-keys.json` — the same check `mosaic-companion`'s
 * `electron/addons/signing.ts` `verifyRegistry()` performs, run before we
 * publish instead of after a user has already installed the app.
 *
 * This deliberately never touches the private key: release CI runs it as a
 * separate step from signing, so the secret is scoped to the signing step
 * alone.
 *
 * The check that matters most here is the keyId one. `publisher-keys.json`
 * must hold the same entries pinned in the app's `PRODUCTION_PUBLISHER_KEYS`.
 * If CI signs with a key the app does not trust, every installed app fails
 * closed and reports "no catalogue" with nothing in the logs to say why —
 * so that mismatch has to fail here, loudly, at publish time.
 *
 * Usage: node scripts/verify-registry.mjs [--registry <path>] [--keys <path>]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const registryPath = path.resolve(REPO_ROOT, argValue("--registry", "release-build/addon-registry.json"));
const keysPath = path.resolve(REPO_ROOT, argValue("--keys", "publisher-keys.json"));
const sigPath = `${registryPath}.sig`;

function fail(message) {
  console.error(`[verify-registry] FAIL: ${message}`);
  process.exit(1);
}

for (const [label, p] of [["registry", registryPath], ["signature", sigPath], ["publisher keys", keysPath]]) {
  if (!fs.existsSync(p)) fail(`no ${label} at ${p}`);
}

const registryBytes = fs.readFileSync(registryPath); // raw bytes — never a re-serialized copy
let envelope;
try {
  envelope = JSON.parse(fs.readFileSync(sigPath, "utf8"));
} catch (error) {
  fail(`malformed signature envelope: ${error.message}`);
}
if (typeof envelope?.keyId !== "string" || typeof envelope?.signature !== "string") {
  fail("signature envelope must be { keyId, signature }");
}

const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
if (!Array.isArray(keys) || keys.length === 0) {
  fail(`${keysPath} lists no publisher keys — the production key has not been pinned yet (see README GO-LIVE TODO)`);
}

// Unrecognized keyId rejects outright. No falling back to trying every key,
// no "try anyway" — same rule as the app.
const pinned = keys.find((k) => k.keyId === envelope.keyId);
if (!pinned) {
  fail(
    `registry is signed by keyId "${envelope.keyId}", which is not in ${path.basename(keysPath)} ` +
      `(pinned: ${keys.map((k) => k.keyId).join(", ") || "none"}). ` +
      `Either CI is signing with the wrong key, or the key was never pinned into the app.`,
  );
}
if (pinned.retiredAt) {
  fail(`keyId "${pinned.keyId}" was retired on ${pinned.retiredAt} and must not sign a new catalogue`);
}

let ok;
try {
  // algorithm must be null for Ed25519 — the curve fixes the hash internally
  ok = crypto.verify(null, registryBytes, crypto.createPublicKey(pinned.publicKey), Buffer.from(envelope.signature, "base64"));
} catch (error) {
  fail(`verification threw: ${error.message}`);
}
if (!ok) fail(`signature does not match the registry bytes (keyId ${pinned.keyId})`);

const registry = JSON.parse(registryBytes.toString("utf8"));
const ids = (registry.addons ?? []).map((a) => a.id);
console.log(`[verify-registry] OK — ${ids.length} addon(s) [${ids.join(", ")}] signed by keyId ${pinned.keyId}`);
