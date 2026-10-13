import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** UI-only build: there is no backend to proxy — every /api call is served
 * from the in-browser mock engine (src/services/mockEngine.ts). */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          map: ["leaflet", "react-leaflet"],
          motion: ["framer-motion"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    // Arena's preview domains are reverse-proxied to this server.
    allowedHosts: [".e2b.app", "localhost"],
  },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app", "localhost"] },
});
