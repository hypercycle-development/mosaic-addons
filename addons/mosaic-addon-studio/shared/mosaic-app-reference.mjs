/**
 * Mosaic app reference — parsers for the Mosaic Companion runtime.
 *
 * The Studio's manifest schema (`mosaic-schema.mjs`) is a transcription of
 * rules that live in the Mosaic Companion source. A transcription is only as
 * good as the moment it was made, and it goes stale the day Mosaic ships.
 *
 * This module closes that gap in the direction the Mosaic catalogue's issue
 * #19 insists on: a check that can block a contributor must derive its
 * expectations from the application at a pinned version, never from a
 * mirrored list, and must never read a comment as code.
 *
 * So the parsing lives here, and the extraction is reproducible from a
 * checkout of the app. `scripts/generate-app-reference.mjs` runs it against
 * a pinned revision and writes the result to
 * `scripts/mosaic-app-reference.data.mjs`, which carries the provenance of
 * the revision it was generated from. `scripts/mosaic-capability-check.mjs`
 * checks add-ons against that data, and can re-derive it from a local
 * checkout to prove the pinned data has not drifted.
 *
 * Every parser here strips comments before it reads anything. A comment that
 * mentions a removed entry is the normal way to record a removal, so a scan
 * that cannot tell a comment from an entry will read a name the app has
 * deliberately freed and refuse an add-on the app would accept.
 *
 * This module is deliberately dependency-free and side-effect-free: it must
 * stay importable from a browser renderer as well as from Node.
 */

// ── Comment stripping ───────────────────────────────────────────────────────

/**
 * Remove block and line comments from a source file.
 *
 * String literals are left alone: a `//` inside a URL is not a comment, and
 * stripping from it would corrupt the source we are about to parse.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  const text = String(source ?? '');
  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      continue;
    }

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

    out += ch;
    i += 1;
  }

  return out;
}

// ── Shared scanning helpers ─────────────────────────────────────────────────

/**
 * Find the body of an object literal assigned to a declaration.
 *
 * @param {string} source Comment-stripped source.
 * @param {string} declaration The identifier that owns the literal.
 * @returns {string|null} The text between the outer braces, or null.
 */
function objectLiteralBody(source, declaration) {
  const pattern = new RegExp(`\\b${declaration}\\b[^=;]*=\\s*\\{`);
  const match = source.match(pattern);
  if (!match) return null;

  // The braces of a generic type annotation (`Record<string, Foo>`) come
  // before the literal's own brace, so the literal starts at the brace that
  // follows the `=` — not at the first `{` after the declaration.
  const start = source.indexOf('{', match.index + match[0].length - 1);

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }

  return null;
}

/**
 * Record every key in an object literal, with the path that leads to it.
 *
 * The path is the list of enclosing key names, so a method inside a
 * namespace has the path `['agents', 'list']` and a namespace has `['agents']`.
 *
 * @param {string} body The text between the literal's outer braces.
 * @returns {{ path: string[], depth: number, isObject: boolean }[]}
 */
function scanObjectKeys(body) {
  const keys = [];

  // One entry per `{` opened, so every `}` pops exactly one and the stack
  // cannot drift out of balance. A brace inside a type argument — `Array<{
  // id: string }>` — opens a brace that owns no key, and it must still be
  // counted: skipping it would let the matching `}` pop the namespace that
  // encloses it, and every later key in that namespace would lose its path.
  const stack = [];

  let parenDepth = 0;
  let bracketDepth = 0;
  let pendingKey = null;
  let pendingIsObject = false;
  let i = 0;

  const currentPath = () => stack.filter(entry => entry !== null);

  const flushPending = () => {
    if (pendingKey === null) return;
    keys.push({
      path: [...currentPath(), pendingKey],
      depth: stack.length,
      isObject: pendingIsObject
    });
    pendingKey = null;
    pendingIsObject = false;
  };

  while (i < body.length) {
    const ch = body[i];

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\') {
          i += 2;
          continue;
        }
        if (body[i] === quote) break;
        i += 1;
      }
      i += 1;
      continue;
    }

    if (ch === '{') {
      stack.push(pendingKey);
      pendingKey = null;
      pendingIsObject = false;
      i += 1;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      i += 1;
      continue;
    }

    if (ch === '(') {
      parenDepth += 1;
      i += 1;
      continue;
    }

    if (ch === ')') {
      parenDepth -= 1;
      i += 1;
      continue;
    }

    if (ch === '[') {
      bracketDepth += 1;
      i += 1;
      continue;
    }

    if (ch === ']') {
      bracketDepth -= 1;
      i += 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < body.length && /[\w$]/.test(body[j])) j += 1;
      const word = body.slice(i, j);

      let k = j;
      while (k < body.length && /\s/.test(body[k])) k += 1;

      // A colon inside parentheses or brackets is a TypeScript type
      // annotation, not an object key: `(relPath: string)` is a parameter,
      // not an entry.
      if (body[k] === ':' && parenDepth === 0 && bracketDepth === 0) {
        let m = k + 1;
        while (m < body.length && /\s/.test(body[m])) m += 1;
        pendingKey = word;
        pendingIsObject = body[m] === '{';
        if (!pendingIsObject) flushPending();
        i = j;
        continue;
      }

      i = j;
      continue;
    }

    i += 1;
  }

  flushPending();

  return keys;
}

// ── The curated icon set ────────────────────────────────────────────────────

/**
 * Extract the add-on tab icon names the app actually renders.
 *
 * `tab.icon` is a Lucide PascalCase name, but the app does not pass the
 * whole of lucide-react through: it keeps a curated map so the bundle stays
 * small, and anything outside that map falls back to the default grid icon
 * at render time. A manifest can therefore carry a perfectly valid,
 * non-empty icon name that the app silently ignores.
 *
 * @param {string} sidebarSource The app's `src/components/Sidebar.tsx`.
 * @returns {string[]} The curated icon names, in declaration order.
 */
export function extractAddonIcons(sidebarSource) {
  const source = stripComments(sidebarSource);
  const body = objectLiteralBody(source, 'ADDON_ICON_MAP');
  if (body === null) return [];

  const names = [];
  for (const match of body.matchAll(/([A-Za-z_$][\w$]*)\s*(?=,|$)/g)) {
    const name = match[1];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// ── The renderer-visible API surface ────────────────────────────────────────

/**
 * Extract the `window.addonAPI` surface the app exposes to add-ons.
 *
 * The preload script is the authority here, not the main-process modules:
 * what a renderer can call is what the preload exposes, and the two differ
 * in at least one place — the renderer subscribes through `events.on`, while
 * the main process offers `events.subscribe` and `events.unsubscribe`.
 *
 * @param {string} preloadSource The app's `electron/addon-preload.ts`.
 * @returns {{ namespaces: Record<string, string[]>, root: string[] }}
 */
export function extractAddonApiSurface(preloadSource) {
  const source = stripComments(preloadSource);
  const body = objectLiteralBody(source, 'addonAPI');
  if (body === null) return { namespaces: {}, root: [] };

  const keys = scanObjectKeys(body);
  const namespaces = {};
  const root = [];

  for (const key of keys) {
    if (key.depth === 0) {
      if (key.isObject) namespaces[key.path[0]] = [];
      else root.push(key.path[0]);
      continue;
    }

    if (key.depth === 1 && key.path.length === 2) {
      const [ns, method] = key.path;
      if (!namespaces[ns]) namespaces[ns] = [];
      namespaces[ns].push(method);
    }
  }

  for (const list of Object.values(namespaces)) {
    list.sort();
  }
  root.sort();

  return { namespaces, root };
}

// ── The permission each API requires ────────────────────────────────────────

/**
 * Map every main-process API method to the permission it requires.
 *
 * The permission is what the runtime checks at call time, so it is also what
 * a declared permission should be justified by: an add-on that declares a
 * permission and calls nothing that needs it is asking for more than it uses.
 *
 * @param {Record<string, string>} sources Module source, keyed by namespace.
 * @returns {Record<string, string|null>} `ns.method` to permission, or null
 *   when the method requires none.
 */
export function extractApiPermissions(sources) {
  const permissions = {};

  for (const [ns, source] of Object.entries(sources ?? {})) {
    const text = stripComments(source);

    for (const match of text.matchAll(/(\w+)\s*:\s*\{([\s\S]*?)\n\s*\},/g)) {
      const [, method, body] = match;
      const permission = body.match(/permission:\s*"([^"]+)"/);
      permissions[`${ns}.${method}`] = permission ? permission[1] : null;
    }
  }

  return permissions;
}

/**
 * The permission an API call needs, taking the renderer's own surface into
 * account.
 *
 * `events.on` is the renderer's spelling of the main process's
 * `events.subscribe`, and neither requires a permission.
 *
 * @param {Record<string, string|null>} permissions `ns.method` to permission.
 * @param {string} ns
 * @param {string} method
 * @returns {string|null}
 */
export function permissionForCall(permissions, ns, method) {
  const direct = permissions?.[`${ns}.${method}`];
  if (direct !== undefined) return direct;

  if (ns === 'events' && method === 'on') {
    return permissions?.['events.subscribe'] ?? null;
  }

  return null;
}
