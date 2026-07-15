#!/usr/bin/env node
/**
 * Signs `addon-registry.json` with an Ed25519 private key, writing the
 * `{ keyId, signature }` envelope to `addon-registry.json.sig` (§6.7).
 *
 * This is what the real `mosaic-addons` release CI runs, reading the
 * private key only from `secrets.ADDON_SIGNING_KEY_<keyId>` (see
 * `.github/workflows/release.yml`) — never generating key material itself.
 * For local/dev use, point `--key` at a JSON file shaped like
 * `fixtures/test-signing-key.json` (`{ keyId, privateKeyPem }`).
 *
 * Usage: node scripts/sign-registry.mjs --key <key.json> --registry <path>
 */
import fs from "fs";
import crypto from "crypto";

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const keyPath = argValue("--key");
const registryPath = argValue("--registry");
if (!keyPath || !registryPath) {
  console.error("Usage: node scripts/sign-registry.mjs --key <key.json> --registry <addon-registry.json>");
  process.exit(1);
}

const { keyId, privateKeyPem } = JSON.parse(fs.readFileSync(keyPath, "utf8"));
if (!keyId || !privateKeyPem) {
  console.error(`Key file ${keyPath} must contain { keyId, privateKeyPem }`);
  process.exit(1);
}

const registryBytes = fs.readFileSync(registryPath); // sign raw bytes, not a re-serialized copy
const privateKey = crypto.createPrivateKey(privateKeyPem);
const signature = crypto.sign(null, registryBytes, privateKey).toString("base64");

const sigPath = `${registryPath}.sig`;
fs.writeFileSync(sigPath, JSON.stringify({ keyId, signature }));
console.log(`[sign-registry] Wrote ${sigPath} (keyId ${keyId})`);
