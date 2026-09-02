# Addon adjudication

A process for assessing a community-contributed addon before it merges into
`mosaic-addons`. The goal is to let **scripts make every decision a script can**
(deterministic, repeatable, no judgment) and reserve a human/LLM for the small
set of questions that genuinely need judgment — then, only after both pass, an
isolated runtime test.

The reviewable unit is a **patch** (`git format-patch` / a gist patch / a
branch diff), not a live merge. Never follow a contributor's "add my remote and
`git merge --no-ff && git push`" instructions — that lands unreviewed code and
skips everything below. Ask for, or produce, a patch and run it through this.

## The three tiers

```
Stages 0–5 + 4b   DETERMINISTIC   adjudicate.mjs → PASS / REVIEW / BLOCK
Stage 6           JUDGMENT        a human/LLM reads only the flagged sites
Stage 7           RUNTIME         isolated build + install, testnet only
```

`adjudicate.mjs` prints two blocks: **HARD GATES** (any failure ⇒ `BLOCK`, exit
1) and a **JUDGMENT QUEUE** (file:line hits that a person must rule on; never
affects the exit code). The queue *is* the agenda for Stage 6 — nothing more.

### Deterministic stages (scripted)

| Stage | Gate | Fails when |
|-------|------|-----------|
| 0 | Provenance | not a single logical commit; `--expect-commit` mismatch |
| 1 | Scope containment | any path outside one `addons/<id>/`; touches registry/sig/CI/tooling; exec bit / symlink / submodule |
| 2 | Applies | `git apply --check` fails on the base checkout |
| 3 | Manifest conformance | mirrors the app's `validateManifest` policy subset: bad id/version/namespace, or a permission that is unknown or **reserved** (`wallet:sign`, `vault:*`, …) |
| 4 | Supply chain | **any `scripts` key in the addon's own `package.json` that is not on the allowlist** — `ALLOWED_ADDON_SCRIPTS` in `policy.mjs`, currently build, dev, test, lint, typecheck, format, clean, watch, preview; any dependency specifier that is not a plain registry range — git and tarball URLs, local and workspace paths, `github:`, bare `user/repo`, and `npm:` aliases |
| 4b | Build reproducibility | convention-aware: if `renderer/` is gitignored build output (the mosaic-addons model), an absent bundle is correct and this instead flags that a sandboxed build (Stage 7) is required; it only *fails* when the repo tracks bundles and `src/` changed without a matching bundle update |
| 5 | Capability scan | never fails — emits the judgment queue |

> **Stage 4 is an allowlist, and must stay one.** npm chooses which script
> names it runs by itself, and for any script `X` it also runs `preX` and
> `postX`. A denylist of dangerous names is a list of a set npm controls, where
> anything unlisted is safe by default. That failed exactly as you would expect:
> the previous denylist named `prepare` but not `preprepare`/`postprepare`, both
> of which execute on a plain `npm install` — so a submission carrying one got
> `VERDICT: PASS`. **Do not "fix" a future gap by adding a name to
> `INSTALL_LIFECYCLE_SCRIPTS`**; that list is now only used to word the
> rejection message. Add to `ALLOWED_ADDON_SCRIPTS`, deliberately, when a
> submission gives a reason.

### Stage 6 — judgment (human/LLM)

Read *only* the queued sites and the `⚑ ELEVATED` notes and rule on intent:
is native exec / network egress / a `main` module appropriate for what this
addon claims to do? Does it re-introduce a withheld capability (e.g. `wallet:sign`
via a browser-extension bridge) through a side channel? Produce
approve / approve-with-changes / reject with specific asks.

### Stage 7 — runtime (only after 0–6 pass)

Build the tarball from the reviewed source in an isolated environment, install
it into a throwaway app profile, activate, exercise. Two properties matter and
both are deliberate:

- **The bundle that ships is built here, from reviewed source.** A submission's
  own prebuilt `renderer/` output is never accepted or published.
- **Testnet keys only for anything touching a wallet.** Never a funded mainnet
  key, on any host, at any stage.

The runbook and the provisioning scripts are operational and are held with the
rest of the release tooling, not in this repository.

## Usage

```sh
node scripts/adjudicate/adjudicate.mjs \
  --patch <file.patch> \
  [--repo <mosaic-addons checkout>]      # default: this repo
  [--expect-commit <sha>]                # assert the patch's From-hash
  [--app-src <mosaic-companion checkout>]# cross-check the mirrored vocabulary
  [--json]                               # append a machine-readable report
```

Getting the patch from a gist: `gh api gists/<id> --jq '.files["<name>.patch"].content' > x.patch`.

## Keeping policy in sync

`policy.mjs` mirrors the **source of truth** in
`mosaic-companion/electron/addons/manifest.ts` (`PERMISSION_VOCABULARY`,
`RESERVED_PERMISSIONS`, `RESERVED_IPC_NAMESPACES`, `MAIN_ENTRY_ALLOWLIST`). Pass `--app-src` to diff the
mirror against the app and fail on drift.

The drift check covers the vocabularies it can read as arrays. It is a guard
against the mirror going quietly stale, not a substitute for updating both
sides when the app's policy changes.

## What the deterministic stages are, and are not

Worth being plain about, because the failure mode of a tool like this is a
reviewer reading a green result as an assurance it was never able to give.

- **The hard gates are structural.** They answer questions with definite
  answers: does this patch stay inside one addon, does the manifest conform,
  does it declare a dependency that cannot be reviewed, does it add an
  executable bit. A `PASS` means those specific questions came back clean.
- **The judgment queue is an agenda, not a proof of absence.** Stage 5 flags
  patterns worth a human's attention. An empty queue means nothing matched the
  patterns — never that the patch is safe. Do not treat a short queue as a
  reason to look less carefully; the queue exists to make sure the obvious is
  not missed, not to bound what a reviewer reads.
- **Stage 6 is where a submission is actually judged.** Stages 0–5 exist to
  make that judgment cheap and well-aimed, not to replace it.
- **Stage 4b does not run the build.** It reasons about whether the src/bundle
  relationship is coherent. The build itself happens in Stage 7.
- **Stage 7 is manual.**

The pipeline's own limitations are tracked with the release tooling rather than
listed here, and are reviewed when the process changes.
