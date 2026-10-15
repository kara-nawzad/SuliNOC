// Post-build: write the short commit hash and build time into the served page.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const out = new URL('../../autonoc/web/dist/index.html', import.meta.url);
const sh = (c) => { try { return execSync(c, { cwd: new URL('../..', import.meta.url) }).toString().trim(); } catch { return ''; } };
const hash = sh('git rev-parse --short HEAD') || 'unknown';
const dirty = sh('git status --porcelain -- frontend') ? '+uncommitted' : '';
const time = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const stamp = `${hash}${dirty} · built ${time}`;
const html = readFileSync(out, 'utf8');
writeFileSync(out, html.split('__BUILD_STAMP__').join(stamp));
console.log('build stamp:', stamp);
