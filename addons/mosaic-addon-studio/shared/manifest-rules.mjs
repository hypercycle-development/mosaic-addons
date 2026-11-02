/**
 * Mosaic manifest rules — the browser-safe half of the validator.
 *
 * These are the rules the Mosaic Companion runtime applies to a manifest at
 * install time, transcribed once so that the same answer comes out of the
 * Studio's local API and out of the Studio running as an add-on inside
 * Mosaic itself.
 *
 * Nothing here touches the filesystem: the function takes a parsed manifest
 * and returns findings. That is what makes it usable from a renderer, where
 * there is no filesystem to touch — only `window.addonAPI`.
 *
 * The Node-side validator (`scripts/mosaic-manifest-validator.mjs`) imports
 * this module and adds the checks that genuinely need a disk: the LICENSE
 * text, the package.json, whether the renderer entry was built.
 */

import semver from 'semver';

import {
  BUCKET_PATTERN,
  ID_PATTERN,
  MAIN_ENTRY_ALLOWLIST,
  MAX_BUCKET_LABEL_LENGTH,
  MAX_BUCKET_KINDS_READ,
  MAX_BUCKETS_PUBLISHED,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TAB_LABEL_LENGTH,
  PERMISSION_VOCABULARY,
  RESERVED_IPC_NAMESPACES,
  RESERVED_PERMISSIONS,
  hasPathTraversal,
  isAbsolutePath,
  isObject,
  validText,
} from './mosaic-schema.mjs';

/**
 * Validate a parsed manifest against the v1 schema.
 *
 * @param {unknown} manifest The parsed manifest.
 * @param {string} [directoryName] The add-on directory name, when known.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateMosaicManifest(manifest, directoryName) {
  const errors = [];
  const warnings = [];

  const error = message => errors.push(message);
  const warning = message => warnings.push(message);

  if (!isObject(manifest)) {
    return {
      valid: false,
      errors: ['Manifest must be a JSON object.'],
      warnings
    };
  }

  if (manifest.manifestVersion !== 1) {
    error('manifestVersion must be exactly 1.');
  }

  if (!validText(manifest.id, 2, 41) || !ID_PATTERN.test(manifest.id)) {
    error('id must match ^[a-z][a-z0-9-]{1,40}$.');
  } else if (directoryName && manifest.id !== directoryName) {
    error('Manifest ID must match the add-on directory name.');
  }

  if (!validText(manifest.name, 1, 40)) {
    error('name must contain between 1 and 40 characters.');
  }

  if (!validText(manifest.description, 1, 200)) {
    error('description must contain between 1 and 200 characters.');
  }

  if (typeof manifest.version !== 'string' || !semver.valid(manifest.version)) {
    error('version must be a valid SemVer version.');
  }

  for (const field of ['author', 'homepage']) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') {
      error(`${field} must be a string when provided.`);
    }
  }

  if (
    manifest.minAppVersion !== undefined &&
    (typeof manifest.minAppVersion !== 'string' || !semver.valid(manifest.minAppVersion))
  ) {
    error('minAppVersion must be a valid SemVer version.');
  }

  if (
    typeof manifest.ipcNamespace !== 'string' ||
    !ID_PATTERN.test(manifest.ipcNamespace)
  ) {
    error('ipcNamespace must match ^[a-z][a-z0-9-]{1,40}$.');
  } else if (RESERVED_IPC_NAMESPACES.includes(manifest.ipcNamespace)) {
    error(`ipcNamespace "${manifest.ipcNamespace}" is reserved by Mosaic.`);
  }

  if (manifest.mountPoint !== 'tab') {
    error('mountPoint must be "tab".');
  }

  if (!isObject(manifest.tab)) {
    error('tab must be an object.');
  } else {
    if (!validText(manifest.tab.label, 1, 24)) {
      error('tab.label must contain between 1 and 24 characters.');
    }

    if (!validText(manifest.tab.icon, 1, 100)) {
      error('tab.icon must be a non-empty Lucide icon name.');
    }

    if (
      manifest.tab.order !== undefined &&
      (!Number.isInteger(manifest.tab.order))
    ) {
      error('tab.order must be an integer when provided.');
    }

    if (manifest.tab.deepLink !== undefined) {
      if (!isObject(manifest.tab.deepLink) ||
          (manifest.tab.deepLink.param !== undefined &&
           typeof manifest.tab.deepLink.param !== 'string')) {
        error('tab.deepLink must be an object with an optional string param.');
      }
    }
  }

  if (!isObject(manifest.renderer) ||
      typeof manifest.renderer.entry !== 'string' ||
      !manifest.renderer.entry.trim()) {
    error('renderer.entry is required.');
  } else if (
    isAbsolutePath(manifest.renderer.entry) ||
    manifest.renderer.entry.split(/[\\/]/).includes('..')
  ) {
    error('renderer.entry must be a safe relative path without traversal.');
  }

  if (manifest.main !== undefined) {
    if (!isObject(manifest.main) || typeof manifest.main.entry !== 'string' || !manifest.main.entry.trim()) {
      error('main must be an object with a non-empty entry.');
    } else if (hasPathTraversal(manifest.main.entry)) {
      error('main.entry must not escape the add-on directory.');
    } else if (!MAIN_ENTRY_ALLOWLIST.includes(manifest.id)) {
      // Main-process code runs in the Mosaic main process, outside the
      // permission model. The runtime restricts it to a reviewed allowlist
      // keyed on add-on id, so an id outside it is refused at install time.
      error(
        `main.entry is reserved. The Mosaic runtime only allows main-process ` +
        `code for reviewed add-ons (${MAIN_ENTRY_ALLOWLIST.join(', ')}), ` +
        `because main-process code is not covered by the permission model.`
      );
    }
  }

  if (!Array.isArray(manifest.permissions)) {
    error('permissions must be an array.');
  } else {
    for (const permission of manifest.permissions) {
      if (typeof permission !== 'string') {
        error('Every permission must be a string.');
      } else if (RESERVED_PERMISSIONS.includes(permission)) {
        error(`Permission "${permission}" is reserved and cannot be requested.`);
      } else if (!PERMISSION_VOCABULARY.includes(permission)) {
        error(`Unknown permission: "${permission}".`);
      }
    }

    if (new Set(manifest.permissions).size !== manifest.permissions.length) {
      error('permissions must not contain duplicates.');
    }
  }

  if (manifest.buckets !== undefined) {
    if (!isObject(manifest.buckets)) {
      error('buckets must be an object.');
    } else {
      const publishes = manifest.buckets.publishes ?? [];
      const reads = manifest.buckets.reads ?? [];

      if (!Array.isArray(publishes) || publishes.length > MAX_BUCKETS_PUBLISHED) {
        error(`buckets.publishes must be an array with at most ${MAX_BUCKETS_PUBLISHED} entries.`);
      } else {
        const ids = new Set();

        for (const item of publishes) {
          if (!isObject(item) ||
              typeof item.id !== 'string' ||
              !BUCKET_PATTERN.test(item.id) ||
              typeof item.kind !== 'string' ||
              !BUCKET_PATTERN.test(item.kind)) {
            error('Each published bucket requires valid id and kind values.');
            continue;
          }

          if (ids.has(item.id)) error(`Duplicate published bucket ID: "${item.id}".`);
          ids.add(item.id);

          if (item.history !== undefined && item.history !== 'all') {
            error(`Bucket "${item.id}" has an invalid history value.`);
          }

          if (item.label !== undefined && !validText(item.label, 1, 40)) {
            error('Each published bucket label must contain 1 to 40 characters.');
          }
        }
      }

      if (!Array.isArray(reads) || reads.length > MAX_BUCKET_KINDS_READ) {
        error(`buckets.reads must be an array with at most ${MAX_BUCKET_KINDS_READ} entries.`);
      } else {
        const kinds = new Set();

        for (const kind of reads) {
          if (typeof kind !== 'string' || !BUCKET_PATTERN.test(kind)) {
            error('Each read bucket kind must be a valid identifier.');
            continue;
          }
          if (kinds.has(kind)) error(`Duplicate read bucket kind: "${kind}".`);
          kinds.add(kind);
        }
      }

      const hasPublishes = Array.isArray(publishes) && publishes.length > 0;
      const hasPublishPermission =
        Array.isArray(manifest.permissions) && manifest.permissions.includes('buckets:publish');

      if (hasPublishes && !hasPublishPermission) {
        error('Publishing buckets requires the buckets:publish permission.');
      }

      if (!hasPublishes && hasPublishPermission) {
        error('buckets:publish permission requires at least one published bucket.');
      }
    }
  }

  if (manifest.updates !== undefined) {
    if (!isObject(manifest.updates) ||
        (manifest.updates.checkMode !== undefined &&
         !['manual', 'automatic'].includes(manifest.updates.checkMode))) {
      error('updates.checkMode must be "manual" or "automatic".');
    }
  }

  if (
    manifest.linkVisibilityToActivation !== undefined &&
    typeof manifest.linkVisibilityToActivation !== 'boolean'
  ) {
    error('linkVisibilityToActivation must be a boolean.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
