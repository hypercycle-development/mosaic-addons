#!/usr/bin/env node
// ============================================================================
// adjudicate.mjs — deterministic gate for a contributed addon patch.
//
// Runs the scriptable stages of the addon adjudication process (0–5 + build
// reproducibility) over a `git format-patch` / `git diff` file and prints a
// report split into two parts:
//
//   HARD GATES   — pass/fail. Any failure => verdict BLOCK, exit code 1.
//   JUDGMENT QUEUE — file:line items a human/LLM must read and rule on.
//                    Never affects the exit code; it is the review agenda.
//
// This tool executes NONE of the contributed code. It only parses the patch,
// runs `git apply --check` against a base checkout, and extracts the resulting
// manifest/package.json via `git archive` + `git apply` in a throwaway dir.
//
// Usage:
//   node scripts/adjudicate/adjudicate.mjs --patch <file> [options]
//
// Options:
//   --patch <file>        (required) the contribution, as a patch/diff file
//   --repo <dir>          base mosaic-addons checkout to apply against
//                         (default: the repo this script lives in)
//   --expect-commit <sha> assert the patch's From-hash matches this
//   --json                also write a machine-readable report to stdout tail
//   --app-src <dir>       mosaic-companion checkout, to cross-check that the
//                         mirrored permission vocabulary hasn't drifted
// ============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSION_VOCABULARY, RESERVED_PERMISSIONS, RESERVED_IPC_NAMESPACES,
  ID_PATTERN, IPC_NAMESPACE_PATTERN, MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH,
  MAX_TAB_LABEL_LENGTH, SEMVER_RE, SENSITIVE_PATH_PATTERNS,
  INSTALL_LIFECYCLE_SCRIPTS, NON_REGISTRY_DEP_RE, SCAN_CATEGORIES, URL_RE,
  MAIN_ENTRY_ALLOWLIST,
} from "./policy.mjs";

// ── tiny arg parse ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--patch") out.patch = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--expect-commit") out.expectCommit = argv[++i];
    else if (a === "--app-src") out.appSrc = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(SELF_DIR, "..", ".."); // scripts/adjudicate -> repo root

// ── report accumulator ──────────────────────────────────────────────────────
const gates = []; // { name, status: 'pass'|'fail'|'skip', detail }
const queue = []; // { category, items: [{file, line, text}] }
const notes = []; // free-form informational lines

function gate(name, ok, detail = "") {
  gates.push({ name, status: ok ? "pass" : "fail", detail });
}
function gateSkip(name, detail) { gates.push({ name, status: "skip", detail }); }

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// True if `rel` is git-ignored in `repo` (check-ignore -q: exit 0 = ignored).
function isIgnored(repo, rel) {
  try { execFileSync("git", ["-C", repo, "check-ignore", "-q", rel], { stdio: "pipe" }); return true; }
  catch { return false; }
}

// ── unified-diff parser ─────────────────────────────────────────────────────
// Yields one entry per file with post-image line numbers for added lines, plus
// the structural flags we gate on (new/deleted/mode/symlink/submodule/rename).
function parsePatch(text) {
  const files = [];
  let cur = null, newLine = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = {
        aPath: m ? m[1] : null, bPath: m ? m[2] : null,
        added: [], isNew: false, isDeleted: false, isRename: false,
        modeExec: false, isSymlink: false, isSubmodule: false,
      };
      files.push(cur);
      newLine = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode ")) { cur.isNew = true; flagMode(cur, line); continue; }
    if (line.startsWith("deleted file mode ")) { cur.isDeleted = true; flagMode(cur, line); continue; }
    if (line.startsWith("old mode ") || line.startsWith("new mode ")) { flagMode(cur, line); continue; }
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) { cur.isRename = true; continue; }
    if (line.startsWith("--- ")) { if (line === "--- /dev/null") cur.isNew = true; continue; }
    if (line.startsWith("+++ ")) {
      if (line === "+++ /dev/null") cur.isDeleted = true;
      else { const p = line.slice(4).replace(/^b\//, ""); if (p !== "/dev/null") cur.bPath = p; }
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { newLine = parseInt(hunk[1], 10); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      cur.added.push({ line: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // removed line — post-image cursor does not advance
    } else if (line.startsWith(" ")) {
      newLine++;
    }
  }
  return files;
}
function flagMode(cur, line) {
  if (/ 100755$/.test(line)) cur.modeExec = true;
  if (/ 120000$/.test(line)) cur.isSymlink = true;
  if (/ 160000$/.test(line)) cur.isSubmodule = true;
}

function pathOf(f) { return f.isDeleted ? f.aPath : (f.bPath || f.aPath); }

// ── extract the post-patch tree into a throwaway dir (no code executed) ─────
function extractResolved(repo, patchAbs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adjudicate-"));
  try {
    execFileSync("bash", ["-c", `git -C "${repo}" archive HEAD | tar -x -C "${tmp}"`], { stdio: "pipe" });
  } catch {
    // No HEAD or empty repo — start from an empty base; the patch creates files.
  }
  execFileSync("git", ["apply", patchAbs], { cwd: tmp, stdio: "pipe" });
  return tmp;
}

function readJsonMaybe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// ============================================================================
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.patch) {
    console.log("usage: adjudicate.mjs --patch <file> [--repo <dir>] [--expect-commit <sha>] [--app-src <dir>] [--json]");
    process.exit(args.help ? 0 : 2);
  }
  const patchAbs = path.resolve(args.patch);
  const repo = path.resolve(args.repo || DEFAULT_REPO);
  const patchText = fs.readFileSync(patchAbs, "utf8");

  // ── Stage 0: provenance ───────────────────────────────────────────────────
  const fromHashes = [...patchText.matchAll(/^From ([0-9a-f]{40}) /gm)].map((m) => m[1]);
  const subjects = [...patchText.matchAll(/^Subject: (.+)$/gm)].map((m) => m[1]);
  const authors = [...new Set([...patchText.matchAll(/^From: (.+)$/gm)].map((m) => m[1]))];
  const singleCommit = fromHashes.length <= 1;
  gate("0 provenance: single logical commit", singleCommit,
    fromHashes.length ? `${fromHashes.length} commit(s); author(s): ${authors.join(", ")}` : "no mailbox header (bare diff)");
  if (args.expectCommit) {
    const match = fromHashes.some((h) => h.startsWith(args.expectCommit) || args.expectCommit.startsWith(h.slice(0, 7)));
    gate(`0 provenance: patch commit == ${args.expectCommit}`, match,
      match ? `matched ${fromHashes[0]}` : `patch declares ${fromHashes[0] || "(none)"}`);
  } else if (fromHashes[0]) {
    notes.push(`Patch declares commit ${fromHashes[0]} — verify against the source repo when reachable.`);
  }

  // ── parse the diff ────────────────────────────────────────────────────────
  const files = parsePatch(patchText);
  const touched = files.map(pathOf).filter(Boolean);

  // ── Stage 1: scope containment ────────────────────────────────────────────
  // Reject traversal before the containment regex sees the path. `^addons/x/`
  // matches "addons/x/../../../etc/passwd" perfectly happily, so without this
  // the containment gate leans entirely on `git apply` rejecting the path
  // independently — a backstop in a different parser, not this gate.
  const traversing = touched.filter(hasTraversal);
  const addonIds = new Set(touched.map((p) => (p.match(/^addons\/([^/]+)\//) || [])[1]).filter(Boolean));
  const outside = touched.filter((p) => !/^addons\/[^/]+\//.test(p) || hasTraversal(p));
  const singleAddon = addonIds.size === 1 && outside.length === 0;
  const addonId = [...addonIds][0];
  const sensitiveHits = touched.flatMap((p) =>
    SENSITIVE_PATH_PATTERNS.filter((s) => s.re.test(p)).map((s) => `${p} (${s.why})`));
  gate("1 scope: no path traversal or absolute paths", traversing.length === 0,
    traversing.join(", "));
  gate("1 scope: all paths under one addons/<id>/", singleAddon,
    singleAddon ? `addon "${addonId}", ${touched.length} file(s)`
      : `ids=[${[...addonIds].join(", ")}]${outside.length ? `; OUTSIDE: ${outside.join(", ")}` : ""}`);
  if (sensitiveHits.length) gate("1 scope: no sensitive/tooling paths touched", false, sensitiveHits.join("; "));

  const exec = files.filter((f) => f.modeExec).map(pathOf);
  const symlinks = files.filter((f) => f.isSymlink).map(pathOf);
  const submodules = files.filter((f) => f.isSubmodule).map(pathOf);
  gate("1 scope: no executable bits added", exec.length === 0, exec.join(", "));
  gate("1 scope: no symlinks added", symlinks.length === 0, symlinks.join(", "));
  gate("1 scope: no submodules added", submodules.length === 0, submodules.join(", "));

  // ── Stage 2: applies cleanly to base ──────────────────────────────────────
  let applies = false;
  try {
    execFileSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "apply", "--check", patchAbs], { stdio: "pipe" });
    applies = true;
    gate("2 applies: git apply --check on HEAD", true, `base: ${repo}`);
  } catch (e) {
    gate("2 applies: git apply --check on HEAD", false, String(e.stderr || e.message).trim().split("\n")[0]);
  }

  // ── Stages 3 & 5: resolve post-patch tree for manifest + package.json ─────
  let resolvedDir = null;
  if (applies && singleAddon) {
    try { resolvedDir = extractResolved(repo, patchAbs); }
    catch (e) { notes.push(`Could not resolve post-patch tree: ${String(e.message).split("\n")[0]}`); }
  }

  // ── Stage 3: manifest & permission conformance ────────────────────────────
  if (resolvedDir && addonId) {
    const manifest = readJsonMaybe(path.join(resolvedDir, "addons", addonId, "manifest.json"));
    if (!manifest) {
      gate("3 manifest: parses", false, "manifest.json missing or invalid JSON in resolved tree");
    } else {
      const errs = validateManifestPolicy(manifest, addonId);
      gate("3 manifest: v1 policy conformance", errs.length === 0, errs.join("; "));
      // Informational: capabilities & the privileged main-process module.
      if (Array.isArray(manifest.permissions))
        notes.push(`Declared permissions: [${manifest.permissions.join(", ")}]`);
      if (manifest.main && manifest.main.entry)
        notes.push(`⚑ ELEVATED: declares a main-process module (main.entry="${manifest.main.entry}") — runs OUTSIDE the webview sandbox; review it in full.`);
    }
  } else {
    gateSkip("3 manifest: v1 policy conformance", "skipped (patch did not apply / not single-addon)");
  }

  // ── Stage 4: supply chain (package.json in resolved tree) ─────────────────
  const pkgPaths = touched.filter((p) => /(^|\/)package\.json$/.test(p) && p.startsWith("addons/"));
  if (resolvedDir && pkgPaths.length) {
    let scriptViol = [], depViol = [], newDeps = [];
    for (const rel of pkgPaths) {
      const pkg = readJsonMaybe(path.join(resolvedDir, rel));
      if (!pkg) continue;
      for (const s of INSTALL_LIFECYCLE_SCRIPTS)
        if (pkg.scripts && pkg.scripts[s]) scriptViol.push(`${rel}: scripts.${s}`);
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [name, spec] of Object.entries(pkg[field] || {})) {
          if (typeof spec === "string" && NON_REGISTRY_DEP_RE.test(spec)) depViol.push(`${rel}: ${name}@${spec}`);
          else newDeps.push(`${name}@${spec}`);
        }
      }
    }
    gate("4 supply-chain: no install lifecycle scripts", scriptViol.length === 0, scriptViol.join("; "));
    gate("4 supply-chain: all deps from the registry", depViol.length === 0, depViol.join("; "));
    if (newDeps.length) notes.push(`Declared deps (judge legitimacy): ${newDeps.join(", ")}`);
  } else {
    notes.push("No addon package.json changes to supply-chain check.");
  }

  // ── Stage 4b: build reproducibility — convention-aware ────────────────────
  // Two models exist. If the repo git-ignores renderer/ it is BUILD OUTPUT
  // produced by the release pipeline (scripts/build-addon.mjs runs the addon's
  // own `npm run build`); the bundle is legitimately absent from a source
  // patch, and the real check is a sandboxed build (Stage 7). Only if the repo
  // TRACKS bundles does a src-without-bundle change mean the shipped artifact
  // would drift from the reviewed source.
  const srcChanged = touched.some((p) => /^addons\/[^/]+\/src\//.test(p));
  const bundleChanged = touched.some((p) => /^addons\/[^/]+\/renderer\/(index\.html|assets\/)/.test(p));
  const rendererIsBuildOutput = addonId && isIgnored(repo, `addons/${addonId}/renderer/`);
  if (srcChanged) {
    if (rendererIsBuildOutput) {
      gate("4b reproducibility: build model is coherent", true,
        "renderer/ is gitignored build output (built by scripts/build-addon.mjs) — correctly absent from a source patch");
      notes.push("⚑ STAGE 7 REQUIRED: renderer/ is built from src; run the addon's build in a sandbox and confirm it produces a working bundle before packaging/merge.");
    } else {
      gate("4b reproducibility: committed bundle regenerated with src", bundleChanged,
        bundleChanged ? "renderer/ updated alongside src/"
          : "repo TRACKS renderer bundles but src/ changed without a bundle update — the shipped artifact would not reflect the reviewed source; rebuild before merge");
    }
  }

  // ── Stage 5: capability scan → JUDGMENT QUEUE (never a gate) ──────────────
  const hosts = new Set();
  for (const cat of SCAN_CATEGORIES) {
    const items = [];
    for (const f of files) {
      const p = pathOf(f);
      for (const { line, text } of f.added) {
        if (cat.patterns.some((re) => re.test(text))) items.push({ file: p, line, text: text.trim().slice(0, 160) });
      }
    }
    if (items.length) queue.push({ category: cat.label, key: cat.key, items });
  }
  for (const f of files)
    for (const { text } of f.added)
      for (const m of text.matchAll(URL_RE)) hosts.add(m[1]);
  if (hosts.size) notes.push(`Network hosts referenced (no allowlist exists yet — judge each): ${[...hosts].join(", ")}`);

  // ── optional: vocabulary drift check against the app source ───────────────
  if (args.appSrc) checkVocabDrift(args.appSrc);

  if (resolvedDir) { try { fs.rmSync(resolvedDir, { recursive: true, force: true }); } catch {} }

  // ── render ────────────────────────────────────────────────────────────────
  const failed = gates.filter((g) => g.status === "fail");
  const verdict = failed.length ? "BLOCK" : (queue.length ? "REVIEW" : "PASS");
  render(verdict, addonId);
  if (args.json) console.log("\n" + JSON.stringify({ verdict, addonId, gates, queue, notes }, null, 2));
  process.exit(verdict === "BLOCK" ? 1 : 0);
}

// mirror of manifest.ts validateManifest — policy subset relevant to review
/**
 * A `..` *segment*, an absolute path, or a Windows drive/UNC prefix — not a
 * substring match, so an honest file called `foo..js` is not a violation.
 * Mirrors the app's `hasPathTraversal`.
 */
function hasTraversal(p) {
  if (typeof p !== "string" || p.length === 0) return true;
  if (p.startsWith("/") || p.startsWith("\\\\") || /^[a-zA-Z]:/.test(p)) return true;
  return p.split(/[\\/]+/).some((seg) => seg === "..");
}

function validateManifestPolicy(m, dirName) {
  const e = [];
  if (m.manifestVersion !== 1) e.push(`manifestVersion must be 1 (got ${JSON.stringify(m.manifestVersion)})`);
  if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) e.push(`invalid id ${JSON.stringify(m.id)}`);
  else if (m.id !== dirName) e.push(`id "${m.id}" must equal directory "${dirName}"`);
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) e.push(`invalid version ${JSON.stringify(m.version)}`);
  if (typeof m.name !== "string" || m.name.length < 1 || m.name.length > MAX_NAME_LENGTH) e.push("invalid name length");
  if (typeof m.description !== "string" || m.description.length < 1 || m.description.length > MAX_DESCRIPTION_LENGTH) e.push("invalid description length");
  if (typeof m.ipcNamespace !== "string" || !IPC_NAMESPACE_PATTERN.test(m.ipcNamespace)) e.push(`invalid ipcNamespace ${JSON.stringify(m.ipcNamespace)}`);
  else if (RESERVED_IPC_NAMESPACES.includes(m.ipcNamespace)) e.push(`ipcNamespace "${m.ipcNamespace}" is reserved`);
  if (m.mountPoint !== "tab") e.push(`mountPoint must be "tab" (got ${JSON.stringify(m.mountPoint)})`);
  if (m.tab && typeof m.tab.label === "string" && m.tab.label.length > MAX_TAB_LABEL_LENGTH) e.push("tab.label too long");
  if (m.main !== undefined) {
    if (!m.main || typeof m.main.entry !== "string" || hasTraversal(m.main.entry)) {
      e.push("invalid main.entry (or path traversal)");
    }
    // Not a judgment call a reviewer gets to make: the app refuses the install
    // outright for any id outside the allowlist, because main-process code runs
    // unsandboxed and the permission model does not reach it. Without this the
    // pipeline was more permissive than the app it mirrors, and reported a
    // forbidden addon as merely worth a look.
    if (typeof m.id === "string" && !MAIN_ENTRY_ALLOWLIST.includes(m.id)) {
      e.push(
        `"${m.id}" ships main.entry but is not in MAIN_ENTRY_ALLOWLIST — the app ` +
        `refuses to install this. Main-process code is not covered by the permission model.`,
      );
    }
  }
  if (!m.renderer || typeof m.renderer.entry !== "string" || hasTraversal(m.renderer.entry)) e.push("missing/invalid renderer.entry (or path traversal)");
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) e.push("permissions must be an array");
    else for (const p of m.permissions) {
      if (RESERVED_PERMISSIONS.includes(p)) e.push(`permission "${p}" is RESERVED and cannot be requested in v1`);
      else if (!PERMISSION_VOCABULARY.includes(p)) e.push(`unknown permission "${p}"`);
    }
  }
  return e;
}

function checkVocabDrift(appSrc) {
  const p = path.join(appSrc, "electron", "addons", "manifest.ts");
  let src;
  try { src = fs.readFileSync(p, "utf8"); } catch { notes.push(`--app-src: ${p} not found; skipped drift check`); return; }
  const arr = (name) => {
    const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
  };
  const cmp = (name, mine) => {
    const theirs = arr(name);
    if (!theirs) { notes.push(`drift: could not read ${name} from manifest.ts`); return; }
    const a = new Set(mine), b = new Set(theirs);
    const diff = [...new Set([...mine, ...theirs])].filter((x) => a.has(x) !== b.has(x));
    if (diff.length) gate(`drift: ${name} matches app source`, false, `differs on: ${diff.join(", ")}`);
    else notes.push(`drift: ${name} in sync with app source (${theirs.length} entries)`);
  };
  cmp("PERMISSION_VOCABULARY", PERMISSION_VOCABULARY);
  cmp("RESERVED_PERMISSIONS", RESERVED_PERMISSIONS);
  cmp("RESERVED_IPC_NAMESPACES", RESERVED_IPC_NAMESPACES);
}

function render(verdict, addonId) {
  const bar = "─".repeat(72);
  console.log(bar);
  console.log(`ADDON ADJUDICATION — ${addonId ? `addon "${addonId}"` : "(addon id undetermined)"}`);
  console.log(bar);
  console.log("\nHARD GATES");
  for (const g of gates) {
    const mark = g.status === "pass" ? "  PASS" : g.status === "fail" ? "✗ FAIL" : "  skip";
    console.log(`  ${mark}  ${g.name}${g.detail ? `\n           ↳ ${g.detail}` : ""}`);
  }
  if (notes.length) {
    console.log("\nNOTES");
    for (const n of notes) console.log(`  • ${n}`);
  }
  console.log("\nJUDGMENT QUEUE  (human/LLM must read & rule on each — does NOT affect pass/fail)");
  if (!queue.length) console.log("  (none)");
  for (const q of queue) {
    console.log(`  [${q.key}] ${q.category}`);
    for (const it of q.items) console.log(`      ${it.file}:${it.line}  ${it.text}`);
  }
  console.log("\n" + bar);
  const line = verdict === "BLOCK"
    ? `VERDICT: BLOCK — ${gates.filter((g) => g.status === "fail").length} hard gate(s) failed. Do not merge.`
    : verdict === "REVIEW"
      ? `VERDICT: REVIEW — hard gates pass; ${queue.reduce((n, q) => n + q.items.length, 0)} item(s) need human judgment before merge.`
      : "VERDICT: PASS — hard gates pass; no items flagged for judgment.";
  console.log(line);
  console.log(bar);
}

main();
