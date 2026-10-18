// Build config for the single-file UI (standalone/SuliNOC-UI.html).
// Same React console as the app; the differences are all build-time:
//  - services/api is replaced by standalone/mockApi.ts (captured data, no server);
//  - the welcome screen's frame gets the hero page inline (srcDoc), with its images and fonts inlined;
//  - every /assets/... image the console uses is inlined as a data URI.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const publicDir = resolve(root, "public");
const mockApi = resolve(here, "mockApi.ts");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function dataUri(relPath: string): string | null {
  const file = resolve(publicDir, relPath);
  try {
    const mime = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

function standalone(): Plugin {
  const HERO_ID = "virtual:hero-html";
  return {
    name: "suli-noc-standalone",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === HERO_ID) return "\0" + HERO_ID;
      // services/api -> offline stand-in (imports from anywhere in src/).
      if (/(^|\/)services\/api$/.test(source) && importer && !importer.includes("standalone"))
        return mockApi;
      return null;
    },
    load(id) {
      if (id !== "\0" + HERO_ID) return null;
      // The hero page, with every relative asset inlined so it works inside srcDoc.
      let html = readFileSync(resolve(publicDir, "hero-source.html"), "utf8");
      html = html.replace(
        /(["'(])(\/?)assets\/([A-Za-z0-9._\-\/]+)/g,
        (match, lead: string, _slash: string, path: string) => {
          const uri = dataUri("assets/" + path);
          return uri ? lead + uri : match;
        },
      );
      return `export default ${JSON.stringify(html)};`;
    },
    transform(code, id) {
      if (!/\.(tsx|ts|jsx|js)$/.test(id) || id.includes("node_modules")) return null;
      let out = code;
      // Frame of the welcome screen: the hero page inline, not from /hero-source.html.
      if (out.includes('src="/hero-source.html"')) {
        out = `import HERO_HTML from "${HERO_ID}";\n` + out.replace('src="/hero-source.html"', "srcDoc={HERO_HTML}");
      }
      // Any "/assets/x" string the console uses becomes an inline data URI.
      out = out.replace(/"\/assets\/([A-Za-z0-9._\-\/]+)"/g, (match, path: string) => {
        const uri = dataUri("assets/" + path);
        return uri ? JSON.stringify(uri) : match;
      });
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), standalone()],
  define: {
    __BUILD_STAMP__: JSON.stringify({
      sha: "single-file",
      built: new Date().toISOString(),
    }),
  },
  build: {
    outDir: resolve(here, "out"),
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
