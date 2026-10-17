import { CrewMotion, } from '../src/crew-motion.js';
import { niceTicks, xLabel } from '../src/charts.js';
let frames = [], m = new CrewMotion({ render: (id, f) => frames.push(f) }); m.reduce = false;
global.requestAnimationFrame = () => 1; const route = [[0, 0], [100, 0], [100, 100]];
let now = 0, maxJump = 0, prev = null;
for (let tick = 0; tick <= 10; tick++) { now = tick * 1000; m.set('a', { route, progress: tick / 10 }, now);
  for (let f = 0; f < 60; f++) { m.step(now + f * 16.7); const x = frames.at(-1); if (prev) maxJump = Math.max(maxJump, Math.hypot(x.x - prev.x, x.y - prev.y)); prev = x; } }
console.log('max per-frame jump', maxJump.toFixed(2), '(route length 200, 600 frames)');
const last = frames.at(-1); console.log('end', last.x.toFixed(1), last.y.toFixed(1), 'progress', last.progress.toFixed(2));
console.log('ticks', niceTicks(96.4, 100).join(','), '| label', xLabel(285, 1440), xLabel(1440 * 3 + 5, 10080));
if (maxJump > 3 || last.progress < 0.85) { console.error('FAIL'); process.exit(1); } console.log('OK');
