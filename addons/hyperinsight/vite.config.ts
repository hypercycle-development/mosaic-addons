import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds a fully self-contained bundle into ./renderer/ (relative asset
// paths — no absolute "/assets", since this is served from
// mosaic-addon://hyperinsight/, not from a domain root). §6.7's manifest
// schema expects renderer.entry to be "renderer/index.html", and
// build-addon.mjs tars up manifest.json + main/ + renderer/ from inside this
// addon's own directory — outDir must therefore be inside it, not a sibling.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "./renderer",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
