# Security Policy

This repository builds, signs and distributes executable add-ons that run inside
MosAIc Companion on users' machines. A compromise here reaches those users
directly, so reports are taken seriously and should be made privately.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request for a suspected
vulnerability.

Report through GitHub private vulnerability reporting at
<https://github.com/hypercycle-development/mosaic-addons/security/advisories/new>.
This is the only reporting channel.

Reports are received by the maintainers listed in
[MAINTAINERS.md](./MAINTAINERS.md) — currently
[@zephyrnova](https://github.com/zephyrnova), [@dxnn](https://github.com/dxnn)
and [@BarryJRowe](https://github.com/BarryJRowe).

## In scope

- The signing and verification chain — key handling, registry signing, the
  sequence guard that prevents replaying an older registry.
- The adjudication pipeline in `scripts/`, particularly any way to get a
  submission past a gate that should have stopped it.
- The release workflow, including anything that could publish an unsigned,
  wrongly-signed, or unreviewed catalogue.
- A published add-on behaving maliciously, or exceeding the permissions it
  declares.

## Out of scope here, but still worth reporting

Vulnerabilities in the MosAIc Companion application itself belong in
[that repository's security policy](https://github.com/hypercycle-development/mosaic-companion/security/advisories/new).
If you are unsure which applies, report it in either — it will be routed.

## Withdrawal

If a published add-on has to be stopped on users' machines, that is done by
adding it to `withdrawn.json` and publishing a new catalogue. Installed copies
stop running on the next catalogue sync, without needing an application update.
A withdrawal is a security action, not a delisting: removing an add-on from
`catalogue.json` only stops new installs.

## Known and accepted

- **Test signing key `78e2469a` is compromised.** It was committed to this
  repository while it was private, and although it has been removed from the
  history that is now published, the objects containing it were pushed and
  remain in GitHub's storage. No packaged build has ever trusted it. Never
  trust it, and never use it for anything.
