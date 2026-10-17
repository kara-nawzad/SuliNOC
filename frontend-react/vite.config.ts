import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Build stamp shown in the console, Settings and the footer: short commit + build time.
function gitShort(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify({
      sha: gitShort(),
      built: new Date().toISOString(),
    }),
  },
  build: {
    outDir: "../autonoc/web/dist",
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
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app", "localhost"] },
});
