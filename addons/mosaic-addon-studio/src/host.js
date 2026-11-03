/**
 * The Studio's host adapter.
 *
 * The Studio runs in two places, and they do not have the same abilities:
 *
 * - **Inside Mosaic** (as an add-on): the renderer is an isolated webview.
 *   There is no local server, no filesystem, and no way to reach the user's
 *   real project tree. What there is: `window.addonAPI`, and a data jail
 *   (`addonAPI.files`) scoped to this add-on's own directory.
 *
 * - **Locally** (the development workspace): a Node service on 127.0.0.1
 *   that owns the project folder on disk.
 *
 * The Studio's rules are the same in both — they live in `shared/` — but the
 * *project store* is not, and that is what this module abstracts. The UI
 * asks for a list of projects, for a validation, for a project to be
 * created, and never learns which host answered.
 *
 * The difference is not cosmetic, and the UI says so: a project created
 * inside Mosaic lives in that add-on's data jail, not in the user's working
 * directory, and the interface labels it accordingly.
 */

import {
  deriveIpcNamespace,
} from '../shared/mosaic-schema.mjs';
import { validateMosaicManifest } from '../shared/manifest-rules.mjs';
import {
  checkAddonCapabilitiesInFiles,
  referenceProvenance,
} from '../shared/capability-rules.mjs';

/** Is the Studio running inside the Mosaic Companion as an add-on? */
export function isInsideMosaic() {
  return typeof window !== 'undefined' && !!window.addonAPI;
}

/**
 * The API surface the UI depends on, resolved for the current host.
 *
 * @returns {{ health: Function, listProjects: Function, createProject: Function,
 *   validateProject: Function, host: 'mosaic'|'local', canReachUserProjects: boolean }}
 */
export function createHost() {
  return isInsideMosaic() ? createMosaicHost() : createLocalHost();
}

/**
 * The local development host: a Node service on 127.0.0.1.
 */
function createLocalHost() {
  async function request(endpoint, options) {
    const response = await fetch(endpoint, options);

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The local API returned an unreadable response.');
    }

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || (data.errors || []).join('\n') || 'The request failed.');
    }

    return data;
  }

  return {
    host: 'local',
    canReachUserProjects: true,

    async health() {
      const data = await request('/api/health');
      return { ok: data.ok === true, detail: data.node ? `Node ${data.node}` : '' };
    },

    async listProjects() {
      const data = await request('/api/projects');
      return data.projects || [];
    },

    async createProject(input) {
      const data = await request('/api/create-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      return data;
    },

    async validateProject(id) {
      return request('/api/validate-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    }
  };
}

/**
 * The Mosaic host: the renderer is the add-on.
 *
 * Two facts shape this implementation:
 *
 * 1. `addonAPI.files` is jailed to this add-on's own `data/` directory. The
 *    Studio can create and read projects there, and nowhere else — it cannot
 *    see the user's real project tree, and it cannot run their builds. The
 *    UI states this rather than implying a capability it does not have.
 *
 * 2. The rules are the same rules the local host applies, imported from
 *    `shared/`. A manifest that validates here validates there.
 */
function createMosaicHost() {
  const api = window.addonAPI;
  const JAIL_ROOT = 'projects';

  async function writeFile(relPath, contents) {
    await api.files.write(relPath, contents);
  }

  async function readFile(relPath) {
    const content = await api.files.read(relPath);
    return typeof content === 'string' ? content : null;
  }

  async function listDir(relDir) {
    const entries = await api.files.list(relDir);
    return Array.isArray(entries) ? entries : [];
  }

  /**
   * Read one project out of the jail as a list of source files.
   *
   * The capability rules consume `{ file, source }` entries, so the jail's
   * contents are read into exactly that shape.
   */
  async function readProjectFiles(projectId) {
    const files = [];

    const walk = async (relDir) => {
      for (const entry of await listDir(relDir)) {
        const relPath = relDir === '.' ? entry.name : `${relDir}/${entry.name}`;

        if (entry.isDir) {
          await walk(relPath);
          continue;
        }

        const source = await readFile(relPath);
        if (source === null) continue;

        // Normalize to paths relative to the project root (strip jail prefix)
        const projectRoot = `${JAIL_ROOT}/${projectId}`;
        const relativeFile = relPath.replace(projectRoot + '/', '');
        files.push({ file: relativeFile, source });
      }
    };

    await walk(`${JAIL_ROOT}/${projectId}`);
    return files;
  }

  return {
    host: 'mosaic',
    canReachUserProjects: false,

    async health() {
      try {
        const info = await api.system.getAppInfo();
        return {
          ok: true,
          detail: info?.appVersion ? `Mosaic ${info.appVersion}` : 'Mosaic Companion'
        };
      } catch {
        return { ok: true, detail: 'Mosaic Companion' };
      }
    },

    async listProjects() {
      const entries = await listDir(JAIL_ROOT);
      const projects = [];

      for (const entry of entries) {
        if (!entry.isDir) continue;

        const projectId = entry.name;
        const manifestText = await readFile(`${JAIL_ROOT}/${projectId}/manifest.json`);

        const project = {
          folder: projectId,
          id: projectId,
          name: projectId,
          version: null,
          manifestStatus: 'missing',
          manifestIssues: [],
          projectIssues: [],
          renderer: false,
          readme: false,
          license: false
        };

        if (manifestText === null) {
          project.manifestStatus = 'invalid';
          project.manifestIssues = ['Missing file: manifest.json'];
          projects.push(project);
          continue;
        }

        let manifest;
        try {
          manifest = JSON.parse(manifestText);
        } catch {
          project.manifestStatus = 'invalid';
          project.manifestIssues = ['manifest.json contains invalid JSON.'];
          projects.push(project);
          continue;
        }

        project.name = typeof manifest.name === 'string' ? manifest.name : projectId;
        project.id = typeof manifest.id === 'string' ? manifest.id : projectId;
        project.version = typeof manifest.version === 'string' ? manifest.version : null;

        const result = validateMosaicManifest(manifest, projectId);
        project.manifestStatus = result.valid ? 'valid' : 'invalid';
        project.manifestIssues = result.errors;

        const files = await readProjectFiles(projectId);
        project.renderer = files.some(file => file.file === 'renderer/index.html');
        project.readme = files.some(file => file.file === 'README.md');
        project.license = files.some(file => file.file === 'LICENSE');

        projects.push(project);
      }

      return projects;
    },

    async createProject(input) {
      const files = buildProjectFiles(input);
      const projectId = files.id;

      for (const [relativePath, contents] of Object.entries(files.files)) {
        await writeFile(`${JAIL_ROOT}/${projectId}/${relativePath}`, contents);
      }

      return {
        ok: true,
        message: 'Add-on project created successfully.',
        id: projectId,
        name: files.name,
        folder: `${JAIL_ROOT}/${projectId}`,
        files: Object.keys(files.files),
        license: files.license,
        publishReady: false
      };
    },

    async validateProject(id) {
      const manifestText = await readFile(`${JAIL_ROOT}/${id}/manifest.json`);

      if (manifestText === null) {
        throw new Error(`No project named "${id}" was found in this add-on's data directory.`);
      }

      let manifest;
      try {
        manifest = JSON.parse(manifestText);
      } catch {
        throw new Error('manifest.json contains invalid JSON.');
      }

      const manifestResult = validateMosaicManifest(manifest, id);
      const files = await readProjectFiles(id);
      const capabilities = checkAddonCapabilitiesInFiles(files, manifest);

      const errors = [...manifestResult.errors, ...capabilities.errors];
      const warnings = [...manifestResult.warnings, ...capabilities.warnings];
      const checks = [...(capabilities.checks || [])];

      return {
        ok: true,
        valid: errors.length === 0,
        publishReady: errors.length === 0 && files.some(file => file.file === 'LICENSE'),
        errors,
        warnings,
        checks,
        reference: referenceProvenance()
      };
    }
  };
}

/**
 * Build the files of a starter add-on project.
 *
 * The same generator the local host uses, in one place, so a project
 * created in Mosaic and a project created locally are the same project.
 */
function buildProjectFiles({ name, id, description, license, author, homepage, minAppVersion }) {
  const namespace = deriveIpcNamespace(id);
  const tabLabel = name.slice(0, 24);

  const manifest = {
    manifestVersion: 1,
    id,
    name,
    version: '0.1.0',
    description,
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(minAppVersion ? { minAppVersion } : {}),
    ipcNamespace: namespace,
    mountPoint: 'tab',
    tab: {
      label: tabLabel,
      icon: 'Sparkles',
      order: 100
    },
    renderer: {
      entry: 'renderer/index.html'
    },
    permissions: [],
    updates: {
      checkMode: 'manual'
    },
    linkVisibilityToActivation: true,
    buckets: {
      publishes: [],
      reads: []
    }
  };

  const licenseText = {
    pending: `LICENSE NOT SELECTED

This is a placeholder, not a legal license.

Choose and insert the complete text of a license before publishing this add-on.
Do not distribute this placeholder as a license.
`,
    MIT: `MIT License

Copyright (c) ${new Date().getFullYear()} The ${name} authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
`,
    'Apache-2.0': 'Apache License, Version 2.0 — see https://www.apache.org/licenses/LICENSE-2.0\n',
    'GPL-3.0-or-later': 'GNU GENERAL PUBLIC LICENSE Version 3 — see https://www.gnu.org/licenses/gpl-3.0.txt\n'
  };

  const files = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'LICENSE': licenseText[license] ?? licenseText.pending,
    'renderer/index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(name)}</title>
  <style>
    body { margin: 0; padding: 48px 24px; background: #0b1020; color: #e8edf5; font: 16px system-ui, sans-serif; }
    main { max-width: 760px; margin: 10vh auto; }
    h1 { font-size: 42px; margin-bottom: 12px; }
    p { color: #a6b4c8; line-height: 1.7; }
    .eyebrow { color: #8ac8ff; letter-spacing: 2px; font-size: 12px; }
    .notice { padding: 16px; border: 1px solid #33435b; border-radius: 10px; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">MOSAIC ADD-ON</p>
    <h1>${escapeHtml(name)}</h1>
    <p>${escapeHtml(description)}</p>
    <p class="notice">Starter project generated by Mosaic Add-on Studio. Review the official Mosaic documentation before publication.</p>
  </main>
</body>
</html>
`,
    'README.md': `# ${name}

${description}

## Project structure

- \`manifest.json\`: Mosaic Add-on Manifest v1.
- \`renderer/index.html\`: isolated add-on renderer entry.
- \`LICENSE\`: selected license or a placeholder requiring your decision.

## Development

This starter uses static HTML and does not require a build step or npm dependencies.

## Before publication

1. Review the manifest and requested permissions.
2. Select and verify the complete license text.
3. Test the add-on in the target Mosaic Companion version.
4. Review the official submission requirements.
5. Remember that local validation does not constitute Mosaic approval.
`
  };

  return { id, name, license, files };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
