# mosaic-addons

Addon monorepo for [Mosaic Companion](https://github.com/hypercycle-development/mosaic-companion)'s
manifest-driven addon system. Each directory under `addons/` is one addon:
a `manifest.json`, an optional main-process module, and a self-contained
compiled web bundle. Releases are distributed as signed, tarballed GitHub
Releases listed in `addon-registry.json` — see §6.7 of the internal addon
design document `tab-plugin-architecture-design.md` (HyperCycle-internal,
not published) for the full design (registry format, signing, install
pipeline).

---

## ⚠️ GO-LIVE TODO — read this before treating anything here as production

**The catalogue is not live yet.** The build/sign/verify pipeline works, the
production signing key exists (`b7efa29a`, generated 2026-08-21 under the
offline ceremony) and is pinned on both sides, but the following still require
a human before any real user's MosAIc Companion can install an addon from here.
The full procedure, including withdrawal, rotation and compromise handling, is
in `docs/signing-procedure.md`.

1. **Add the CI settings.** Create a GitHub **Environment** named
   `release-signing` with required-reviewer protection, and scope both to it:
   the secret `ADDON_SIGNING_KEY` (the private key PEM) and the *variable*
   `ADDON_SIGNING_KEY_ID` (its keyId — the workflow reads it as `vars.`, a
   different namespace from `secrets.`, so entering it as a secret leaves the
   job failing its own guard with the value sitting right there).
   `.github/workflows/release.yml` already names the Environment on its job.
   Use the web UI, not `gh secret set`, which would put the private key in
   shell history.
2. **Ship a `mosaic-companion` release carrying the pinned key** — *before*
   the first catalogue is published. Publishing first means existing users
   fetch a registry signed by a key they do not yet trust.
3. **Make this repository public.** GitHub serves release assets of a private
   repo only to authenticated callers, and the app deliberately carries no
   credential for the catalogue — so while this repo is private, a correctly
   signed catalogue at a correct URL is still unreachable. It fails exactly as a
   missing one does.
4. **Cut the first catalogue release**: `git tag catalogue-v1 && git push origin
   catalogue-v1`, then confirm from a **packaged** build. An unpackaged build
   also trusts whatever `MOSAIC_DEV_PUBLISHER_KEYS` supplies at runtime, so it
   proves less about what a real user sees.

**Already done, and not to be repeated:** the key ceremony (step 2 of the
previous version of this list) was performed on 2026-08-21. Nothing in this
repo — or in its CI — generates key material, or should ever be given the
ability to; CI only ever *uses* a key that already exists. The ceremony is held
separately and deliberately not published here. The public half is pinned in
`publisher-keys.json` here and in `PRODUCTION_PUBLISHER_KEYS` in
`mosaic-companion`'s `electron/addons/signing.ts`; **those two must agree
byte for byte**, or every installed app fails closed saying only "no catalogue
is published yet". `scripts/verify-registry.mjs` catches that in CI instead.

**Withdrawal exists** (built 2026-08-21). Removing an entry from the registry
*delists* it — it stops new installs and nothing else. To act on an addon that
is already installed, add an entry to `withdrawn.json`: `security` deactivates
it in place and refuses re-activation, `advisory` leaves it running. Withdrawal
is carried by the same signed registry and gated on a strictly increasing
`sequence`, so an attacker cannot erase one by replaying an older release. See
`docs/signing-procedure.md` §0 for the procedure, including how a withdrawal is
lifted.

Until the catalogue is live, an addon can be tried through MosAIc's dev-install
path (`addons:install-dev`, a local directory), or against a locally built and
locally signed registry — see "Building + signing a full registry locally"
below, which needs a test key you generate yourself and keep outside every
working tree.

### Release model: one tag series, whole-catalogue releases

The unit of release is the **catalogue**, not an addon. `catalogue-v*` tags
build every addon under `addons/`, assemble one `addon-registry.json` covering
all of them, sign it, verify it, and upload it together with every tarball it
references.

This replaced a per-addon tag scheme (`stargate-v1.0.0`) that built only the
tagged addon. Because `build-registry.mjs` skips any addon with no built
tarball, that scheme published a registry containing exactly one addon and
silently delisted every other — so releasing Stargate would have removed
HyperInsight from every user's catalogue, and vice versa. `--require-all` now
makes that a hard build failure rather than a warning.

---

## Key material is never committed here

**No private key belongs in this repository, in any form — test keys included.**
A private key in a repo is a private key on the internet the moment that repo is
public, and git history keeps it there afterwards. A test key committed "just
for CI" is indistinguishable, to anyone who finds it, from a real one.

This repo previously carried `fixtures/test-signing-key.json` with its private
half. It was removed on 2026-08-21, before the repo went public, and
`.gitignore` now blocks the shape of it.

`publisher-keys.json` holds **public** halves only, and is currently empty —
which is the correct fail-closed state until the production key exists.
`scripts/verify-registry.mjs` refuses to pass anything while it is empty.

### Testing the sign/verify path locally

Generate a test keypair with the **same offline ceremony as production** (held
outside this repo — maintainers know where), keep both halves outside any
working tree, and point the tooling at them:

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

## Layout

```
mosaic-addons/
  addons/                      — every addon that exists here, published or not
    hyperinsight/              — HyperInsight (manifest, main, renderer source + build)
    stargate/                  — Stargate; present but NOT in the publish set
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
cd addons/<stargate|hyperinsight>
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
