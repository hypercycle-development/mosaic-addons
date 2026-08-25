# Add-on catalogue: signing and withdrawal procedure

How a release of `addon-registry.json` is signed, how an add-on is withdrawn
after it has shipped, and how the signing key is rotated or retired.

Numbering is stable and referenced from `README.md` — §0 is withdrawal.

---

## 0. Withdrawal

Delisting an add-on — removing it from the registry — stops new installs and
nothing else. **Withdrawal** is the mechanism that reaches an add-on already
installed on someone's machine: `security` deactivates it in place and refuses
re-activation, `advisory` leaves it running and is a notice rather than a
sanction.

Two flaws in the first design of this were caught in review and fixed before it
shipped. Both are recorded here because both are easy to reintroduce.

**Flaw 1 — rollback replay.** The first design signed the withdrawal notice and
stopped there. But a signature proves *who* wrote a registry, never *when*:
every registry ever signed verifies forever. An attacker who controls what the
app fetches — network position, a compromised host, a stale edge — serves the
*previous*, still validly-signed registry, and the withdrawal silently
vanishes. No invalid signature anywhere. A revocation mechanism defeated by a
replay fails at its only job.

**Flaw 2 — no lift path.** The first design persisted a withdrawal "on first
receipt, never re-derived", which made every withdrawal permanent per client.
An erroneous withdrawal, or an add-on fixed and re-listed, could never be
undone remotely. That pressures an operator into never using the mechanism,
which is the worst way for a safety feature to fail.

Both are fixed by the same thing: a monotonic `sequence`.

### How it works

- Every registry carries `sequence`, strictly increasing per publish, derived
  in CI from the `catalogue-vN` tag ordinal.
- The app persists the highest sequence it has ever *verified* and **rejects
  anything lower**. Equal is fine (a re-fetch of the same release).
- Past that gate, the registry's `withdrawn` array **replaces** the persisted
  set rather than merging into it. So omitting an entry lifts it — and an older
  registry cannot forge a lift, because it never gets past the gate.
- Withdrawals are enforced in **`activateAddon`**, from persisted state, before
  any add-on code is imported. This is the load-bearing check: `initAddons()`
  activates at startup long before any fetch completes, so enforcement that
  depended on the fetch would let a withdrawn add-on run at every launch — and
  an attacker who blocks the fetch could keep it running forever.
- `beginInstall`, `confirmInstall` and `upgradeAddon` are guarded too, because
  the catalogue cache can be a whole session stale.
- `severity: "security"` refuses activation and deactivates a running add-on;
  `advisory` warns only. An absent or unrecognised severity reads as
  **security** — a typo must never downgrade enforcement.
- Dev installs are exempt, deliberately: blocking them would stop the add-on's
  author from loading it to fix it, while stopping no attacker.

### Losing an add-on: three different things, deliberately separated

The governing principle: *a user should not automatically lose an add-on that
is removed, unless it was removed for security reasons.* The design separates
these, but the distinction is easy to lose, so:

| Action | Publisher does | Effect on someone who already has it |
|---|---|---|
| **Delist** | remove the id from `catalogue.json` | **Nothing.** It keeps working, keeps its permissions, keeps updating within what it has. It simply stops being offered for new installs. |
| **Withdraw, `advisory`** | `withdrawn.json` entry, `severity: "advisory"` | Keeps working, and **the user is not currently told**: as of app v0.1.12 an advisory withdrawal is recorded and enforced-as-nothing, with no surface in Settings → Add-ons. Treat it as a publisher-side marker, not as a way to reach a user. |
| **Withdraw, `security`** | `withdrawn.json` entry, `severity: "security"` | Deactivated, refused activation until lifted, and shown in Settings → Add-ons as "Withdrawn by the catalogue publisher: &lt;reason&gt;". |

So the default path for retiring an add-on — taking it out of the publish set —
takes nothing away from anyone. Only an explicit `security` withdrawal does,
and `build-registry.mjs` **requires** `severity` and `reason` to be written out
in full rather than defaulting them: disabling a working add-on for every user
has to be something a person deliberately typed.

(The *app* still defaults an absent severity to `security` when reading a
registry. That is deliberate and not in tension: defensively, a truncated or
tampered field must never downgrade enforcement. The publisher-side requirement
is what stops that default ever being reached by accident.)

**Still open, and not settled by this implementation:**

1. **Should `security` really be the only auto-disabling severity, and is a
   binary enough?** A vulnerability that needs the user to act is different
   from a publisher key compromise, and both are currently `security`. A third
   level, or a "disable on next launch rather than immediately", may fit better.
2. **Who is the audience for the reason string?** Currently one free-text
   field, capped at 300 characters, shown against the add-on in Settings for a
   `security` withdrawal and nowhere at all for an `advisory` one. If
   withdrawals are ever routine, that wants structure (a link, a fixed-version
   pointer) rather than prose — and an advisory surface to show it on.

Neither blocks the first release, because the first catalogue withdraws nothing.

### Withdrawing something

Edit `withdrawn.json` in `mosaic-addons`, remove the add-on from `addons/`,
bump the tag, publish:

```jsonc
[
  {
    "id": "example-addon",
    "versions": "*",                       // semver range; "*" for security
    "reason": "Publisher key compromised.",
    "severity": "security",                // or "advisory"
    "withdrawnAt": "2026-08-21T08:30:00Z"
  }
]
```

`build-registry.mjs` refuses to publish a registry that both lists and
withdraws the same id. To lift: remove the entry, bump the sequence, publish.

Client latency: up to 6 hours for a running app, next launch otherwise.

### Verified

`npm run test:addons` — 24 unit checks — plus a 17-check integration run over
real signed registries from the actual publish pipeline. Between them they
cover: replay rejected; the withdrawal surviving a replay; the lift working;
a post-lift replay failing to re-withdraw; dev installs exempt; severity never
downgrading; and a malformed semver range failing **closed**.

That last one was a real bug the tests caught: `semver.satisfies` returns
`false` for malformed input rather than throwing, so the original `try/catch`
never fired and a publisher's typo would have silently **un**-withdrawn the
add-on. It now validates the range and version explicitly.

### Residual risks — accepted, and why

From the review, unchanged by the implementation:

1. **Any local process running as the user** can delete the persisted
   withdrawal. It can also flip `activated`, rewrite `grantedPermissions`, or
   replace the add-on's code on disk — so this is not a regression, and no
   catalogue-side mechanism can fix it.
2. **A hostile main-entry add-on can resist**, because main-entry code runs
   unsandboxed in the main process and could undo its own withdrawal. Bounded
   today only because `MAIN_ENTRY_ALLOWLIST` is `["hyperinsight"]` —
   first-party. **This residual is acceptable only while that stays true**, which
   ties directly to #105.
3. **Indefinite fetch-blocking** stops *new* withdrawal news. Persisted ones
   keep being enforced; the app warns after 7 days rather than disabling, since
   bricking a legitimately offline user is disproportionate.
4. **Trust on first use**: a brand-new profile has no high-water mark and
   accepts the first validly-signed registry it sees, including a
   pre-withdrawal one. The window closes at the next fetch. Compiling a floor
   sequence into each app release would close it; deferred.
5. **Signing-key compromise** — the key that withdraws can also rescind
   withdrawals and list malware, and the key itself is revocable only by an app
   update. This rests entirely on the offline custody in §2.
6. In-flight operations are not cancelled by deactivation, including a pending
   payment-approval modal.

**Withdrawal is a remediation channel, not a containment boundary.** It
reliably stops renderer-only add-ons and non-resisting code; a genuinely
hostile main-entry add-on needs an app update.

### The conditions this rests on, and the one that was not met

Security review judged this design sufficient to operate a low-usage catalogue
carrying add-ons that can move funds — conditional on six things, one of which
**was not true at the time**:

> (c) the payment path retains its per-transaction user-approval modal … any
> move to auto-approval or approval-free thresholds voids this verdict

`plugins/aim-nodes/main/index.js` carried a `requireConfirmation` toggle that
auto-approves with **no modal at all** — and add-ons inherited it, so a user who
switched it off for their own agent work also switched it off for every
installed add-on.

Fixed in two parts:

- **Add-on-originated payments always prompt**, whatever the toggle says. That
  setting is consent for the user's own actions, not standing authorisation for
  third-party code.
- **The modal now names the requester.** `ApprovalRequest` gained
  `requestedBy`, set main-side from the dispatcher's verified add-on id and not
  settable by any renderer. It renders as "Add-on: `<id>`" or "This app".
  Previously a user approving a real USDC transfer could not tell their own
  chat session from a third-party add-on — the single most decision-relevant
  fact in the approval.

The other five conditions hold: the sequence check ships with the mechanism,
enforcement is in `activateAddon`, `MAIN_ENTRY_ALLOWLIST` is first-party,
custody is §2, and this ships before the first production key.

## 1. What the pipeline does

One tag series, `catalogue-v*`. The unit of release is the whole catalogue, not
one add-on.

```
tag catalogue-vN
  └─ build every addon under addons/        → <id>-<version>.tgz + .sha256
  └─ build-registry.mjs --require-all       → addon-registry.json
  └─ sign-registry.mjs                      → addon-registry.json.sig
  └─ verify-registry.mjs                    → fails the build if it won't verify
  └─ upload all of the above to the release
```

The app fetches
`https://github.com/hypercycle-development/mosaic-addons/releases/latest/download/addon-registry.json`
and its `.sig`, verifies the signature against a key pinned in
`electron/addons/signing.ts`, and only then trusts a single word of it
(`installer.ts:100-165`).

Every tarball the registry names is uploaded to the **same** release, so a
catalogue can never reference an asset that was not published with it.

---

## 2. The key ceremony — held separately

The production key is generated by a maintainer **by hand, offline, once**, and
the runbook for doing so is not published here. That is deliberate: it has no
audience among people building add-ons or auditing this pipeline, and #103
records the same position — *"how signing material is managed is decided by the
repository admins; the arrangements themselves are not described here."*

What matters to everyone else, and is guaranteed here:

- **Nothing in this repository, or in its CI, generates key material** — or
  should ever be given the ability to. CI only ever *uses* a key that already
  exists (§3).
- The private half is written outside every working tree, at mode `0600`, and
  never reaches stdout, a transcript, or a log.
- The public half is pinned in two places that must agree byte for byte (§4).
- Test keys are generated by the **same** ceremony and are subject to the same
  rule (§2a).

Maintainers know where the runbook is held.

## 2a. Key material is never committed — including test keys

Settled 2026-08-21. **No private key goes into any repository, in any form.**

A private key in a repo is a private key on the internet the moment that repo is
public, and git history keeps it there afterwards. A test key is
indistinguishable from a real one to whoever finds it; "it's only for CI" is not
visible from the outside.

Two committed test keys were removed that day:

| Was | Repo | Status |
|---|---|---|
| `fixtures/test-signing-key.json` | `mosaic-addons` | Removed **before** the repo went public — disclosure prevented. |
| `tests/addons/fixtures/test-signing-key.json` | `mosaic-companion` | Had been in **public** history since #96. Removed, but **treat that key as permanently compromised** — deletion does not unpublish it. |

Neither was used by any running code; only their public halves were pinned, in
`DEV_ONLY_PUBLISHER_KEYS`. That array is gone too, along with
`generate-test-signing-key.cjs`. `.gitignore` in both repos now blocks the shape
of key files, and `publisher-keys.json` is empty — the correct fail-closed state
until the production key exists.

**Test keys are generated by the same offline ceremony as production** (§2) and
kept outside every working tree. Nothing autogenerates key material inside a
repo.

### How a dev build trusts a test key now

`electron/addons/signing.ts` pins no dev key. An **unpackaged** build reads
public halves at runtime from a file named by `MOSAIC_DEV_PUBLISHER_KEYS`:

```bash
MOSAIC_DEV_PUBLISHER_KEYS=/path/outside/any/repo/pins.json npm start
```

`devPublisherKeys()` refuses the entire file if any entry carries private key
material, and a packaged build ignores the variable completely — so a stray
environment variable on a user's machine can never widen what a shipped app
trusts.

Verified end to end 2026-08-21 with an ephemeral key, since destroyed:

| Check | Result |
|---|---|
| ceremony key signs a catalogue; `verify-registry` accepts it | pass |
| same catalogue against the repo's empty `publisher-keys.json` | **refuses** — fails closed |
| dev build trusts the runtime pins and verifies | pass |
| **packaged build trusts nothing and rejects the same registry** | pass — "Unrecognized signing key" |
| pin file containing private key material | **whole file refused** |
| any key material written inside a repo | none |

## 3. Configuring CI

Two repository settings, both on `mosaic-addons`:

| Kind | Name | Value |
|---|---|---|
| Secret | `ADDON_SIGNING_KEY` | the Ed25519 private key, PEM |
| Variable | `ADDON_SIGNING_KEY_ID` | the `keyId` from §2 |

The key id is a variable rather than a secret deliberately — it is public, and
keeping it out of the secret store means a rotation is a visible diff.

Scope both to a GitHub **Environment** named `release-signing` with
required-reviewer protection. `release.yml` already names that Environment on
its `build-and-sign` job, so a release cannot be signed from an arbitrary
branch or pull request and pauses for an approval before the key is exposed.
(`environment` is a job-level key; an earlier draft had it commented out at the
top of the file, where it would have been rejected as an invalid workflow.)

If either setting is missing the workflow **fails at the signing step** rather
than publishing something unsigned.

> An earlier scheme named the secret `ADDON_SIGNING_KEY_<keyId>`, one per key.
> That cannot be read from a workflow at all: GitHub Actions has no way to
> index `secrets` by a computed name, and the workflow worked around it with a
> literal `ADDON_SIGNING_KEY_PLACEHOLDER` that would never have matched a real
> secret. One fixed name, plus the rotation procedure in §6, replaces it.

## 4. Pinning the public key — two places, and they must agree

| File | Repo | Role |
|---|---|---|
| `publisher-keys.json` | `mosaic-addons` | what CI verifies against before publishing |
| `PRODUCTION_PUBLISHER_KEYS` in `electron/addons/signing.ts` | `mosaic-companion` | what installed apps trust |

Add the new key to **both**, as its own dated entry with `retiredAt: null`.

If they disagree — CI signs with a key the app does not trust — every installed
app fails closed, reports "no catalogue is published yet", and logs nothing that
explains why. `verify-registry.mjs` exists to turn that silent, user-visible
failure into a loud CI one. It is the single most valuable guard in the
pipeline, because the failure it catches is otherwise invisible from the
publishing side.

**A pin only takes effect for users who install a build containing it**, which
fixes the order: pin in the app → ship an app release carrying it → *then*
publish the catalogue.
Publishing the catalogue first means every existing user fetches a registry
signed by a key they do not trust.

---

## 5. Cutting a catalogue release

1. Confirm every add-on's `manifest.json` carries the version you intend to
   publish. The registry takes its versions from the manifests.
2. `git tag catalogue-vN && git push origin catalogue-vN`.
3. Watch the run. It fails, by design, if any add-on is missing a tarball
   (`--require-all`), if the signing key or id is unset, or if the signed
   registry does not verify against `publisher-keys.json`.
4. Confirm the release carries `addon-registry.json`, `addon-registry.json.sig`,
   and one `.tgz` + `.sha256` per add-on.
5. Verify from a packaged build — not a dev build. An unpackaged build also
   trusts whatever `MOSAIC_DEV_PUBLISHER_KEYS` names (§2a), so a dev build
   proves nothing about what a user sees.

To rehearse the whole thing locally first, generate a **test** key with the same
ceremony (§2), keep it outside every repo, and build the two small files the
tooling wants — `{ keyId, privateKeyPem }` to sign with, and a public-only pin
list to verify against:

```bash
KEY=<path outside any repo>
# generated by the offline ceremony script, which is held outside this repo (§2)

node scripts/build-addon.mjs hyperinsight --out release-build
node scripts/build-registry.mjs --require-all --out release-build \
  --sequence 1 --base-url "https://example.invalid/local-test"
node scripts/sign-registry.mjs   --key "$KEY.signer.json" \
  --registry release-build/addon-registry.json
node scripts/verify-registry.mjs --registry release-build/addon-registry.json \
  --keys "$KEY.pins.json"
```

Delete the key when done. **Never sign a real catalogue with a test key**, and
never write one inside a repo — see §2a.

---

## 6. Rotating the key

The pinned list is a list precisely so rotation is additive.

1. Generate the new key (§2).
2. Add it to **both** pin lists (§4) alongside the old one; leave the old one's
   `retiredAt` as `null` for now. Ship an app release containing both.
3. Once enough users are on that release, switch `ADDON_SIGNING_KEY` /
   `ADDON_SIGNING_KEY_ID` to the new key and publish a catalogue.
4. Only then set the old entry's `retiredAt`. `verify-registry.mjs` refuses to
   publish anything signed by a retired key.

Do not remove an old key from the app in the same release that adds the new one.
Users who skip a release would be left trusting nothing.

### If the private key is compromised

Rotation above assumes an orderly schedule. A compromise does not allow one:
anyone holding the key can sign a catalogue that every installed app trusts, and
`installer.ts` will happily install what it names. There is no revocation for
keys any more than for add-ons (§0). The only real response is an emergency app
release that drops the compromised key from `PRODUCTION_PUBLISHER_KEYS`, and
until users take it they remain exposed. **That is a strong argument for §0's
withdrawal work and for keeping the key offline and behind a protected
environment.**

---
