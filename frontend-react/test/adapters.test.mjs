import { readFileSync } from 'node:fs';
import { CrewTrips, towerClass, historyPoints, simTimeToMinutes } from '../src/adapters.js';
import { xLabel, hhmm } from '../src/charts.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('FAIL', msg); } else console.log('ok', msg); };

ok(simTimeToMinutes('D1 00:00') === 0, 'D1 00:00 is minute 0');
ok(simTimeToMinutes('D3 11:00') === 2 * 1440 + 660, 'D3 11:00 converts');
ok(simTimeToMinutes('bad') === null, 'bad time gives null');

const cfg = { presentation: { offline_statuses: [4, 5] } };
ok(towerClass({ id: 1, status: 0, warn: false, critical: true }, cfg, null).halo === false, 'priority site has no halo');
ok(towerClass({ id: 2, status: 0 }, cfg, 2).halo === true, 'selected tower has halo');
ok(towerClass({ id: 3, status: 4 }, cfg, null).cls === 'crit', 'offline is crit');
ok(towerClass({ id: 4, status: 2 }, cfg, null).cls === 'warn', 'other status is warn');

const project = (lat, lon) => [lon * 100, lat * 100];
const trips = new CrewTrips(project);
const idle = { id: 1, lat: 35.55, lon: 45.42, state: 'IDLE', target_lat: null, target_lon: null, eta: 0 };
ok(trips.update(idle).moving === false, 'idle team is not moving');
const go = { ...idle, state: 'EN_ROUTE', target_lat: 35.56, target_lon: 45.44, eta: 4 };
const a = trips.update(go);
ok(a.progress === 0 && a.moving, 'dispatch starts at progress 0');
const b = trips.update({ ...go, lat: 35.555, lon: 45.43, eta: 2 });
ok(Math.abs(b.progress - 0.5) < 1e-9, 'progress follows backend eta');
ok(b.route === a.route, 'route is fixed for one trip (no jumps)');
const c = trips.update({ ...go, eta: 0, state: 'REPAIRING' });
ok(c.moving === false, 'repairing team is not moving');

const real = JSON.parse(readFileSync('/tmp/delta.json', 'utf8'));
const pts = historyPoints(real.dashboard.history, 'throughput_gbps');
ok(pts.length === real.dashboard.history.length, 'every history row becomes a point');
ok(xLabel(285, 1440) === '04:45', 'short time label 04:45');
ok(hhmm(0) === '00:00', 'hh:mm helper');
if (fails) { console.error(fails + ' failed'); process.exit(1); }
console.log('OK');
