# mosaic-addons Maintainers

This file records who is responsible for `mosaic-addons`. Everyone listed here
has agreed to be listed. Nobody is added without their consent.

This repository is part of the MosAIc project. Governance is described in
[GOVERNANCE.md](https://github.com/hypercycle-development/mosaic-companion/blob/main/GOVERNANCE.md)
in the `mosaic-companion` repository, and applies here too.

## Current maintainers

| Person | GitHub | Affiliation | Maintainer since |
| --- | --- | --- | --- |
| Robert Moir | [@zephyrnova](https://github.com/zephyrnova) | HyperCycle | August 2026 |
| Dann Toliver | [@dxnn](https://github.com/dxnn) | HyperCycle | August 2026 |
| Barry Rowe | [@BarryJRowe](https://github.com/BarryJRowe) | HyperCycle | August 2026 |

The date is the month consent was given and recorded.

All three maintainers are responsible for the whole repository. There is no
per-subsystem ownership and no reviewer tier.

All three receive private security reports and conduct reports.

## What this repository additionally requires

Publishing a catalogue is not the same as merging a pull request, and the
difference is deliberate:

- **A release is gated on a required reviewer.** The signing key sits behind a
  `release-signing` environment, so tagging `catalogue-v*` starts a run that
  waits for a maintainer to approve before anything is signed. Pushing the tag
  is not the point of no return; approving is.
- **A withdrawal deactivates an add-on on users' machines.** It is a security
  action taken on behalf of people who did not ask for it, and it should be
  taken by a maintainer who can say why in the `reason` field, because that
  text is shown to those users.

## What this list does not give you

- **Single-vendor.** All three maintainers are affiliated with HyperCycle. No
  single company holding every maintainer seat is a goal, not a description.
- **A third opinion is now possible, not guaranteed.** Three maintainers means
  a pull request from one can be reviewed by either of the others. Whether that
  routinely happens is a matter of practice, not structure.
- **Limited escalation.** A conduct or security report concerning one
  maintainer goes to the other two. A report concerning all three has no
  internal route.

## Access is not maintainership

Administrative access to this repository through the `hypercycle-development`
organisation is a fact about the organisation. This file records who is
responsible for the project. Where the two differ, this file is the one that
describes who will actually read your pull request.
