#!/usr/bin/env node
/**
 * ONE-OFF key generation script — Ed25519, Node's built-in `crypto` module,
 * no dependencies. This is the exact procedure a maintainer runs BY HAND,
 * OFFLINE, to generate the real `mosaic-addons` production signing key (see
 * §6.7 of mosaic-companion's docs/admin/tab-plugin-architecture-design.md
 * and this repo's README "GO-LIVE TODO").
 *
 * Running this script yourself right now produces a TEST key, not the
 * production one — nothing about running it makes a key "the real one";
 * that's a matter of custody (who holds the private key, where it's backed
 * up, whether it's ever loaded into the real release CI secret), not
 * mechanism. The output of this exact script IS what the real key generation
 * step looks like, at generation time.
 *
 * Run manually: node scripts/generate-signing-key.cjs
 * Prints { keyId, publicKeyPem, privateKeyPem } as JSON.
 */
const crypto = require("crypto");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// keyId = first 8 hex chars of sha256(raw public key bytes).
const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
const keyId = crypto.createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 8);

console.log(JSON.stringify({ keyId, publicKeyPem, privateKeyPem }, null, 2));
