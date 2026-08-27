# Contributing

There are two quite different things you might be contributing: an **add-on**,
or a change to the **catalogue tooling**. They are reviewed differently.

## Before anything else

- Read [LICENSING.md](./LICENSING.md). You keep your copyright; there is no CLA.
- Every commit needs a `Signed-off-by` line — `git commit -s`. That is the
  [Developer Certificate of Origin](https://developercertificate.org/):
  an assertion that you have the right to submit the work.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) applies here.

## Contributing an add-on

Submit a pull request adding `addons/<your-id>/`. It must contain:

- `manifest.json` — id, name, description, and the permissions you actually
  need. Ask for the minimum; every permission is a thing a reviewer has to
  justify to users.
- `LICENSE` — your licence, your copyright. See
  [LICENSING.md](./LICENSING.md) for which are accepted.
- Your source. Everything the add-on does should be readable in the diff.

**The reviewable unit is the patch.** Submissions are assessed from the diff,
not from a running build, and are built and installed in isolation before
anything is published.

Some things a submission cannot currently do, and why:

- **Main-process code** (`main.entry`) runs unsandboxed and outside the
  permission model, so it is restricted to an allowlist. A new add-on will not
  be granted it.
- **Dependencies** must resolve to the public npm registry as a plain version
  range. A `user/repo` shorthand resolves to a mutable branch tarball, and an
  `npm:` alias installs something other than what it names — both defeat
  reviewing the source you submitted, and both are rejected. Note what this
  does *not* check: a range is accepted as-is, so pinning comes from your
  committed lockfile rather than from a gate.
- **Everything must stay inside `addons/<your-id>/`.**

A clean automated result means nothing matched the patterns that are checked.
It does not mean a submission is safe, and a human decides.

## Contributing to the catalogue tooling

Normal pull request. For anything beyond an obvious fix, open an issue first
and let it be discussed before you build — this repository publishes signed,
executable code to users, and a change to how that works deserves agreement on
the approach before there is a diff to argue about.

Say what you tested. There is no test suite here yet; the honest substitute is
describing what you exercised and what you did not.

## Reporting a vulnerability

Not here. See [SECURITY.md](./SECURITY.md) — privately, through GitHub advisories.
