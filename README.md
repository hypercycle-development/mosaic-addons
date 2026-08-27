# mosaic-addons

Addon monorepo for [Mosaic Companion](https://github.com/hypercycle-development/mosaic-companion)'s
manifest-driven addon system. Each directory under `addons/` is one addon:
a `manifest.json`, an optional main-process module, and a self-contained
compiled web bundle. Add-ons are distributed as signed tarballs attached to a
GitHub Release and listed in a signed `addon-registry.json`. The registry
format, the signing and withdrawal procedure, and how the app verifies what it
installs are in [docs/signing-procedure.md](./docs/signing-procedure.md).

---

### Release model: one tag series, whole-catalogue releases

The unit of release is the **catalogue**, not an addon. `catalogue-v*` tags
build every addon under `addons/`, assemble one `addon-registry.json` covering
all of them, sign it, verify it, and upload it together with every tarball it
references.

This replaced a per-addon tag scheme (`<addon>-v1.0.0`) that built only the
tagged addon. Because `build-registry.mjs` skips any addon with no built
tarball, that scheme published a registry containing exactly one addon and
silently delisted every other — so releasing one add-on would have removed
HyperInsight from every user's catalogue, and vice versa. `--require-all` now
makes that a hard build failure rather than a warning.

---

## Key material is never committed here

**No private key belongs in this repository, in any form — test keys included.**
A private key in a repo is a private key on the internet the moment that repo is
public, and git history keeps it there afterwards. A test key committed "just
for CI" is indistinguishable, to anyone who finds it, from a real one.

This repo previously carried `fixtures/test-signing-key.json` with its private
half. It was deleted from the working tree on 2026-08-21 — but a deletion does
not remove a file from history, and it was only removed from history itself on
2026-08-26, before this repository was made public. Those objects had already
been pushed, so **treat keyId `78e2469a` as compromised**; no packaged build has
ever trusted it. `.gitignore` now blocks the shape of it. See
[SECURITY.md](./SECURITY.md).

`publisher-keys.json` holds **public** halves only.

### Testing the sign/verify path locally

Generate a throwaway keypair, keep both halves **outside any working tree**, and
point the tooling at them:

```bash
KEY=<path outside any repo>          # e.g. under $TMPDIR, or removable media

node scripts/build-addon.mjs hyperinsight --out release-build
node scripts/build-registry.mjs --require-all --out release-build --sequence 1 \
  --base-url "https://example.invalid/local-test"

# sign-registry wants { keyId, privateKeyPem }; build it from the ceremony output
node scripts/sign-registry.mjs --key "$KEY.signer.json" \
  --registry release-build/addon-registry.json

# verify against a pin list holding only the PUBLIC half
node scripts/verify-registry.mjs --registry release-build/addon-registry.json \
  --keys "$KEY.pins.json"
```

Delete both when you are done. To have a **dev build of the app** trust that key,
set `MOSAIC_DEV_PUBLISHER_KEYS` to the pin list — a packaged build ignores it
entirely, so it can never widen what a shipped app trusts.

How production keys are generated and held is a maintainer operation and is not
described here.

## Layout

```
mosaic-addons/
  addons/                      — every addon that exists here, published or not
    hyperinsight/              — HyperInsight (manifest, main, renderer source + build)
  catalogue.json               — the publish set. An addon ships because it is
                                 named here, never because it is in addons/
  withdrawn.json               — withdrawal notices; severity + reason required
  scripts/
    build-addon.mjs            — builds one addon's renderer, tars manifest+main+renderer
    build-registry.mjs         — assembles addon-registry.json from built addon tarballs
    sign-registry.mjs          — signs addon-registry.json -> addon-registry.json.sig
    verify-registry.mjs        — verifies a signed registry against publisher-keys.json
  publisher-keys.json          — PUBLIC publisher keys; must match the app's pinned list
  .github/workflows/
    release.yml                — catalogue-tag-triggered build + sign + verify workflow
```

## Building an addon locally

```bash
cd addons/<id>
npm install
npm run build          # produces addons/<id>/renderer/ (self-contained static bundle)
```

## Building + signing a full registry locally (test key)

See "Testing the sign/verify path locally" above — the signing key comes from
the offline ceremony and lives outside this repo, never in `fixtures/`.

`build-registry.mjs` picks up every addon under `addons/` that already has a
built tarball in `--out` — run `build-addon.mjs` for each addon you want
included first. `--require-all` turns a missing one into a hard error instead of
a warning, which is what release CI passes and what stops a partial catalogue
being published; drop it for a deliberately partial local build. This produces `release-build/addon-registry.json`,
`release-build/addon-registry.json.sig`, and one
`release-build/<id>-<version>.tgz` + its sha256 per addon — the same shape a
real GitHub Release would publish, servable from a local static file server
(or `file://`, for `mosaic-companion`'s dev-install/test-registry paths) for
fully offline testing.

`hyperinsight` additionally has its own `main/index.js` (§9.2) — it's the
only addon in this repo with main-process code, and `main/package.json`
(`{ "type": "module" }`) exists specifically so Node resolves it as ESM once
installed, since `build-addon.mjs` does not copy the addon's own root
`package.json` into the tarball.

## Licensing, contributing, security

This repository is a catalogue, not a single program, and the three things in it
are licensed differently — the tooling is Apache-2.0, each add-on carries its
author's own licence, and contributors keep their copyright. There is no CLA.

- **[LICENSING.md](./LICENSING.md)** — what is licensed how, what you grant, and
  which licences are accepted
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — submitting an add-on, and what the
  review gates check
- **[SECURITY.md](./SECURITY.md)** — reporting a vulnerability privately
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)**
