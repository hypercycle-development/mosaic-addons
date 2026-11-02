import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Builds a fully self-contained bundle into ./renderer/ (relative asset
// paths — no absolute "/assets", since this is served from
// mosaic-addon://mosaic-addon-studio/, not from a domain root). The
// manifest schema expects renderer.entry to be "renderer/index.html", and
// the catalogue's build-addon.mjs tars up manifest.json + main/ + renderer/
// from inside this add-on's own directory — outDir must therefore be inside
// it, not a sibling.
//
// `root` is pinned to this directory so the build produces the same output
// whether it is run from here or from the project root, where the local
// development server also uses this config.
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: HERE,
  plugins: [react()],
  base: './',
  build: {
    outDir: './renderer',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
});
