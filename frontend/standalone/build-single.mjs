// Builds the console and writes one self-contained HTML file:
//   node standalone/build-single.mjs  ->  standalone/SuliNOC-UI.html
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(here, "out");
const publicDir = resolve(root, "public");

execSync("npx vite build --config standalone/vite.standalone.config.ts", {
  cwd: root,
  stdio: "inherit",
});

const MIME = { ".svg": "image/svg+xml", ".png": "image/png" };
const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");

// Inline the one stylesheet and the one script that Vite emitted.
const assets = readdirSync(join(out, "assets"));
const cssFile = assets.find((f) => f.endsWith(".css"));
const jsFile = assets.find((f) => f.endsWith(".js"));
if (!jsFile) throw new Error("no script in the build output");

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, () =>
  cssFile ? `<style>${readFileSync(join(out, "assets", cssFile), "utf8")}</style>` : "",
);
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, () => "");
const js = readFileSync(join(out, "assets", jsFile), "utf8").replace(/<\/script/gi, "<\\/script");
html = html.replace("</body>", () => `<script type="module">${js}</script>\n</body>`);

// The icon: inline it too.
html = html.replace(/href="\.?\/?favicon\.svg"/g, () => {
  const file = resolve(publicDir, "favicon.svg");
  if (!existsSync(file)) return 'href=""';
  return `href="data:image/svg+xml;base64,${readFileSync(file).toString("base64")}"`;
});

const target = resolve(here, "SuliNOC-UI.html");
writeFileSync(target, html);
console.log(`wrote ${target} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
