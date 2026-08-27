# Licensing

This repository is a **catalogue**, not a single program. Three different things
live here and they are licensed differently. If you only read one section, read
the table.

| What | Licence | Held by |
|---|---|---|
| The catalogue tooling — `scripts/`, `.github/`, `docs/`, the registry and signing machinery | Apache License 2.0, see [LICENSE](./LICENSE) | HyperCycle |
| Each add-on under `addons/<id>/` | Whatever that add-on's own `LICENSE` says | **Its author** |
| Add-ons distributed as signed artifacts without source here | Whatever the add-on declares | Its author |

## What this deliberately does not do

**It does not ask you to give up rights in your add-on.** You keep your
copyright. There is no CLA and no copyright assignment. Contributions are made
under the [Developer Certificate of Origin](https://developercertificate.org/) —
a `Signed-off-by` line asserting you have the right to submit what you are
submitting, and nothing more.

**It does not relicense your code.** `LICENSE` at the root covers this
repository's own tooling. It does not reach into `addons/<id>/`, and an add-on
carrying a different licence is not a conflict — it is the expected shape.

**It covers add-ons, not tooling.** Contributions to the catalogue tooling
itself — `scripts/`, `.github/`, `docs/` — are submitted under Apache-2.0,
matching this repository's own licence, unless a file clearly states otherwise.
That mirrors the companion repository.

**It does not require your source to live here.** The catalogue references
signed artifacts. Source in `addons/` is convenient for review, not a
structural requirement, and the licensing model is written so that add-ons
distributed without source in this repository remain possible.

## What you are not asked to grant

**Nothing beyond your licence.** Every licence accepted today already permits
building, packaging, distributing and ceasing to distribute your add-on — so
that is the basis on which the catalogue operates. There is no separate grant
to sign, and none is asked for, because none is needed.

Ceasing to distribute is worth naming, because it is the one that sounds like
it might need permission. Withdrawing an add-on is HyperCycle stopping its own
distribution and the application declining to run what it no longer trusts.
Neither requires a right from you.

This changes when closed-source add-ons are accepted, which is intended —
see below.

## Which licences are accepted

Today, any [OSI-approved licence](https://opensource.org/licenses). Declare it
in two places:

- a `LICENSE` file in `addons/<id>/`
- the `license` field of your `manifest.json`, as an
  [SPDX identifier](https://spdx.org/licenses/) (for example `MIT`,
  `Apache-2.0`, `GPL-3.0-only`)

> **Not yet enforced.** The manifest schema does not currently carry a `license`
> field, so this cannot be validated or required yet. Until it is, declare the
> licence in the `LICENSE` file and say so in your pull request. Tracked in
> mosaic-companion#138.

**Copyleft is unanalysed, and that includes your dependencies.** OSI approval
covers the GPL family, and the position has not been worked through:
distributing copyleft-derived code as a signed artifact carries
corresponding-source obligations, and copyleft interacts awkwardly with an
application that runs only signed code.

This is not only about the licence you choose. `build-addon.mjs` ships
`manifest.json`, `main/` and `renderer/`, and the renderer is produced by your
own build — so **a copyleft dependency ends up inlined in the bundle that gets
distributed**, whatever licence your own code carries. That is the likelier
case, and nothing currently checks for it.

Until the position is settled, expect a submission to be held rather than
refused if it is copyleft-licensed, or if it pulls in copyleft components.

Proprietary and closed-source add-ons are **not accepted yet**. That is a
sequencing decision, not a position: an open platform that only ever accepts
open source is not an open platform. The structure above is built to accept
them: nothing
here assumes an add-on is open source, or that its source is in this
repository. What that would require — **an actual submission agreement
granting distribution rights**, plus review, provenance and user-facing
disclosure — has not been decided.

The submission agreement is the load-bearing one. Every licence accepted today
already permits redistribution, so the grant described above is redundant: the
legal basis for building and distributing an add-on is its own licence. A
proprietary licence grants no such permission, so accepting one without an
agreement in place would leave nothing to distribute it under.

## Precedent

This is the shape package registries and app catalogues generally use: the
tooling is open source under the operator's licence, each published item
carries its author's licence, and the operator takes no ownership. Flathub and
the npm registry take a narrow distribution grant in their submission terms.
Homebrew takes none at all — it relies on each upstream licence's own
permissions, and where a licence forbids redistribution it sends users to the
vendor instead. That is closer to what this repository does today.

## What has to happen before this opens up further

Recorded here so the sequence is visible rather than rediscovered:

1. **A submission agreement**, for closed-source add-ons. Their licences grant
   no distribution right, so there would be nothing to publish under. This is
   the only genuinely new legal instrument the model needs.
2. **A decided copyleft position**, covering dependencies as well as add-on
   licences, and a gate that can see them. Nothing inspects dependency licences
   today.
3. **A `license` field in the manifest**, so the declaration is machine-readable
   and can be required — mosaic-companion#138.
4. **Whatever review a closed-source submission needs**, given the source would
   not be readable in the diff. The pipeline's whole design assumes it is.

Distribution mechanics are *not* on that list. The catalogue already publishes
built tarballs and references them from a signed registry; source in `addons/`
exists for review, not for distribution. A closed-source add-on would ship the
same way. The gap is legal and procedural, not plumbing.

## Status

**This is a starting point, not settled policy, and not legal advice.** It is
written to be defensible and to avoid foreclosing options — particularly around
closed-source add-ons and the eventual governance of this catalogue. It is
expected to be reviewed alongside the wider licensing and governance work.
