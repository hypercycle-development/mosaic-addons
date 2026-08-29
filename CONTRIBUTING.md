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

**[Build an extension](https://github.com/hypercycle-development/mosaic-companion/blob/main/docs/build-an-extension.md)**
in the application repository is the full guide — what an add-on is, the
manifest, permissions, and how to run one locally before you submit anything.
This page is the submission contract.

Submit a pull request adding `addons/<your-id>/`. It must contain:

- `manifest.json` — id, name, description, and the permissions you actually
  need. Ask for the minimum; every permission is a thing a reviewer has to
  justify to users.
- `LICENSE` — your licence, your copyright. See
  [LICENSING.md](./LICENSING.md) for which are accepted, and **say which licence
  you chose in the pull request**: the manifest has no `license` field yet, so
  the file and your description are the only record.
- Your source. Everything the add-on does should be readable in the files you
  add.

**We review the source you submit, not a build of it.** A submission is assessed
from the files in your pull request — the ones a reviewer can open and read —
and is then built and installed in isolation before anything is published. A
minified or obfuscated bundle cannot be reviewed, and will not be.

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
- **No install lifecycle scripts.** A `package.json` carrying `preinstall`,
  `install`, `postinstall`, `prepare`, `prepublish`, `prepublishOnly`,
  `preuninstall` or `postuninstall` runs arbitrary code the moment dependencies
  are installed. Rejected outright.
- **No symlinks and no submodules.** Neither can be reviewed by reading the
  files you submitted.
- **One logical commit.** A submission is reviewed as a whole, not as a history
  to reconstruct.

If you have a `package.json`, note what publication does with it: it runs
`npm install` and then **`npm run build`**, and packages only `manifest.json`,
`main/`, `renderer/`, `LICENSE` and `NOTICE`. So a `package.json` obliges a
working `build` script, and `node_modules` is not shipped — whatever your page
needs has to end up inside `renderer/`.

### Check it yourself first

`scripts/adjudicate/` runs the deterministic gates, and you can run it against
your own submission before opening the pull request. **It checks the patch by
applying it, so it has to run against a checkout that does not already contain
your commit** — point `--repo` at a clean worktree of `main`:

```sh
# from your branch, one commit containing your whole submission
git format-patch main..HEAD --stdout > mine.patch
git worktree add ../addons-base main
node scripts/adjudicate/adjudicate.mjs --patch mine.patch --repo ../addons-base
```

Run against your own checkout it will fail on "already exists in working
directory" and skip the manifest checks, which is the part most worth having.
If `git format-patch main..HEAD` gives you more than one commit, squash first —
one logical commit is a gate in its own right.

It reports `PASS` / `FAIL` per named gate and ends in a verdict. It covers more
than the list above: path traversal, executable bits, changes to signing or
tooling paths, and full manifest conformance — `manifestVersion`, the id pattern
and that `id` equals the directory name, semver, field lengths, `mountPoint`,
`renderer.entry`, a reserved `ipcNamespace`, and any unknown or **reserved**
permission. A submission asking for `wallet:sign` is blocked here.

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
