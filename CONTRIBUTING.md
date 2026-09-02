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

> **Check that `git add` actually took your `renderer/` files.** This
> repository git-ignores `addons/*/renderer/`, because for an add-on built from
> a `src/` directory that path is build output produced by the release pipeline.
> If your add-on has **no build step** and you hand-wrote `renderer/index.html`,
> `git add addons/<your-id>/` will skip it without saying anything, and you will
> open a pull request containing a manifest and a licence and no add-on. Run
> `git status --ignored addons/<your-id>/` before you push, and if your renderer
> is source rather than output, force it in with
> `git add -f addons/<your-id>/renderer/` and say so in the pull request.

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
- **Your `package.json` may only declare script names from a fixed list.**
  Currently: `build`, `dev`, `test`, `lint`, `typecheck`, `format`, `clean`,
  `watch`, `preview`. **Anything else is rejected outright**, including names
  that look harmless.

  This is an allowlist rather than a list of banned names, and deliberately so.
  npm decides for itself which script names it executes when dependencies are
  installed — nobody has to run them — and for any script `X` it also runs
  `preX` and `postX`. That set belongs to npm and it has grown before, so a list
  of forbidden names is a list that a new name walks straight past. Publication
  runs exactly one script from your add-on, `build`, so permitting a short set
  of ordinary developer names costs you nothing.

  **This governs script *names*, not what they do.** Your `build` command is
  still arbitrary, still runs when we package your add-on, and is still read by
  a person. Nothing here replaces that reading.

  If you genuinely need a name that is not on the list, say why in the pull
  request. The list grows on purpose, not by accident.
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
tooling paths, build reproducibility, and full manifest conformance —
`manifestVersion`, the id pattern and that `id` equals the directory name,
semver, field lengths, `mountPoint`, `renderer.entry`, a reserved
`ipcNamespace`, and any unknown or **reserved** permission. A submission asking
for `wallet:sign` is blocked here.

The reproducibility gate is the one that surprises people, because it depends on
which build model your add-on uses. `addons/*/renderer/` is git-ignored in this
repository, so for an add-on with a `src/` directory the bundle is **build
output** — the release pipeline runs your `npm run build` — and it is correctly
absent from your patch. If instead your add-on tracks its bundle, changing `src/`
without regenerating `renderer/` fails the gate, because the artifact that would
ship no longer matches the source that was reviewed.

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
