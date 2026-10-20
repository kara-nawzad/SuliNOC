// Adapters: map the real /api/delta and /api/config fields onto the UI kit inputs.
// The kit does not know the backend field names; this file is the only place that does.
// Nothing here invents data: positions, targets, ETAs and times all come from the backend.

// "D3 11:00" -> minutes since D1 00:00. Used as the chart x axis so the kit's xLabel() works.
export function simTimeToMinutes(simTime) {
  const m = /^D(\d+)\s+(\d{1,2}):(\d{2})/.exec(simTime || "");
  if (!m) return null;
  return (Number(m[1]) - 1) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

// Tower status for the .tw classes in theme.css.
// Backend: status 0 = healthy; offline_statuses [4, 5] = offline (critical); anything else = warning.
// The halo is only for selected, faulty (warn or crit) or flagged (node.warn) towers.
export function towerClass(node, config, selectedId) {
  const offline = (config.presentation?.offline_statuses || [4, 5]).includes(
    node.status,
  );
  const cls = node.status === 0 ? "" : offline ? "crit" : "warn";
  // node.critical marks a priority site, not a fault, so it does not get a halo.
  const halo = node.id === selectedId || cls !== "" || node.warn === true;
  return { cls, halo, priority: node.critical === true };
}

// Crew route and progress.
// The backend gives each team its current position, target and eta (in ticks).
// The kit needs a route that stays fixed for one trip, plus progress along it.
// So the route is captured once when a team goes EN_ROUTE, and progress is derived from the
// backend's own eta: progress = 1 - eta / eta_at_dispatch. No client timer is used.
export class CrewTrips {
  constructor(project) {
    this.project = project; // (lat, lon) => [x, y] in the plane the kit moves in
    this.trips = new Map(); // team id -> { route, eta0, targetKey }
  }

  // Returns { route, progress, moving } for one team, or null when there is nothing to draw.
  update(team) {
    const moving = team.state === "EN_ROUTE" || team.state === "RETURNING";
    const toTarget =
      team.state === "EN_ROUTE" &&
      team.target_lat != null &&
      team.target_lon != null;
    if (!toTarget && team.state !== "RETURNING") {
      this.trips.delete(team.id);
      // The kit's route math needs at least two points; a parked crew is a zero-length route.
      const here = this.project(team.lat, team.lon);
      return { route: [here, here], progress: 0, moving: false };
    }
    const key = `${team.target_lat},${team.target_lon}`;
    let trip = this.trips.get(team.id);
    if (!trip || trip.targetKey !== key) {
      const start = this.project(team.lat, team.lon);
      const end = toTarget
        ? this.project(team.target_lat, team.target_lon)
        : start;
      trip = {
        route: [start, end],
        eta0: Math.max(1, team.eta || 1),
        targetKey: key,
      };
      this.trips.set(team.id, trip);
    }
    const eta = Math.max(0, team.eta ?? trip.eta0);
    const progress = Math.min(1, Math.max(0, 1 - eta / trip.eta0));
    return { route: trip.route, progress, moving };
  }
}

// Chart points from dashboard.history rows: [minutes, value].
export function historyPoints(history, field) {
  const out = [];
  for (const row of history || []) {
    const x = simTimeToMinutes(row.sim_time);
    const y = row[field];
    if (x != null && typeof y === "number" && Number.isFinite(y))
      out.push([x, y]);
  }
  return out;
}
