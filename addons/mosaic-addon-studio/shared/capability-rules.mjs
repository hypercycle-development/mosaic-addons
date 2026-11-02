/**
 * Mosaic capability checks — the browser-safe half.
 *
 * The manifest schema can tell an add-on whether its fields are shaped
 * correctly. It cannot tell the add-on whether the icon it chose will ever
 * render, whether the API method it calls exists, or whether the app version
 * it asks for is new enough to have that method. Those are the failures the
 * Mosaic catalogue's issue #19 measured across four review rounds: an
 * add-on called a method that does not exist, and nothing failed until a
 * person read the code.
 *
 * These checks read the pinned app reference in `mosaic-app-reference.data.mjs`
 * — the facts extracted from a specific Mosaic Companion revision, with that
 * revision's provenance attached. The rules are therefore derived from the
 * application, not from a list someone typed and forgot to update.
 *
 * The source of an add-on arrives here as a list of `{ file, source }`
 * entries rather than as a directory, because a renderer has no filesystem:
 * inside Mosaic the files come from `addonAPI.files`, and in the local
 * Studio they come from disk. The rules are identical either way.
 */

import semver from 'semver';

import { APP_REFERENCE } from './mosaic-app-reference.data.mjs';
import { permissionForCall } from './mosaic-app-reference.mjs';

// The renderer reaches the app only through `window.addonAPI`. The add-on's
// own main-process context (`ctx`) carries `ipc`, `events`, `paths`,
// `settings` and `log` — no `api` — so a `ctx.api.*` call is a call to
// something that was never there.
const API_OBJECT = 'addonAPI';

// The wrong global. `window.mosaicAPI` does not exist; `window.addonAPI`
// does. Naming it here means the error can say what to use instead.
const WRONG_GLOBAL_PATTERN = /(?<![A-Za-z0-9_$])mosaicAPI(?![A-Za-z0-9_$])/g;

/**
 * Blank out comments, preserving every line break.
 *
 * A comment that mentions a removed entry is the normal way to record a
 * removal, so a scan that cannot tell a comment from code will read a name
 * the app has deliberately freed and report a method that exists as missing.
 * This is not hypothetical: `electron/addons/buckets.ts` mentioned inside a
 * comment reads as a call to `addonAPI.buckets.ts`.
 *
 * String literals are left alone — a URL inside a string is not a comment,
 * and blanking from the `//` would swallow the rest of the line.
 *
 * @param {string} source
 * @returns {string} The same text, with comment bodies replaced by spaces.
 */
export function blankComments(source) {
  const text = String(source ?? '');
  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) out += text[j] === '\n' ? '\n' : ' ';
      i = stop;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      for (let j = i; j < stop; j += 1) out += ' ';
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Put source into the shape the call scanner can read.
 *
 * Three rewrites, and none of them changes what a call *does* — only how it
 * is spelled:
 *
 * - Comments are blanked, so a file that mentions a path in prose does not
 *   read as a call.
 * - TypeScript casts are dropped: `(window as any).addonAPI` and
 *   `(addonAPI as AddonAPI | undefined)?.buckets` are the same call as
 *   `window.addonAPI` and `addonAPI.buckets`. A scanner that cannot see
 *   through a cast reports a method that exists as missing.
 * - Optional chaining is dropped: `addonAPI?.agents?.list` is one call, not
 *   two, and the `?` is not part of the method name.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeSource(source) {
  let text = blankComments(source);

  // `(expr as Type)` -> `(expr)`. The type may itself contain a union, so the
  // body runs to the closing parenthesis.
  text = text.replace(/\(\s*([A-Za-z_$][\w$.]*)\s+as\s+[^()]*\)/g, '($1)');

  // `?.` -> `.`, but only where a member follows: `a ? .5 : b` is a ternary
  // and must survive untouched.
  text = text.replace(/\?\.(?=[A-Za-z_$])/g, '.');

  // A parenthesised API object: `(window).addonAPI` -> `window.addonAPI`.
  text = text.replace(/\(\s*(window|addonAPI)\s*\)\s*\./g, '$1.');

  return text;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find every API call an add-on makes.
 *
 * The scanner follows the shapes real add-ons use, because the catalogue's
 * own add-ons use all of them:
 *
 * - `addonAPI.agents.list()` and `addonAPI?.agents?.list()`
 * - `const api = window.addonAPI; api.agents.list()`
 * - `const buckets = addonAPI?.buckets; buckets.write()`
 * - `addonAPI["agents"]["list"]()`
 *
 * A call it cannot resolve is a call it does not report. That direction is
 * deliberate: an unresolved call can cost the author a missed warning, while
 * a wrongly resolved one would block an add-on that is correct.
 *
 * @param {{ file: string, source: string }[]} files The add-on's source files.
 * @param {object} [options]
 * @param {string[]} [options.namespaces] The API namespace names.
 * @returns {{ ns: string, method: string, file: string, line: number, root: boolean }[]}
 */
export function scanApiCallsInFiles(files, options = {}) {
  const namespaces = Array.isArray(options.namespaces) ? options.namespaces : [];
  const calls = [];
  const seen = new Set();

  for (const file of files) {
    const text = normalizeSource(file.source);
    const relative = file.file;

    const lineAt = index => text.slice(0, index).split(/\r?\n/).length;

    // Every name that holds the API object: the global itself, plus any
    // variable bound to it, directly or through another alias.
    //
    // The set is grown to a fixed point, so `const api = addonAPI;` is
    // recognised as an alias too.
    const apiRefs = new Set([API_OBJECT]);
    let grew = true;

    while (grew) {
      grew = false;

      // `const api = window.addonAPI;` and `const api = addonAPI;`
      const directPattern = new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*` +
        String.raw`(?:window\s*\.\s*)?${API_OBJECT}\s*(?![.\w$])`,
        'g'
      );

      // `const other = api;`
      const transitivePattern = new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*` +
        String.raw`([A-Za-z_$][\w$]*)\s*(?![.\w$])`,
        'g'
      );

      for (const pattern of [directPattern, transitivePattern]) {
        for (const match of text.matchAll(pattern)) {
          const name = match[1];
          const value = match[2];

          if (apiRefs.has(name)) continue;
          if (value && !apiRefs.has(value)) continue;

          // A name bound to the API object is only an alias while nothing
          // else assigns to it.
          const reassigned = new RegExp(String.raw`\b${escapeRegExp(name)}\s*=[^=]`).test(
            text.replace(match[0], '')
          );
          if (reassigned) continue;

          apiRefs.add(name);
          grew = true;
        }
      }
    }

    for (const ref of apiRefs) {
      const memberPattern = new RegExp(
        String.raw`\b${escapeRegExp(ref)}\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"\`]([A-Za-z_$][\w$]*)['"\`]\s*\])`,
        'g'
      );

      for (const match of text.matchAll(memberPattern)) {
        const member = match[1] || match[2];
        const chain = match[0];

        if (!namespaces.includes(member)) {
          // A property of the API object that is not a namespace. It is
          // either a root method — `parseError`, `invoke`, `init` — or a
          // name that does not exist, and it may still be followed by a
          // method: `addonAPI.vault.getBoxes()` is a namespace that is not
          // there, not a root call.
          const after = text.slice(match.index + chain.length);
          const continued = after.match(/^\s*\.\s*([A-Za-z_$][\w$]*)/);

          if (continued) {
            const key = `${member}.${continued[1]}`;
            if (seen.has(key)) continue;
            seen.add(key);

            calls.push({
              ns: member,
              method: continued[1],
              key,
              file: relative,
              line: lineAt(match.index),
              root: false
            });
            continue;
          }

          if (!/^\s*\(/.test(after)) continue;

          const key = `.${member}`;
          if (seen.has(key)) continue;
          seen.add(key);

          calls.push({
            ns: '',
            method: member,
            key,
            file: relative,
            line: lineAt(match.index),
            root: true
          });
          continue;
        }

        // The namespace may be bound to a variable: `const buckets =
        // addonAPI.buckets;`.
        const before = text.slice(Math.max(0, match.index - 120), match.index);
        const bound = before.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
        const namespaceRefs = [chain];
        if (bound) namespaceRefs.push(bound[1]);

        for (const namespaceRef of namespaceRefs) {
          const methodPattern = new RegExp(
            String.raw`\b${escapeRegExp(namespaceRef)}\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"\`]([A-Za-z_$][\w$]*)['"\`]\s*\])`,
            'g'
          );

          for (const methodMatch of text.matchAll(methodPattern)) {
            const method = methodMatch[1] || methodMatch[2];
            const key = `${member}.${method}`;
            if (seen.has(key)) continue;
            seen.add(key);

            calls.push({
              ns: member,
              method,
              key,
              file: relative,
              line: lineAt(methodMatch.index),
              root: false
            });
          }
        }
      }
    }
  }

  return calls;
}

/**
 * Find references to a global the app does not expose.
 *
 * @param {{ file: string, source: string }[]} files The add-on's source files.
 * @returns {{ file: string, line: number, name: string }[]}
 */
export function scanUnknownGlobalsInFiles(files) {
  const found = [];

  for (const file of files) {
    // Comments are blanked first: a comment that says "this replaced
    // window.mosaicAPI" is not a use of it.
    const text = blankComments(file.source);

    WRONG_GLOBAL_PATTERN.lastIndex = 0;
    let match;

    while ((match = WRONG_GLOBAL_PATTERN.exec(text)) !== null) {
      found.push({
        name: match[0],
        file: file.file,
        line: text.slice(0, match.index).split(/\r?\n/).length
      });
    }
  }

  return found;
}

/**
 * Find every API namespace the source mentions, however it is reached.
 *
 * This is deliberately broader than `scanApiCallsInFiles`: it does not need
 * to resolve where the API object came from, only that a namespace name is
 * used as a property. It exists so a permission check can be conservative —
 * an add-on that reaches the API through a React state variable the
 * scanner cannot follow still gets the benefit of the doubt.
 *
 * @param {{ file: string, source: string }[]} files The add-on's source files.
 * @param {string[]} namespaces The namespace names to look for.
 * @returns {Set<string>}
 */
export function scanMentionedNamespacesInFiles(files, namespaces) {
  const mentioned = new Set();
  if (!Array.isArray(namespaces) || !namespaces.length) return mentioned;

  const pattern = new RegExp(
    String.raw`\.\s*(${namespaces.join('|')})\b`,
    'g'
  );

  for (const file of files) {
    const text = blankComments(file.source);
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      mentioned.add(match[1]);
    }
  }

  return mentioned;
}

/**
 * The namespaces whose APIs require a given permission.
 *
 * @param {object} reference
 * @param {string} permission
 * @returns {string[]}
 */
function namespacesForPermission(reference, permission) {
  const namespaces = new Set();

  for (const [method, needed] of Object.entries(reference.permissions || {})) {
    if (needed !== permission) continue;
    namespaces.add(method.slice(0, method.lastIndexOf('.')));
  }

  return [...namespaces];
}

/**
 * The release floor for an API, as recorded in the pinned reference.
 *
 * @param {object} reference
 * @param {string} ns
 * @param {string} method
 * @returns {string|null}
 */
function releaseFloor(reference, ns, method) {
  return reference.since?.[`${ns}.${method}`] ?? null;
}

/**
 * The highest release floor among the calls an add-on makes.
 *
 * @param {object} reference
 * @param {{ ns: string, method: string }[]} calls
 * @returns {{ version: string, call: { ns: string, method: string } }|null}
 */
function highestFloor(reference, calls) {
  let best = null;

  for (const call of calls) {
    const floor = releaseFloor(reference, call.ns, call.method);
    if (!floor) continue;

    if (!best || semver.gt(floor, best.version)) {
      best = { version: floor, call };
    }
  }

  return best;
}

/**
 * Check an add-on's capabilities against the pinned app reference.
 *
 * @param {{ file: string, source: string }[]} files The add-on's source files.
 * @param {object} manifest The parsed manifest.
 * @param {object} [options]
 * @param {object} [options.reference] Override the pinned reference.
 * @returns {{ errors: string[], warnings: string[], checks: string[], calls: object[] }}
 */
export function checkAddonCapabilitiesInFiles(files, manifest, options = {}) {
  const reference = options.reference || APP_REFERENCE;
  const errors = [];
  const warnings = [];
  const checks = [];

  const revision = reference.provenance?.revision || 'the pinned revision';
  const namespaces = reference.api?.namespaces || {};
  const rootMethods = reference.api?.root || [];

  // ── 1. the icon must be one the app renders ─────────────────────────────
  const icon = manifest?.tab?.icon;
  const icons = reference.icons || [];

  if (typeof icon === 'string' && icon && icons.length) {
    if (icons.includes(icon)) {
      checks.push(`tab.icon "${icon}" is one of the ${icons.length} icons Mosaic renders.`);
    } else {
      errors.push(
        `tab.icon "${icon}" is not an icon Mosaic renders. The app keeps a ` +
        `curated set of ${icons.length} names and falls back to the default ` +
        `grid icon for anything else, so this icon will never appear. ` +
        `Valid names: ${icons.join(', ')}.`
      );
    }
  }

  // ── 2. every API call must exist ────────────────────────────────────────
  const calls = scanApiCallsInFiles(files, { namespaces: Object.keys(namespaces) });

  for (const wrong of scanUnknownGlobalsInFiles(files)) {
    errors.push(
      `${wrong.file}:${wrong.line} references "${wrong.name}", which Mosaic ` +
      `does not expose. The add-on API is "window.addonAPI".`
    );
  }

  const validCalls = [];

  for (const call of calls) {
    if (call.root) {
      if (!rootMethods.includes(call.method)) {
        errors.push(
          `${call.file}:${call.line} calls addonAPI.${call.method}(), but ` +
          `that does not exist. Mosaic ${revision} exposes ` +
          `addonAPI.${rootMethods.join(', addonAPI.')} at the top level.`
        );
      }
      continue;
    }

    const namespace = namespaces[call.ns];

    if (!namespace) {
      errors.push(
        `${call.file}:${call.line} calls addonAPI.${call.ns}.${call.method}(), ` +
        `but "${call.ns}" is not an API namespace in Mosaic ${revision}. ` +
        `Mosaic exposes: ${Object.keys(namespaces).join(', ')}.`
      );
      continue;
    }

    if (!namespace.includes(call.method)) {
      errors.push(
        `${call.file}:${call.line} calls addonAPI.${call.ns}.${call.method}(), ` +
        `but that method does not exist. Mosaic ${revision} exposes ` +
        `addonAPI.${call.ns}.${namespace.join(', addonAPI.' + call.ns + '.')}.`
      );
      continue;
    }

    validCalls.push(call);
  }

  if (calls.length) {
    checks.push(`Found ${calls.length} API call${calls.length === 1 ? '' : 's'} in the add-on source.`);
  }

  // ── 3. minAppVersion must cover the APIs used ───────────────────────────
  const required = highestFloor(reference, validCalls);

  if (required) {
    const declared = manifest?.minAppVersion;

    if (!declared) {
      errors.push(
        `minAppVersion is not declared, but the add-on calls ` +
        `addonAPI.${required.call.ns}.${required.call.method}(), which Mosaic ` +
        `introduced in ${required.version}. Declare minAppVersion "${required.version}" ` +
        `or newer.`
      );
    } else if (semver.valid(declared) && semver.lt(declared, required.version)) {
      errors.push(
        `minAppVersion is "${declared}", but the add-on calls ` +
        `addonAPI.${required.call.ns}.${required.call.method}(), which Mosaic ` +
        `introduced in ${required.version}. Raise minAppVersion to ` +
        `"${required.version}" or newer.`
      );
    } else if (semver.valid(declared)) {
      checks.push(
        `minAppVersion "${declared}" covers every API the add-on calls ` +
        `(highest floor: ${required.version}).`
      );
    }
  }

  // ── 4. every declared permission should be used ─────────────────────────
  const declaredPermissions = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
  const mentionedNamespaces = scanMentionedNamespacesInFiles(files, Object.keys(namespaces));

  for (const permission of declaredPermissions) {
    const called = validCalls.some(call => {
      const needed = permissionForCall(reference.permissions, call.ns, call.method);
      return needed === permission;
    });

    // The namespace counts as used even when the scanner could not resolve
    // the call. An add-on that reaches the API through a state variable the
    // scanner cannot follow must not be told it declares a permission it
    // does not use — a false warning costs the author more than a missed
    // one.
    const mentioned = namespacesForPermission(reference, permission).some(
      ns => mentionedNamespaces.has(ns)
    );

    if (!called && !mentioned) {
      warnings.push(
        `Permission "${permission}" is declared, but no API the add-on calls ` +
        `requires it.`
      );
    }
  }

  return { errors, warnings, checks, calls };
}

/**
 * The provenance of the pinned reference, for display.
 *
 * @param {object} [reference]
 * @returns {{ repository: string, revision: string, commit: string }|null}
 */
export function referenceProvenance(reference = APP_REFERENCE) {
  if (!reference?.provenance) return null;

  return {
    repository: reference.provenance.repository,
    revision: reference.provenance.revision,
    commit: reference.provenance.commit
  };
}
