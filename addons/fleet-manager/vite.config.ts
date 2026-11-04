import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The renderer is served from mosaic-addon://<id>/, so every asset path must
  // be relative — an absolute "/assets/..." would resolve against the app's
  // origin and 404.
  base: "./",
  build: {
    outDir: "./renderer",
    emptyOutDir: true,
    assetsDir: "assets"
  }
});
