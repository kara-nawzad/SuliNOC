import { defineConfig } from "vite";

// The SuliNOC console is a single self-contained page (index.html) with its own
// in-browser simulation. Vite just bundles it into the backend's static folder.
export default defineConfig({
  build: {
    outDir: "../autonoc/web/dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    // Arena's preview domains are reverse-proxied to this server.
    allowedHosts: [".e2b.app", "localhost"],
  },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app", "localhost"] },
});
