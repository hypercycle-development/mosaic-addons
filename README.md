# mosaic-addons

Addon monorepo for [Mosaic Companion](https://github.com/hypercycle-development/mosaic-companion)'s
manifest-driven addon system. Each directory under `addons/` is one addon:
a `manifest.json`, an optional main-process module, and a self-contained
compiled web bundle. Releases are distributed as signed, tarballed GitHub
Releases listed in `addon-registry.json` — see
`docs/admin/tab-plugin-architecture-design.md` §6.7 in `mosaic-companion`
for the full design (registry format, signing, install pipeline).

---

## ⚠️ GO-LIVE TODO — read this before treating anything here as production

**Nothing in this repo is live yet.** It is scaffolded and locally testable,
but the following steps still require a human, done by hand, before any real
user's Mosaic Companion can install an addon from here:

1. **Generate the real signing keypair.** Follow §6.7's custody procedure in
   `mosaic-companion`'s `docs/admin/tab-plugin-architecture-design.md`
   *exactly*: a maintainer runs the one-off generation script
   (`scripts/generate-signing-key.cjs` in this repo, or an equivalent
   `openssl`/`crypto` invocation) **by hand, offline, once**. Nothing in this
   repo's CI is capable of — or should ever be given the ability to —
   generate key material itself.
2. **Create the real `mosaic-addons` GitHub repository** (this local repo is
   not pushed anywhere yet — see the note below) under the
   `hypercycle-development` org, or wherever the maintainer decides.
3. **Add the private key as a GitHub Actions secret**, named
   `ADDON_SIGNING_KEY_<keyId>` (the `<keyId>` is printed by the generation
   script — first 8 hex chars of `sha256(publicKeyBytes)`), scoped to the
   release-signing job only. Put it behind a GitHub **Environment** with
   required-reviewer protection so the signing job can't be triggered from an
   arbitrary branch or PR.
4. **Back up the private key offline** (password manager item or a
   hardware-encrypted USB) — without a backup, losing the CI secret forces an
   unplanned rotation with no way to sign anything in the interim.
5. **Pin the real public key** into `mosaic-companion`'s
   `electron/addons/signing.ts` → `TRUSTED_PUBLISHER_KEYS`, as its own
   dated entry (`introducedAt` set to the real date/app-version). This is a
   **separate, later PR** against `mosaic-companion` — do not do this until
   steps 1–4 are actually done for real. The placeholder/test key currently
   checked into that array must stay clearly marked as dev/test-only, or be
   removed from production builds once the real key is in place (per §6.7,
   it may still stay in dev/test build config for continued local testing of
   the verify path).
6. **Push this repo** to its real remote once the above is in place, and
   confirm the `.github/workflows/release.yml` workflow (already scaffolded
   here, referencing `secrets.ADDON_SIGNING_KEY_<keyId>` by name — it just
   needs the real secret to exist) runs cleanly against a real release tag.

Until all of the above happens, `mosaic-companion` has **no real, working
registry to install from** — the only way to try any addon in this repo is
Mosaic's dev-install path (`addons:install-dev`, a local directory) or the
offline test-registry fixtures described below.

### This repo is currently local-only

Per explicit instruction during the Phase 6 build session, this repository
was created locally at `/Users/robert/Code/HyperCycle/HyperCycle/mosaic-addons`
and has **not** been pushed anywhere, and no real GitHub repo has been
created for it. Nothing here should be treated as reachable from the
internet. All verification against a "registry" during this phase used a
local, offline HTTP fixture server signed with the test key below — never a
real URL.

---

## Test-only signing key (NOT the production key)

`fixtures/test-signing-key.json` holds a keypair generated the same way the
real one will be (manual, offline, `scripts/generate-signing-key.cjs`), but
it exists **only** to exercise this repo's build/sign/verify pipeline in
development and CI. It is deliberately distinct from the *other* placeholder
key already checked into `mosaic-companion` itself
(`tests/addons/fixtures/test-signing-key.json`, used there to test the
app-side verify logic) — that one represents "the app's dev/test
verification key," this one represents "the mosaic-addons repo's test
signing key." Keeping them separate avoids a mixup between "what the app
trusts for local dev" and "what this repo's own test release pipeline
signs with."

**Never treat either test key as production, never reuse this key's
material to sign anything that ships to a real user.**

---

## Layout

```
mosaic-addons/
  addons/
    stargate/            — the Stargate addon (manifest, main, renderer source + build)
    hyperinsight/        — the HyperInsight addon (manifest, main, renderer source + build)
  scripts/
    generate-signing-key.cjs   — one-off key generation (test or real, same procedure)
    build-addon.mjs            — builds one addon's renderer, tars manifest+main+renderer
    build-registry.mjs         — assembles addon-registry.json from built addon tarballs
    sign-registry.mjs          — signs addon-registry.json -> addon-registry.json.sig
  fixtures/
    test-signing-key.json      — this repo's own test-only signing key (see above)
  .github/workflows/
    release.yml                — release-tag-triggered build + sign workflow
```

## Building an addon locally

```bash
cd addons/<stargate|hyperinsight>
npm install
npm run build          # produces addons/<id>/renderer/ (self-contained static bundle)
```

## Building + signing a full registry locally (test key)

```bash
node scripts/build-addon.mjs stargate
node scripts/build-addon.mjs hyperinsight
node scripts/build-registry.mjs --out release-build
node scripts/sign-registry.mjs --key fixtures/test-signing-key.json --registry release-build/addon-registry.json
```

`build-registry.mjs` picks up every addon under `addons/` that already has a
built tarball in `--out` — run `build-addon.mjs` for each addon you want
included first. This produces `release-build/addon-registry.json`,
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
