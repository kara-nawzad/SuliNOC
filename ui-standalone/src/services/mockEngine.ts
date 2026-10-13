/**
 * Browser-side stand-in for the AutoNOC Python backend.
 *
 * This module powers the UI-only build of the command center. It reproduces
 * the shapes and behaviour of the FastAPI service — /api/config, /api/delta
 * snapshots, /api/telemetry/history, /api/history and every /api/control
 * endpoint — from a deterministic in-browser simulation, so the complete
 * screen experience runs with no Python process behind it.
 *
 * It is a faithful *presentation* simulation, not a port of autonoc/engine:
 * every panel, tab, map layer, modal and control behaves as it does against
 * the real backend, but the physics is simplified. Values mirror the engine's
 * committed constants (see autonoc/engine/config.py) so thresholds, palettes,
 * site counts, districts, roads and timings line up with the full stack.
 */
import type {
  AiState,
  Config,
  Cut,
  District,
  FleetState,
  GaugeSpec,
  Incident,
  Kpis,
  LatLng,
  LogEntry,
  NodeData,
  PendingAction,
  PowerSource,
  Ring,
  RunSummary,
  Severity,
  Snapshot,
  Team,
  TelemetryHistory,
  TelemetrySample,
  TelemetryTimeframe,
} from "../types/api";

// ---------------------------------------------------------------- constants
const DEFAULT_SEED = 42;
const TICK_MINUTES = 5;
const TICKS_PER_DAY = 288; // 24 h of 5-minute ticks
const RUN_DAYS = 30;
const HORIZON = RUN_DAYS * TICKS_PER_DAY;
/** Pre-run two and a bit simulated days so the console opens on a world that
 * already has history, weather, traffic shape, active faults and a moving
 * fleet — the same state a live demo reaches after a few minutes. */
const WARMUP_TICKS = 700;
const BASE_TICK_MS = 1000; // one tick per wall-clock second at 1×
const NUM_TEAMS = 10;
const BREAK_EVEN_PRECISION = 0.4375;
const PREDICTION_HORIZON_TICKS = 12; // 60 simulated minutes
const AI_INFERENCE_EVERY_TICKS = 6;
const TIER2_REQUEUE_COOLDOWN_TICKS = 24;
const STANDBY_HORIZON_TICKS = 12;
const TEAM_STEP_M = 28 * (TICK_MINUTES / 60) * 1000; // 2 333 m per tick

const STATUS = {
  HEALTHY: 0,
  CONGESTION: 1,
  OVERHEAT: 2,
  RF: 3,
  POWER: 4,
  BACKHAUL: 5,
} as const;

const STATUS_NAMES: Record<number, string> = {
  0: "In Service",
  1: "PRB Congestion",
  2: "Thermal Overheat",
  3: "VSWR Alarm",
  4: "Power Failure",
  5: "Backhaul Isolated",
};
const STATUS_COLORS: Record<number, string> = {
  0: "#10b981",
  1: "#06b6d4",
  2: "#f59e0b",
  3: "#fb923c",
  4: "#f43f5e",
  5: "#f43f5e",
};
const X733_SEVERITY: Record<number, Severity> = {
  1: "MAJOR",
  2: "MAJOR",
  3: "MAJOR",
  4: "CRITICAL",
  5: "CRITICAL",
};
const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  MAJOR: 1,
  MINOR: 2,
  WARNING: 3,
  INFO: 4,
  CLEARED: 5,
};

const PALETTE = {
  healthy: "#10b981",
  warning: "#f59e0b",
  critical: "#f43f5e",
  fiber: "#06b6d4",
  prediction: "#8b5cf6",
  crew: "#38bdf8",
  muted: "#64748b",
};
const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: PALETTE.critical,
  MAJOR: "#fb923c",
  MINOR: PALETTE.warning,
  WARNING: PALETTE.warning,
  CLEARED: PALETTE.healthy,
  INFO: PALETTE.crew,
};
const POWER_COLORS: Record<PowerSource, string> = {
  Grid: PALETTE.healthy,
  Battery: PALETTE.warning,
  Generator: PALETTE.prediction,
  Solar: PALETTE.fiber,
};
const POWER_ORDER: PowerSource[] = ["Grid", "Battery", "Generator", "Solar"];

// id, name, lat, lon, node_count, clutter_C, colour, grid tier, power type
type AggSpec = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  nodes: number;
  clutter: number;
  color: string;
  tier: "EXPOSED" | "STRONG" | "STRONGEST" | "MEDIUM" | "UNSTABLE";
  pattern: "core" | "line" | "scatter";
  bearing: number;
  radiusKm: number;
};
const AGG_SITES: AggSpec[] = [
  { id: 0, name: "Goizha Mountain", lat: 35.61, lon: 45.46, nodes: 18, clutter: -8.0, color: "#FF6B6B", tier: "EXPOSED", pattern: "line", bearing: 118, radiusKm: 2.2 },
  { id: 1, name: "Grand Millennium", lat: 35.5602, lon: 45.434, nodes: 34, clutter: 3.0, color: "#7F00FF", tier: "STRONG", pattern: "core", bearing: 0, radiusKm: 0.8 },
  { id: 2, name: "Salim Street", lat: 35.5565, lon: 45.4295, nodes: 42, clutter: 3.0, color: "#00F2FE", tier: "STRONGEST", pattern: "core", bearing: 0, radiusKm: 0.75 },
  { id: 3, name: "University", lat: 35.579, lon: 45.355, nodes: 36, clutter: 1.0, color: "#00F5A0", tier: "STRONG", pattern: "line", bearing: 95, radiusKm: 2.6 },
  { id: 4, name: "Sarchinar", lat: 35.583, lon: 45.376, nodes: 28, clutter: -2.0, color: "#FF9600", tier: "MEDIUM", pattern: "scatter", bearing: 0, radiusKm: 1.3 },
  { id: 5, name: "Bakrajo", lat: 35.529, lon: 45.359, nodes: 32, clutter: -2.0, color: "#9D4EDD", tier: "UNSTABLE", pattern: "scatter", bearing: 0, radiusKm: 1.5 },
  { id: 6, name: "Tasluja Road", lat: 35.57, lon: 45.33, nodes: 24, clutter: -5.0, color: "#F8B500", tier: "MEDIUM", pattern: "line", bearing: 105, radiusKm: 2.8 },
  { id: 7, name: "Hawara Barza", lat: 35.5748, lon: 45.4496, nodes: 26, clutter: -1.0, color: "#FFD700", tier: "MEDIUM", pattern: "scatter", bearing: 0, radiusKm: 1.2 },
  { id: 8, name: "Airport", lat: 35.5617, lon: 45.3167, nodes: 22, clutter: -6.0, color: "#4FACFE", tier: "STRONG", pattern: "scatter", bearing: 0, radiusKm: 2.3 },
  { id: 9, name: "Rizgari", lat: 35.545, lon: 45.452, nodes: 38, clutter: 0.0, color: "#77E4C8", tier: "MEDIUM", pattern: "core", bearing: 0, radiusKm: 1.0 },
];

const FARUK_LAT = 35.5552;
const FARUK_LON = 45.4531;
const FARUK_RADIUS_KM = 0.8;

const TEAM_NAMES = [
  "Alpha Response", "Bravo Unit", "Charlie Squad", "Delta Force", "Echo Team",
  "Fox Patrol", "Golf Crew", "Hawk Unit", "Iris Response", "Jade Squad",
];
const TEAM_SKILLS = ["RF", "RF", "RF", "POWER", "POWER", "POWER", "GENERAL", "GENERAL", "GENERAL", "GENERAL"] as const;

const DEPOT: LatLng = [35.55, 45.42];
const EPC_PRIMARY = { name: "SPU University", lat: 35.55, lon: 45.42, backhaul: "fiber" };
const EPC_BACKUP = { name: "Grand Millennium", lat: 35.5602, lon: 45.434, backhaul: "microwave" };
const BOUNDS = { lat_min: 35.509, lat_max: 35.63, lon_min: 45.292, lon_max: 45.485 };

const ROADS: { name: string; path: LatLng[] }[] = [
  { name: "60m Road", path: [[35.579, 45.355], [35.5735, 45.38], [35.568, 45.405], [35.562, 45.423], [35.5602, 45.434]] },
  { name: "Salim Street", path: [[35.551, 45.418], [35.5545, 45.425], [35.5565, 45.4295], [35.559, 45.436], [35.5615, 45.443]] },
  { name: "Tasluja Highway", path: [[35.57, 45.33], [35.566, 45.348], [35.5617, 45.3167]] },
  { name: "Airport Link", path: [[35.5617, 45.3167], [35.559, 45.34], [35.554, 45.362], [35.548, 45.385]] },
  { name: "Ring South", path: [[35.529, 45.359], [35.534, 45.39], [35.54, 45.418], [35.545, 45.452]] },
];

// per district: (amplitude_mult, peak_shift_ticks, base_mult)
const TRAFFIC_PROFILE: Record<number, [number, number, number]> = {
  0: [0.6, 0, 0.7], 1: [1.3, 0, 1.1], 2: [1.4, 0, 1.2], 3: [1.2, -12, 0.9],
  4: [0.9, 36, 0.8], 5: [0.9, 24, 0.9], 6: [0.4, 0, 1.0], 7: [0.7, 30, 0.9],
  8: [1.0, 0, 0.8], 9: [1.1, 24, 1.0],
};
// per district congestion/overheat/RF/power mix (backhaul is cut-driven)
const FAULT_MIX: Record<number, [number, number, number, number]> = {
  0: [0.1, 0.1, 0.55, 0.25], 1: [0.45, 0.2, 0.25, 0.1], 2: [0.5, 0.18, 0.24, 0.08],
  5: [0.28, 0.35, 0.2, 0.17], 6: [0.2, 0.2, 0.45, 0.15],
};
const FAULT_MIX_DEFAULT: [number, number, number, number] = [0.32, 0.24, 0.27, 0.17];
const FAULT_CHANCE_PER_TICK = 0.001;
const GRADUAL_FRACTION = 0.75;
const AMBIGUOUS_FRACTION = 0.25; // share of gradual onsets that self-resolve

const SELF_HEAL_TICKS: Record<number, number> = { 1: 4, 2: 5 };
const REPAIR_TICKS: Record<number, number> = { 1: 4, 2: 5, 3: 12, 4: 24, 5: 18 };
const REPAIR_SKILL: Record<number, "RF" | "POWER" | "GENERAL"> = {
  1: "GENERAL", 2: "GENERAL", 3: "RF", 4: "POWER", 5: "GENERAL",
};

const GRID_DROPOUT: Record<string, number> = {
  STRONGEST: 0.0002, STRONG: 0.0005, MEDIUM: 0.001, UNSTABLE: 0.0045, EXPOSED: 0.0018,
};
const GRID_RESTORE: Record<string, number> = {
  STRONGEST: 0.06, STRONG: 0.04, MEDIUM: 0.025, UNSTABLE: 0.02, EXPOSED: 0.008,
};
const POWER_TYPE_BY_TIER: Record<string, "A" | "B" | "C"> = {
  STRONGEST: "A", STRONG: "A", MEDIUM: "A", UNSTABLE: "B", EXPOSED: "C",
};
const ATS_CRANK_FAIL_CHANCE = 0.04;
const ATS_RECOVER_CHANCE = 0.2;
const FUEL_THEFT_CHANCE = 0.00002;
const BATTERY_TICKS = 72;
const GENERATOR_TICKS = 288;
const SOLAR_START_TICK = 48;
const SOLAR_END_TICK = 240;
const GEN_START_BATTERY_PCT = 10;

const WEATHER_TYPES: { name: string; prob: number; faultMult: number; wind: [number, number] }[] = [
  { name: "Clear", prob: 0.5, faultMult: 1.0, wind: [10, 25] },
  { name: "Wind", prob: 0.18, faultMult: 1.8, wind: [50, 80] },
  { name: "Storm", prob: 0.1, faultMult: 2.5, wind: [70, 100] },
  { name: "Heatwave", prob: 0.12, faultMult: 2.0, wind: [5, 20] },
  { name: "Dust", prob: 0.1, faultMult: 1.4, wind: [30, 60] },
];
const WEATHER_MIN_TICKS = 12;
const WEATHER_MAX_TICKS = 48;
const DUST_MIN_TICKS = 24;
const DUST_MAX_TICKS = 72;

const FIBER_CUT_CHANCE_PER_TICK = 0.08 / TICKS_PER_DAY; // per ring
const CUT_CAUSES = ["construction", "storm", "equipment"] as const;

const GAUGES: Record<string, GaugeSpec> = {
  rsrp: { lo: -130, hi: -50, good: -80, warn: -100, bad: -115, lower_bad: true },
  sinr: { lo: -5, hi: 35, good: 20, warn: 10, bad: 5, lower_bad: true },
  vswr: { lo: 1, hi: 3, good: 1.3, warn: 1.5, bad: 2.0, lower_bad: false },
  cqi: { lo: 0, hi: 15, good: 13, warn: 8, bad: 4, lower_bad: true },
  prb: { lo: 0, hi: 100, good: 60, warn: 85, bad: 95, lower_bad: false },
  throughput: { lo: 0, hi: 300, good: 150, warn: 60, bad: 20, lower_bad: true },
  loss: { lo: 0, hi: 100, good: 1, warn: 5, bad: 15, lower_bad: false },
  latency: { lo: 5, hi: 500, good: 30, warn: 50, bad: 90, lower_bad: false },
  jitter: { lo: 0, hi: 50, good: 3, warn: 5, bad: 8, lower_bad: false },
  temp: { lo: 5, hi: 95, good: 45, warn: 62, bad: 72, lower_bad: false },
  cpu: { lo: 0, hi: 100, good: 60, warn: 75, bad: 90, lower_bad: false },
  dust: { lo: 0, hi: 1, good: 0.15, warn: 0.35, bad: 0.6, lower_bad: false },
  voltage: { lo: 10.5, hi: 13, good: 12.3, warn: 11.8, bad: 11.2, lower_bad: true },
  battery: { lo: 0, hi: 100, good: 80, warn: 50, bad: 20, lower_bad: true },
  fuel: { lo: 0, hi: 100, good: 70, warn: 40, bad: 20, lower_bad: true },
  s11: { lo: -30, hi: -1, good: -20, warn: -14, bad: -10, lower_bad: false },
};

const METRIC_LABELS: Record<string, string> = {
  rsrp: "RSRP", sinr: "SINR", s11: "Return Loss (S11)", vswr: "VSWR",
  cqi: "CQI", prb: "PRB Utilisation", latency: "Latency", jitter: "Jitter",
  loss: "E-RAB Drop Rate", throughput: "User Thr (QCI 9)", temp: "Site Temp",
  cpu: "CPU Load", dust: "Dust / Soiling", power: "Power Source",
  voltage: "Bus Voltage", battery: "Battery Bank", fuel: "DG Fuel",
};

const RAPP_ROLES: Record<string, string> = {
  doctor: "RCA rApp — 3GPP PM/FM correlation",
  oracle: "Predictive Maintenance rApp — time-series telemetry",
  commander: "A1 Policy Enforcement — closed-loop RAN intent",
};

const KM_LAT = 111.32;
const KM_LON = 111.32 * Math.cos((35.56 * Math.PI) / 180);

// ---------------------------------------------------------------- helpers
/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
function stepToward(
  lat1: number, lon1: number, lat2: number, lon2: number, maxStepM: number,
): [number, number, boolean] {
  const dist = haversineM(lat1, lon1, lat2, lon2);
  if (dist <= maxStepM) return [lat2, lon2, true];
  const f = maxStepM / dist;
  return [lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f, false];
}
function interpolate(
  lat1: number, lon1: number, lat2: number, lon2: number, t: number,
): LatLng {
  return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t];
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function randomHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function simTime(tick: number): string {
  const tod = tick % TICKS_PER_DAY;
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  return `D${day} ${String(Math.floor((tod * 5) / 60)).padStart(2, "0")}:${String((tod * 5) % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- sim state
interface SimNode {
  id: string;
  lat: number;
  lon: number;
  agg: number;
  ring: number;
  gen: number;
  critical: boolean;
  /** 0.7..1.3 per-site load multiplier so districts are not uniform. */
  loadBias: number;
  status: number;
  statusTimer: number;
  faultStartedTick: number;
  // scheduled gradual onset (the Oracle's signal)
  schedKind: number;
  schedTick: number;
  onsetTick: number;
  gradual: boolean;
  phantom: boolean; // ambiguous episode: will self-resolve before activation
  throttle: number; // tier-1 mitigation, fraction of load withheld
  // radio + hardware
  rsrp: number;
  sinr: number;
  s11: number;
  latency: number;
  jitter: number;
  loss: number;
  throughput: number;
  temp: number;
  cpu: number;
  load: number;
  dust: number;
  // power
  power: PowerSource;
  gridAvailable: boolean;
  voltage: number;
  battery: number;
  fuel: number;
  atsFailed: boolean;
  // fleet
  dispatched: boolean;
  repairing: boolean;
}

interface SimTeam {
  id: number;
  name: string;
  skill: "RF" | "POWER" | "GENERAL";
  lat: number;
  lon: number;
  state: FleetState;
  target: string | null;
  targetLat: number | null;
  targetLon: number | null;
  repairTicksLeft: number;
  standbyTicksLeft: number;
  missions: number;
  purpose: "repair" | "cut" | "standby" | null;
  cutRing: number | null;
  cutIndex: number | null;
  cutRef: SimCut | null;
  standbyNode: string | null;
  standbyPhantom: boolean;
}

interface SimCut {
  lat: number;
  lon: number;
  seg: string;
  cause: string;
  path: LatLng[];
  startedTick: number;
  dispatched: boolean;
}

interface Verdict {
  p: number;
  cls: number;
}



// ================================================================ the engine
class MockEngine {
  readonly config: Config;
  private rng: () => number;
  private runId = randomHex();
  private resetNotice = false;
  private tick = 0;
  private paused = false;
  private speed = 1;
  private readonly seed: number;
  private autoApproveSeconds = 0;

  private nodes: SimNode[] = [];
  private teams: SimTeam[] = [];
  private ringNodes: string[][] = [];
  private ringPaths: LatLng[][] = [];
  private ringCircumference: number[] = [];
  private ringSegments: { id: string; from: LatLng; to: LatLng }[][] = [];
  private cuts: SimCut[][] = [];
  private weather: { type: string; wind: number; faultMult: number }[][] = [];

  private logs: LogEntry[] = [];
  private history: TelemetrySample[] = [];
  private mttrSamples: number[] = [];
  private stats = {
    injected: 0, masked: 0, repairs: 0, ats_failures: 0,
    fuel_thefts: 0, false_dispatch: 0, acted_upon: 0,
  };
  private preEmpted = 0;
  private crewHoursSaved = 0;

  private aiEnabled = false;
  private aiMode: "off" | "ml" | "rules" = "off";
  private verdicts = new Map<string, Verdict>();
  private pending: PendingAction[] = [];
  private pendingCreated = new Map<number, number>(); // action_id -> wall ms
  private cooldown = new Map<string, number>();
  private nextActionId = 1;

  private summaries: RunSummary[] = [];
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor(seed = DEFAULT_SEED) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.config = MockEngine.buildConfig();
    this.summaries = MockEngine.seedSummaries();
    this.buildWorld();
    for (let i = 0; i < WARMUP_TICKS; i++) this.step();
    this.startClock();
  }

  // ------------------------------------------------------------ world build
  private buildWorld() {
    const rng = mulberry32(this.seed * 7919 + 13);
    this.nodes = [];
    this.cuts = [];
    this.logs = [];
    this.history = [];
    this.mttrSamples = [];
    this.verdicts.clear();
    this.pending = [];
    this.pendingCreated.clear();
    this.cooldown.clear();
    this.stats = {
      injected: 0, masked: 0, repairs: 0, ats_failures: 0,
      fuel_thefts: 0, false_dispatch: 0, acted_upon: 0,
    };
    this.preEmpted = 0;
    this.crewHoursSaved = 0;
    this.tick = 0;

    // -- deterministic site placement, one district at a time
    let idx = 0;
    const byDistrict: SimNode[][] = [];
    for (const site of AGG_SITES) {
      const districtNodes: SimNode[] = [];
      for (let j = 0; j < site.nodes; j++) {
        const [dLat, dLon] = this.placeAround(site, rng);
        const lat = clamp(site.lat + dLat, BOUNDS.lat_min + 0.002, BOUNDS.lat_max - 0.002);
        const lon = clamp(site.lon + dLon, BOUNDS.lon_min + 0.002, BOUNDS.lon_max - 0.002);
        const genRoll = rng();
        const gen = genRoll < 0.15 ? 0 : genRoll < 0.85 ? 1 : 2;
        const critical =
          haversineM(lat, lon, FARUK_LAT, FARUK_LON) < FARUK_RADIUS_KM * 1000;
        const node: SimNode = {
          id: `SLY-eNB-${String(++idx).padStart(3, "0")}`,
          lat, lon, agg: site.id, ring: site.id, gen, critical,
          loadBias: 0.72 + rng() * 0.56,
          status: STATUS.HEALTHY, statusTimer: 0, faultStartedTick: -1,
          schedKind: -1, schedTick: -1, onsetTick: -1, gradual: false,
          phantom: false, throttle: 0,
          rsrp: -85, sinr: 20, s11: -22, latency: 25, jitter: 2.5,
          loss: 0.3, throughput: 150, temp: 32, cpu: 45, load: 0.4, dust: 0,
          power: "Grid", gridAvailable: true, voltage: 12, battery: 100,
          fuel: 100, atsFailed: false, dispatched: false, repairing: false,
        };
        this.nodes.push(node);
        districtNodes.push(node);
      }
      byDistrict.push(districtNodes);
    }

    // -- fiber rings: one per district, members ordered around the hub
    this.ringNodes = [];
    this.ringPaths = [];
    this.ringCircumference = [];
    this.ringSegments = [];
    this.cuts = [];
    for (const site of AGG_SITES) {
      const members = byDistrict[site.id];
      members.sort((a, b) =>
        Math.atan2(a.lon - site.lon, a.lat - site.lat) -
        Math.atan2(b.lon - site.lon, b.lat - site.lat));
      const path: LatLng[] = members.map((n) => [n.lat, n.lon] as LatLng);
      path.push(path[0]); // close the ring
      let circumference = 0;
      const segments: { id: string; from: LatLng; to: LatLng }[] = [];
      for (let i = 0; i < members.length; i++) {
        const from = path[i];
        const to = path[i + 1];
        segments.push({
          id: `R${site.id}-S${i}`,
          from, to,
        });
        circumference += haversineM(from[0], from[1], to[0], to[1]) / 1000;
      }
      this.ringNodes.push(members.map((n) => n.id));
      this.ringPaths.push(path);
      this.ringCircumference.push(circumference);
      this.ringSegments.push(segments);
      this.cuts.push([]);
    }

    // -- maintenance fleet at the depot
    this.teams = TEAM_NAMES.map((name, i) => ({
      id: i, name, skill: TEAM_SKILLS[i],
      lat: DEPOT[0], lon: DEPOT[1], state: "IDLE" as FleetState,
      target: null, targetLat: null, targetLon: null,
      repairTicksLeft: 0, standbyTicksLeft: 0, missions: 0,
      purpose: null, cutRing: null, cutIndex: null, cutRef: null, standbyNode: null,
      standbyPhantom: false,
    }));

    // -- weather timeline per district, covering the whole run
    this.weather = AGG_SITES.map((site) => {
      const wRng = mulberry32(this.seed * 6151 + site.id * 97);
      const timeline: { type: string; wind: number; faultMult: number }[] = [];
      let covered = 0;
      while (covered <= HORIZON) {
        const roll = wRng();
        let acc = 0;
        let picked = WEATHER_TYPES[0];
        for (const wt of WEATHER_TYPES) {
          acc += wt.prob;
          if (roll <= acc) {
            picked = wt;
            break;
          }
        }
        const isDust = picked.name === "Dust";
        const min = isDust ? DUST_MIN_TICKS : WEATHER_MIN_TICKS;
        const max = isDust ? DUST_MAX_TICKS : WEATHER_MAX_TICKS;
        const duration = min + Math.floor(wRng() * (max - min));
        const wind = Math.round(
          picked.wind[0] + wRng() * (picked.wind[1] - picked.wind[0]));
        for (let t = 0; t < duration && covered <= HORIZON; t++, covered++)
          timeline.push({ type: picked.name, wind, faultMult: picked.faultMult });
      }
      return timeline;
    });

    this.recordSample();
  }

  /** District-morphology aware scatter in degrees. */
  private placeAround(site: AggSpec, rng: () => number): [number, number] {
    const rad = (site.bearing * Math.PI) / 180;
    if (site.pattern === "line") {
      const t = (rng() - 0.5) * 2; // -1..1 along the corridor
      const along = t * site.radiusKm;
      const across = (rng() - 0.5) * 0.9; // ±450 m of the axis
      const north = along * Math.cos(rad) - across * Math.sin(rad);
      const east = along * Math.sin(rad) + across * Math.cos(rad);
      return [north / KM_LAT, east / KM_LON];
    }
    const r = site.radiusKm * (site.pattern === "core" ? Math.pow(rng(), 0.55) : Math.sqrt(rng()));
    const angle = rng() * Math.PI * 2;
    const north = r * Math.cos(angle);
    const east = r * Math.sin(angle);
    return [north / KM_LAT, east / KM_LON];
  }

  // ------------------------------------------------------------ server clock
  private startClock() {
    if (this.clock !== null) clearInterval(this.clock);
    const interval = BASE_TICK_MS / Math.max(this.speed, 0.1);
    this.clock = setInterval(() => {
      if (!this.paused) this.step();
    }, interval);
  }

  // ------------------------------------------------------------ one tick
  private step() {
    if (this.tick >= HORIZON - 1) {
      this.resetCompletedRun();
      return;
    }
    this.tick += 1;
    const tick = this.tick;

    // 1. nodes: traffic, faults, power, telemetry
    for (const node of this.nodes) this.updateNode(node, tick);

    // 2. organic fiber cuts (independent rare process)
    for (let ring = 0; ring < this.ringSegments.length; ring++) {
      if (this.cuts[ring].length) continue;
      if (this.rng() < FIBER_CUT_CHANCE_PER_TICK) {
        const segs = this.ringSegments[ring];
        const seg = segs[Math.floor(this.rng() * segs.length)];
        const pos = 0.3 + this.rng() * 0.4;
        const at = interpolate(seg.from[0], seg.from[1], seg.to[0], seg.to[1], pos);
        this.cuts[ring].push({
          lat: at[0], lon: at[1], seg: seg.id,
          cause: CUT_CAUSES[Math.floor(this.rng() * CUT_CAUSES.length)],
          path: [seg.from, seg.to], startedTick: tick, dispatched: false,
        });
        this.log(
          `FIBER CUT ${seg.id} (${this.cuts[ring][0].cause}) — ring ${ring} protection lost`,
          "CRITICAL", null);
      }
    }

    // 3. fleet movement, repairs, dispatch
    this.updateTeams(tick);

    // 4. Commander inference + tier-1 mitigation
    if (this.aiEnabled && tick % AI_INFERENCE_EVERY_TICKS === 0)
      this.runInference(tick);

    // 5. history
    this.recordSample();
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  private updateNode(node: SimNode, tick: number) {
    const site = AGG_SITES[node.agg];
    const wx = this.weather[node.agg][Math.min(tick, HORIZON - 1)];
    const tod = tick % TICKS_PER_DAY;

    // ---- traffic shape (district profile × time of day)
    const [ampMult, peakShift, baseMult] = TRAFFIC_PROFILE[node.agg];
    const peak = 168 + peakShift;
    const wave =
      0.5 + 0.5 * Math.cos((2 * Math.PI * (tod - peak)) / TICKS_PER_DAY);
    const targetLoad = clamp(
      (0.3 + 0.35 * Math.pow(wave, 1.25)) * baseMult * ampMult * node.loadBias *
        (1 - node.throttle), 0.02, 1);
    node.load += (targetLoad - node.load) * 0.3;
    if (node.throttle > 0) node.throttle = Math.max(0, node.throttle - 0.08);

    // ---- fault scheduling / progression
    if (node.status === STATUS.HEALTHY) {
      if (node.schedKind < 0) {
        const genMult = [1.6, 1.0, 0.6][node.gen];
        if (this.rng() < FAULT_CHANCE_PER_TICK * wx.faultMult * genMult) {
          const mix = FAULT_MIX[node.agg] ?? FAULT_MIX_DEFAULT;
          const roll = this.rng();
          let acc = 0;
          let kind: number = STATUS.CONGESTION;
          const kinds = [STATUS.CONGESTION, STATUS.OVERHEAT, STATUS.RF, STATUS.POWER];
          for (let i = 0; i < mix.length; i++) {
            acc += mix[i];
            if (roll <= acc) {
              kind = kinds[i];
              break;
            }
          }
          node.schedKind = kind;
          node.schedTick = tick;
          node.gradual = this.rng() < GRADUAL_FRACTION;
          node.phantom = node.gradual && this.rng() < AMBIGUOUS_FRACTION;
          const window = node.gradual ? 12 + Math.floor(this.rng() * 24) : 0;
          node.onsetTick = tick + window;
          if (!node.gradual) this.activateFault(node, tick);
        }
      } else if (node.gradual) {
        if (tick >= node.onsetTick) {
          if (node.phantom) {
            // ambiguous episode fades away before becoming a fault
            node.schedKind = -1;
          } else {
            this.activateFault(node, tick);
          }
        }
      }
    } else {
      node.statusTimer += 1;
      // self-healing soft faults
      const heal = SELF_HEAL_TICKS[node.status];
      if (heal !== undefined && node.statusTimer >= heal)
        this.restoreNode(node, tick, "soft fault self-cleared");
    }

    const progress = this.faultProgress(node, tick);

    // ---- dust (mechanical, cumulative, washed by storms)
    if (wx.type === "Dust") node.dust = clamp(node.dust + 0.004, 0, 1);
    else if (wx.type === "Storm") node.dust = Math.max(0, node.dust - 0.02);
    else node.dust = Math.max(0, node.dust - 0.001);

    // ---- site power
    this.updatePower(node, site, tick);

    // ---- telemetry readouts
    const n = () => (this.rng() - 0.5) * 2;
    const offline =
      node.status === STATUS.POWER ||
      (node.status === STATUS.BACKHAUL && progress >= 1);
    if (offline) {
      node.rsrp = -128;
      node.sinr = -4.6;
      node.latency = 500;
      node.jitter = 48;
      node.loss = 100;
      node.throughput = 0;
      node.cpu = Math.max(5, node.cpu - 8);
    } else {
      const k = progress; // 0..1 degradation
      node.rsrp = -85 + n() * 4 - 10 * k * (node.status === STATUS.RF ? 1 : 0.3);
      const sinrTarget =
        20 - node.load * 7 - k * (node.status === STATUS.RF ? 18 : 12) + n() * 1.6;
      node.sinr += (sinrTarget - node.sinr) * 0.35;
      const s11Target =
        -22 + node.dust * 3 + k * (node.status === STATUS.RF ? 13 : 0) + n() * 0.7;
      node.s11 += (s11Target - node.s11) * 0.25;
      node.latency = clamp(
        22 + node.load * 34 + k * (node.status === STATUS.CONGESTION ? 420 : 60) + n() * 4,
        8, 500);
      node.jitter = clamp(1.8 + node.load * 2.4 + k * 26 + n() * 0.5, 0.4, 50);
      node.loss = clamp(0.15 + node.load * 1.4 + k * (node.status === STATUS.CONGESTION ? 34 : 6), 0, 100);
      node.throughput = Math.max(0, node.load * 185 * (1 - 0.72 * k) + n() * 6);
      node.cpu = clamp(28 + node.load * 46 + k * 16 + n() * 3, 3, 100);
    }
    const ambient =
      21 +
      13 * Math.cos((2 * Math.PI * (220 + Math.floor(tick / TICKS_PER_DAY) - 196)) / 365) +
      9 * Math.cos((2 * Math.PI * (tod - 180)) / TICKS_PER_DAY) +
      (wx.type === "Heatwave" ? 5 : wx.type === "Storm" ? -2 : 0);
    const tempTarget = clamp(
      ambient + node.cpu * 0.22 + node.dust * 8 +
        progress * (node.status === STATUS.OVERHEAT ? 40 : 0), 5, 95);
    node.temp += (tempTarget - node.temp) * 0.25;
  }

  private faultProgress(node: SimNode, tick: number): number {
    if (node.status === STATUS.HEALTHY) {
      if (node.schedKind < 0 || !node.gradual) return 0;
      const span = Math.max(1, node.onsetTick - node.schedTick);
      return clamp((tick - node.schedTick) / span, 0, 1);
    }
    return clamp(0.6 + node.statusTimer / 10, 0, 1);
  }

  private activateFault(node: SimNode, tick: number) {
    const kind = node.schedKind >= 0 ? node.schedKind : STATUS.CONGESTION;
    node.status = kind;
    node.statusTimer = 0;
    node.faultStartedTick = tick;
    node.schedKind = -1;
    node.gradual = false;
    this.log(
      `${node.id} — ${STATUS_NAMES[kind]}`,
      X733_SEVERITY[kind] ?? "MAJOR", node.id);
  }

  private restoreNode(node: SimNode, _tick: number, reason: string) {
    const wasFaulty = node.status !== STATUS.HEALTHY;
    const wasPowerDown = node.status === STATUS.POWER;
    node.status = STATUS.HEALTHY;
    node.statusTimer = 0;
    node.schedKind = -1;
    node.gradual = false;
    node.dispatched = false;
    node.repairing = false;
    if (wasPowerDown) {
      node.gridAvailable = true;
      node.battery = Math.max(node.battery, 80);
      node.fuel = Math.max(node.fuel, 90);
      node.atsFailed = false;
    }
    if (wasFaulty)
      this.log(`${node.id} restored — ${reason}`, "CLEARED", node.id);
  }

  private updatePower(node: SimNode, site: AggSpec, tick: number) {
    const tod = tick % TICKS_PER_DAY;
    // grid availability per district tier
    if (node.gridAvailable) {
      if (this.rng() < GRID_DROPOUT[site.tier]) node.gridAvailable = false;
    } else if (this.rng() < GRID_RESTORE[site.tier]) {
      node.gridAvailable = true;
      node.atsFailed = false;
    }

    const type = POWER_TYPE_BY_TIER[site.tier];
    const solarWindow = type === "C" && tod >= SOLAR_START_TICK && tod < SOLAR_END_TICK;
    const solarYield = solarWindow ? 1 - node.dust * 0.3 : 0;

    if (node.status === STATUS.POWER) {
      node.power = "Battery";
      node.voltage = 10.6;
      return;
    }
    if (node.gridAvailable && type !== "C") {
      node.power = "Grid";
      node.voltage = 12;
      node.battery = clamp(node.battery + 4, 0, 100);
      return;
    }
    if (solarYield > 0.25) {
      node.power = "Solar";
      node.voltage = 12.4;
      node.battery = clamp(node.battery + 1.2 * solarYield, 0, 100);
      return;
    }
    if (node.battery > GEN_START_BATTERY_PCT) {
      node.power = "Battery";
      node.voltage = 11 + (node.battery / 100) * 1.5;
      node.battery = clamp(node.battery - 100 / BATTERY_TICKS, 0, 100);
      return;
    }
    // battery exhausted: crank the DG (unless the ATS jams)
    if (node.atsFailed) {
      node.power = "Battery";
      node.voltage = 10.8;
      node.battery = clamp(node.battery - 100 / BATTERY_TICKS, 0, 100);
      if (this.rng() < ATS_RECOVER_CHANCE) {
        node.atsFailed = false;
        this.log(`${node.id} ATS recovered — DG cranked, bus restored`, "CLEARED", node.id);
      } else if (node.battery <= 0.5) {
        this.activatePowerFailure(node, "battery exhausted after grid loss");
      }
      return;
    }
    if (node.fuel <= 0.5) {
      node.power = "Battery";
      node.voltage = 10.8;
      node.battery = clamp(node.battery - 100 / BATTERY_TICKS, 0, 100);
      if (node.battery <= 0.5)
        this.activatePowerFailure(node, "battery exhausted, DG out of fuel");
      return;
    }
    if (this.rng() < ATS_CRANK_FAIL_CHANCE) {
      node.atsFailed = true;
      this.stats.ats_failures += 1;
      this.log(
        `${node.id} ATS FAILURE TO CRANK — mains down, DG did not start`,
        "CRITICAL", node.id);
      node.power = "Battery";
      node.voltage = 10.8;
      return;
    }
    node.power = "Generator";
    node.voltage = 12.1;
    node.fuel = clamp(node.fuel - 100 / GENERATOR_TICKS, 0, 100);

    // rare fuel-theft event (only meaningful while the DG is the story)
    if (this.rng() < FUEL_THEFT_CHANCE && node.fuel > 20) {
      const drop = 15 + this.rng() * 10;
      node.fuel = Math.max(0, node.fuel - drop);
      this.stats.fuel_thefts += 1;
      this.log(
        `${node.id} FUEL THEFT — abnormal DG fuel drop detected`,
        "MAJOR", node.id);
    }
  }

  private activatePowerFailure(node: SimNode, cause: string) {
    if (node.status !== STATUS.HEALTHY) return;
    node.status = STATUS.POWER;
    node.statusTimer = 0;
    node.faultStartedTick = this.tick;
    node.schedKind = -1;
    this.log(`${node.id} OFFLINE — ${cause}`, "CRITICAL", node.id);
  }

  // ------------------------------------------------------------ fleet
  private updateTeams(tick: number) {
    // work orders: open fiber cuts + nodes that need a technician
    type Order = {
      kind: "cut" | "node";
      ring?: number;
      cutIndex?: number;
      node?: SimNode;
      lat: number;
      lon: number;
      label: string;
      skill: "RF" | "POWER" | "GENERAL";
      repairTicks: number;
      priority: number;
      sinceTick: number;
    };
    const orders: Order[] = [];
    for (let ring = 0; ring < this.cuts.length; ring++) {
      this.cuts[ring].forEach((cut, i) => {
        if (!cut.dispatched)
          orders.push({
            kind: "cut", ring, cutIndex: i, lat: cut.lat, lon: cut.lon,
            label: `Ring ${ring} fiber cut`, skill: "GENERAL",
            repairTicks: REPAIR_TICKS[STATUS.BACKHAUL],
            priority: 3, sinceTick: cut.startedTick,
          });
      });
    }
    for (const node of this.nodes) {
      if (
        node.status !== STATUS.HEALTHY &&
        !node.dispatched && !node.repairing &&
        ([STATUS.RF, STATUS.POWER, STATUS.BACKHAUL] as number[]).includes(
          node.status,
        )
      )
        orders.push({
          kind: "node", node, lat: node.lat, lon: node.lon,
          label: node.id, skill: REPAIR_SKILL[node.status],
          repairTicks: REPAIR_TICKS[node.status],
          priority: (node.critical ? 3 : 1) *
            (node.status === STATUS.POWER ? 1.6 : 1),
          sinceTick: node.faultStartedTick,
        });
    }

    for (const team of this.teams) {
      switch (team.state) {
        case "IDLE": {
          if (!orders.length) break;
          // best order: skill match first, then priority, then age
          let best = -1;
          let bestScore = -Infinity;
          orders.forEach((order, i) => {
            const mult =
              order.skill === team.skill ? 1 : team.skill === "GENERAL" ? 1.2 : 1.5;
            const score =
              order.priority * 10 / mult + (tick - order.sinceTick) * 0.01;
            if (score > bestScore) {
              bestScore = score;
              best = i;
            }
          });
          const order = orders.splice(best, 1)[0];
          team.state = "EN_ROUTE";
          team.target = order.kind === "cut" ? `Ring ${order.ring} cut` : order.label;
          team.targetLat = order.lat;
          team.targetLon = order.lon;
          team.purpose = order.kind === "cut" ? "cut" : "repair";
          team.cutRing = order.ring ?? null;
          team.cutIndex = order.cutIndex ?? null;
          team.missions += 1;
          if (order.kind === "cut") {
            const cut = this.cuts[order.ring!][order.cutIndex!];
            cut.dispatched = true;
            team.cutRef = cut;
          } else {
            order.node!.dispatched = true;
          }
          this.log(
            `${team.name} dispatched to ${team.target} (${order.skill} · ETA ${this.teamEta(team)} ticks)`,
            "INFO", order.kind === "node" ? order.label : null);
          break;
        }
        case "EN_ROUTE": {
          const [lat, lon, arrived] = stepToward(
            team.lat, team.lon, team.targetLat!, team.targetLon!, TEAM_STEP_M);
          team.lat = lat;
          team.lon = lon;
          if (arrived) {
            if (team.purpose === "standby") {
              team.state = "STANDBY";
              const node = this.nodeById(team.standbyNode!);
              if (node) node.dispatched = true;
            } else if (team.purpose === "cut") {
              team.state = "REPAIRING";
              team.repairTicksLeft = REPAIR_TICKS[STATUS.BACKHAUL];
              this.log(
                `${team.name} on site at ${team.target} — splicing started`,
                "INFO", null);
            } else {
              team.state = "REPAIRING";
              team.repairTicksLeft = REPAIR_TICKS[
                this.nodeById(team.standbyNode ?? team.target ?? "")?.status ??
                STATUS.RF] ?? 12;
              const node = this.nodes.find((n) => n.id === team.target);
              if (node) {
                node.repairing = true;
                this.log(
                  `${team.name} on site at ${node.id} — repair started`,
                  "INFO", node.id);
              } else {
                team.state = "RETURNING";
                team.target = null;
                team.targetLat = DEPOT[0];
                team.targetLon = DEPOT[1];
              }
            }
          }
          break;
        }
        case "REPAIRING": {
          team.repairTicksLeft -= 1;
          if (team.repairTicksLeft <= 0) {
            if (team.purpose === "cut" && team.cutRing !== null && team.cutRef) {
              const ring = team.cutRing;
              const cut = team.cutRef;
              const idx = this.cuts[ring].indexOf(cut);
              if (idx >= 0) {
                this.cuts[ring].splice(idx, 1);
                this.stats.repairs += 1;
                this.mttrSamples.push((tick - cut.startedTick) * TICK_MINUTES);
                this.log(
                  `Fiber cut ${cut.seg} (${cut.cause}) — ring ${ring} repaired`,
                  "CLEARED", null);
                if (this.cuts[ring].length === 0) {
                  for (const id of this.ringNodes[ring]) {
                    const node = this.nodeById(id);
                    if (node && node.status === STATUS.BACKHAUL)
                      this.restoreNode(node, tick, "fiber path restored");
                  }
                }
              }
            } else {
              const node = this.nodeById(team.standbyNode ?? team.target ?? "");
              if (node && node.status !== STATUS.HEALTHY) {
                this.stats.repairs += 1;
                this.mttrSamples.push(
                  Math.max(1, (tick - node.faultStartedTick) * TICK_MINUTES));
                if (node.status === STATUS.POWER) {
                  node.gridAvailable = true;
                  node.battery = 85;
                  node.fuel = 95;
                  node.atsFailed = false;
                }
                this.restoreNode(node, tick, `${team.name} completed repair`);
              }
            }
            team.state = "RETURNING";
            team.target = null;
            team.targetLat = DEPOT[0];
            team.targetLon = DEPOT[1];
            team.purpose = null;
            team.cutRing = null;
            team.cutIndex = null;
            team.cutRef = null;
            team.standbyNode = null;
          }
          break;
        }
        case "STANDBY": {
          team.standbyTicksLeft -= 1;
          const node = this.nodeById(team.standbyNode ?? "");
          if (node && node.status !== STATUS.HEALTHY) {
            // prediction landed while the crew was holding on site
            this.stats.repairs += 1;
            this.restoreNode(node, tick, `${team.name} on site — immediate repair`);
            team.state = "RETURNING";
            team.targetLat = DEPOT[0];
            team.targetLon = DEPOT[1];
            team.standbyNode = null;
            break;
          }
          if (team.standbyTicksLeft <= 0) {
            if (team.standbyPhantom) {
              this.stats.false_dispatch += 1;
              this.log(
                `${team.name} released from ${team.standbyNode} — prediction did not materialise`,
                "WARNING", team.standbyNode);
            }
            if (node) node.dispatched = false;
            team.state = "RETURNING";
            team.target = null;
            team.targetLat = DEPOT[0];
            team.targetLon = DEPOT[1];
            team.standbyNode = null;
            team.purpose = null;
          }
          break;
        }
        case "RETURNING": {
          const [lat, lon, arrived] = stepToward(
            team.lat, team.lon, DEPOT[0], DEPOT[1], TEAM_STEP_M);
          team.lat = lat;
          team.lon = lon;
          if (arrived) {
            team.state = "IDLE";
            team.target = null;
            team.targetLat = null;
            team.targetLon = null;
            team.purpose = null;
          }
          break;
        }
      }
    }
  }

  private teamEta(team: SimTeam): number {
    if (team.state === "REPAIRING") return Math.max(0, team.repairTicksLeft);
    if (team.state === "STANDBY") return Math.max(0, team.standbyTicksLeft);
    if (team.targetLat === null || team.targetLon === null) return 0;
    return Math.ceil(
      haversineM(team.lat, team.lon, team.targetLat, team.targetLon) / TEAM_STEP_M);
  }

  private nodeById(id: string): SimNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  // ------------------------------------------------------------ commander
  private runInference(tick: number) {
    const next = new Map<string, Verdict>();
    for (const node of this.nodes) {
      if (node.status !== STATUS.HEALTHY) continue;
      if (
        node.schedKind >= 0 && node.gradual &&
        node.onsetTick - tick <= PREDICTION_HORIZON_TICKS
      ) {
        const progress = this.faultProgress(node, tick);
        next.set(node.id, {
          p: clamp(0.22 + 0.72 * progress + this.rng() * 0.06, 0.05, 0.98),
          cls: node.schedKind,
        });
      } else if (this.rng() < 0.02) {
        next.set(node.id, { p: 0.02 + this.rng() * 0.3, cls: STATUS.CONGESTION });
      }
    }
    this.verdicts = next;

    // tier-1 autonomous soft mitigation for very high, soft-class risks
    for (const [id, verdict] of next) {
      if (
        verdict.p > 0.75 &&
        (verdict.cls === STATUS.CONGESTION || verdict.cls === STATUS.OVERHEAT)
      ) {
        const node = this.nodeById(id);
        if (!node || node.schedKind < 0) continue;
        if ((this.cooldown.get(id) ?? -999) > tick) continue;
        const action = verdict.cls === STATUS.CONGESTION ? "throttled" : "rebooted";
        node.schedKind = -1;
        node.throttle = 0.5;
        node.temp = Math.min(node.temp, 62);
        this.stats.masked += 1;
        this.stats.acted_upon += 1;
        this.cooldown.set(id, tick + TIER2_REQUEUE_COOLDOWN_TICKS);
        this.log(
          `AI: ${id} ${action} — ${STATUS_NAMES[verdict.cls]} pre-empted (tier-1 mitigation)`,
          "CLEARED", id);
        next.delete(id);
      }
    }

    // tier-2 crew pre-dispatch proposals await human approval
    const candidates = [...next.entries()]
      .filter(([id, v]) => {
        const node = this.nodeById(id);
        return (
          v.p > BREAK_EVEN_PRECISION && node && node.status === STATUS.HEALTHY &&
          !this.pending.some((a) => a.node_id === id) &&
          (this.cooldown.get(id) ?? -999) <= tick
        );
      })
      .sort((a, b) => b[1].p - a[1].p);
    for (const [id, verdict] of candidates) {
      if (this.pending.length >= 3) break;
      const node = this.nodeById(id)!;
      this.pending.push({
        action_id: this.nextActionId++,
        node_id: id,
        node: id,
        cls: verdict.cls,
        probability: verdict.p,
        action: "pre-dispatch",
        tier: 2,
        label: `${STATUS_NAMES[verdict.cls]} risk — pre-position a crew`,
        created_tick: tick,
        state: "pending",
      });
      this.pendingCreated.set(this.nextActionId - 1, performance.now());
      this.cooldown.set(id, tick + TIER2_REQUEUE_COOLDOWN_TICKS);
      this.log(
        `AI: pre-dispatch ${id} proposed (p = ${verdict.p.toFixed(2)}, ${STATUS_NAMES[verdict.cls]})`,
        "WARNING", id);
      node.throttle = 0; // tier-2 waits for the operator
    }
  }

  approveAction(actionId: number): { ok: boolean; late?: boolean; reason?: string } {
    const index = this.pending.findIndex((a) => a.action_id === actionId);
    if (index < 0)
      return { ok: false, reason: "This recommendation has already been decided." };
    const action = this.pending.splice(index, 1)[0];
    this.pendingCreated.delete(actionId);
    const node = this.nodeById(action.node_id);
    if (!node) return { ok: false, reason: "Site no longer exists." };
    this.cooldown.set(node.id, this.tick + TIER2_REQUEUE_COOLDOWN_TICKS);

    if (node.status !== STATUS.HEALTHY) {
      // reactive dispatch is already handling the site
      this.log(
        `Approval ${action.action_id} late — ${node.id} already faulty; reactive dispatch continues`,
        "WARNING", node.id);
      return { ok: true, late: true };
    }
    const phantom = node.schedKind < 0 || node.phantom;
    const kind = node.schedKind >= 0 ? node.schedKind : action.cls;
    if (node.schedKind >= 0 && !node.phantom) {
      // pre-emption: the predicted episode never activates
      node.schedKind = -1;
      node.gradual = false;
      this.preEmpted += 1;
      this.stats.acted_upon += 1;
      this.crewHoursSaved += (REPAIR_TICKS[kind] ?? 4) * TICK_MINUTES / 60;
      this.log(
        `AI: pre-empted ${STATUS_NAMES[kind]} on ${node.id} — ${"crew pre-positioned"}`,
        "CLEARED", node.id);
    } else {
      this.log(
        `AI: pre-dispatch ${node.id} approved (p = ${action.probability.toFixed(2)})`,
        "WARNING", node.id);
    }

    // send the closest free team to hold on site
    const team =
      this.teams
        .filter((t) => t.state === "IDLE")
        .sort((a, b) =>
          haversineM(a.lat, a.lon, node.lat, node.lon) -
          haversineM(b.lat, b.lon, node.lat, node.lon))[0] ??
      this.teams
        .filter((t) => t.state === "RETURNING")
        .sort((a, b) =>
          haversineM(a.lat, a.lon, node.lat, node.lon) -
          haversineM(b.lat, b.lon, node.lat, node.lon))[0];
    if (team) {
      team.state = "EN_ROUTE";
      team.target = node.id;
      team.targetLat = node.lat;
      team.targetLon = node.lon;
      team.purpose = "standby";
      team.standbyNode = node.id;
      team.standbyTicksLeft = STANDBY_HORIZON_TICKS;
      team.standbyPhantom = phantom;
      team.missions += 1;
      this.log(
        `${team.name} PRE-DISPATCHED to ${node.id} (p = ${action.probability.toFixed(2)})`,
        "INFO", node.id);
    } else {
      this.log(`PRE-DISPATCH ${node.id} deferred — fleet busy`, "WARNING", node.id);
    }
    return { ok: true };
  }

  vetoAction(actionId: number): { ok: boolean; reason?: string } {
    const index = this.pending.findIndex((a) => a.action_id === actionId);
    if (index < 0)
      return { ok: false, reason: "This recommendation has already been decided." };
    const action = this.pending.splice(index, 1)[0];
    this.pendingCreated.delete(actionId);
    this.cooldown.set(action.node_id, this.tick + TIER2_REQUEUE_COOLDOWN_TICKS);
    this.log(
      `VETOED action ${action.action_id} (${action.node_id})`,
      "WARNING", action.node_id);
    return { ok: true };
  }

  // ------------------------------------------------------------ logging
  private log(message: string, severity: Severity, nodeId: string | null) {
    this.logs.push({
      tick: this.tick,
      time: simTime(this.tick),
      severity,
      message,
      node_id: nodeId,
    });
  }

  // ------------------------------------------------------------ samples
  private buildSample(): TelemetrySample {
    const total = this.nodes.length;
    let healthy = 0;
    let offline = 0;
    let throughput = 0;
    let lossSum = 0;
    let prbSum = 0;
    for (const node of this.nodes) {
      if (node.status === STATUS.HEALTHY) healthy += 1;
      if (node.status === STATUS.POWER || node.status === STATUS.BACKHAUL)
        offline += 1;
      throughput += node.throughput;
      lossSum += node.loss;
      prbSum += this.prbOf(node);
    }
    return {
      tick: this.tick,
      sim_time: simTime(this.tick),
      availability: Math.round((healthy / total) * 10000) / 100,
      incidents: this.buildIncidents().length,
      power_events: this.stats.ats_failures + this.stats.fuel_thefts,
      throughput_gbps: Math.round((throughput / 1000) * 1000) / 1000,
      drop_rate: Math.round((lossSum / total) * 1000) / 1000,
      prb: Math.round((prbSum / total) * 100) / 100,
      online: healthy,
      degraded: total - healthy - offline,
      offline,
    };
  }

  private recordSample() {
    const sample = this.buildSample();
    const last = this.history[this.history.length - 1];
    if (last && last.tick === sample.tick) this.history[this.history.length - 1] = sample;
    else this.history.push(sample);
    if (this.history.length > 7 * TICKS_PER_DAY + 1)
      this.history.splice(0, this.history.length - (7 * TICKS_PER_DAY + 1));
  }

  private prbOf(node: SimNode): number {
    let prb = node.load * 100;
    if (node.status === STATUS.CONGESTION)
      prb = Math.max(prb, 85 + 14 * this.faultProgress(node, this.tick));
    return Math.min(100, prb);
  }

  private buildIncidents(): Incident[] {
    const result: Incident[] = [];
    const claimed = new Set<string>();
    this.cuts.forEach((cuts, ring) => {
      if (!cuts.length) return;
      const affected = this.ringNodes[ring].filter(
        (id) => this.nodeById(id)?.status === STATUS.BACKHAUL);
      affected.forEach((id) => claimed.add(id));
      result.push({
        id: `ring-${ring}`,
        node_id: null,
        title: cuts.length >= 2 ? "Fiber ring isolated" : "Fiber protection lost",
        detail: `Ring ${String(ring).padStart(2, "0")} · ${cuts.length} open cut(s)`,
        severity: cuts.length >= 2 ? "CRITICAL" : "MINOR",
        affected: affected.length,
        since_tick: Math.min(...cuts.map((c) => c.startedTick)),
        dispatched: cuts.some((c) => c.dispatched),
      });
    });
    for (const node of this.nodes) {
      if (node.status !== STATUS.HEALTHY && !claimed.has(node.id)) {
        result.push({
          id: `node-${node.id}-${node.faultStartedTick}`,
          node_id: node.id,
          title: STATUS_NAMES[node.status],
          detail: AGG_SITES[node.agg].name,
          severity: X733_SEVERITY[node.status] ?? "MAJOR",
          affected: 1,
          since_tick: Math.max(0, node.faultStartedTick),
          dispatched: node.dispatched,
        });
      }
      if (node.atsFailed) {
        result.push({
          id: `ats-${node.id}`,
          node_id: node.id,
          title: "ATS failure to crank",
          detail: "Generator transfer switch",
          severity: "CRITICAL",
          affected: 1,
          since_tick: this.tick,
          dispatched: node.dispatched,
        });
      }
    }
    return result.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.since_tick - b.since_tick ||
        a.id.localeCompare(b.id));
  }

  // ------------------------------------------------------------ payloads
  private buildKpis(): Kpis {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let gridFailures = 0;
    for (const node of this.nodes) {
      counts[node.status] += 1;
      if (!node.gridAvailable) gridFailures += 1;
    }
    const mttr = this.mttrSamples.length
      ? this.mttrSamples.reduce((a, b) => a + b, 0) / this.mttrSamples.length
      : 0;
    return {
      tick: this.tick,
      sim_time: simTime(this.tick),
      availability: Math.round((counts[0] / this.nodes.length) * 10000) / 100,
      healthy: counts[0],
      congestion: counts[1],
      overheat: counts[2],
      rf: counts[3],
      power: counts[4],
      backhaul: counts[5],
      active_teams: this.teams.filter((t) => t.state !== "IDLE").length,
      grid_failures: gridFailures,
      mttr_min: Math.round(mttr * 10) / 10,
      injected: this.stats.injected,
      masked: this.stats.masked,
      repairs: this.stats.repairs,
      ats_failures: this.stats.ats_failures,
      fuel_thefts: this.stats.fuel_thefts,
    };
  }

  private buildDashboard(): Snapshot["dashboard"] {
    const current = this.buildSample();
    const rows = this.history.slice(-30);
    const hourAgo = this.history.filter((r) => r.tick <= this.tick - 12).at(-1);
    const trafficChange =
      hourAgo && hourAgo.throughput_gbps > 0
        ? Math.round((current.throughput_gbps / hourAgo.throughput_gbps - 1) * 1000) / 10
        : null;
    const top = [...this.nodes]
      .sort((a, b) => this.prbOf(b) - this.prbOf(a) || this.cqiOf(a) - this.cqiOf(b))
      .slice(0, 4);
    const forecasts = [...this.verdicts.entries()]
      .map(([id, v]) => {
        const node = this.nodeById(id);
        return node && node.status === STATUS.HEALTHY
          ? {
              node_id: id,
              probability: v.p,
              label: STATUS_NAMES[v.cls] ?? "Unclassified",
              actionable: v.p > BREAK_EVEN_PRECISION,
            }
          : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => b.probability - a.probability || a.node_id.localeCompare(b.node_id));
    const powerCounts = new Map<PowerSource, number>();
    for (const node of this.nodes)
      powerCounts.set(node.power, (powerCounts.get(node.power) ?? 0) + 1);
    const fleet: Record<FleetState, number> = {
      IDLE: 0, EN_ROUTE: 0, STANDBY: 0, REPAIRING: 0, RETURNING: 0,
    };
    for (const team of this.teams) fleet[team.state] += 1;
    return {
      current,
      history: rows,
      traffic_change_pct: trafficChange,
      operational_pct: current.availability,
      incidents: this.buildIncidents(),
      top_cells: top.map((node) => ({
        node_id: node.id,
        district: AGG_SITES[node.agg].name,
        prb: Math.round(this.prbOf(node) * 10) / 10,
        cqi: this.cqiOf(node),
        status: node.status,
      })),
      forecast: this.aiEnabled ? (forecasts[0] ?? null) : null,
      actionable_predictions: forecasts.filter((f) => f.actionable).length,
      power: POWER_ORDER.map((name) => ({
        name,
        count: powerCounts.get(name) ?? 0,
        fraction: (powerCounts.get(name) ?? 0) / Math.max(1, this.nodes.length),
      })),
      active_ats: this.nodes.filter((n) => n.atsFailed).length,
      fuel_thefts: this.stats.fuel_thefts,
      fleet,
    };
  }

  private cqiOf(node: SimNode): number {
    const frac = clamp((node.sinr + 5) / 25, 0, 1);
    return Math.round(frac * 15);
  }

  private buildNodes(): NodeData[] {
    return this.nodes.map((node) => {
      const gamma = Math.min(Math.pow(10, node.s11 / 20), 0.98);
      const verdict = this.aiEnabled ? this.verdicts.get(node.id) : undefined;
      return {
        id: node.id,
        lat: Math.round(node.lat * 1e6) / 1e6,
        lon: Math.round(node.lon * 1e6) / 1e6,
        agg: node.agg,
        ring: node.ring,
        gen: node.gen,
        critical: node.critical,
        status: node.status,
        rsrp: Math.round(node.rsrp * 10) / 10,
        sinr: Math.round(node.sinr * 10) / 10,
        s11: Math.round(node.s11 * 10) / 10,
        latency: Math.round(node.latency * 10) / 10,
        jitter: Math.round(node.jitter * 100) / 100,
        loss: Math.round(node.loss * 100) / 100,
        throughput: Math.round(node.throughput * 10) / 10,
        temp: Math.round(node.temp * 10) / 10,
        cpu: Math.round(node.cpu * 10) / 10,
        vswr: Math.round(((1 + gamma) / (1 - gamma)) * 100) / 100,
        cqi: this.cqiOf(node),
        prb: Math.round(this.prbOf(node) * 10) / 10,
        power: node.power,
        pwr: POWER_TYPE_BY_TIER[AGG_SITES[node.agg].tier],
        voltage: Math.round(node.voltage * 100) / 100,
        battery: Math.round(node.battery * 10) / 10,
        fuel: Math.round(node.fuel * 10) / 10,
        ats: node.atsFailed,
        dust: Math.round(node.dust * 1000) / 1000,
        dispatched: node.dispatched,
        repairing: node.repairing,
        warn: !!(
          verdict &&
          node.status === STATUS.HEALTHY &&
          verdict.p > BREAK_EVEN_PRECISION
        ),
      };
    });
  }

  private buildDistricts(): District[] {
    const wxTick = Math.min(this.tick, HORIZON - 1);
    return AGG_SITES.map((site) => {
      const members = this.nodes.filter((n) => n.agg === site.id);
      const ok = members.filter((n) => n.status === STATUS.HEALTHY).length;
      const wx = this.weather[site.id][wxTick];
      return {
        id: site.id,
        name: site.name,
        lat: site.lat,
        lon: site.lon,
        color: site.color,
        node_count: members.length,
        health: members.length
          ? Math.round((ok / members.length) * 1000) / 10
          : 100,
        weather: wx.type,
        wind: wx.wind,
        clutter: site.clutter,
        pwr: POWER_TYPE_BY_TIER[site.tier],
      };
    });
  }

  private buildRings(): Ring[] {
    return this.ringNodes.map((ids, ring) => {
      const cuts = this.cuts[ring];
      const cutPayload: Cut[] = cuts.map((c) => ({
        lat: c.lat, lon: c.lon, seg: c.seg, cause: c.cause, path: c.path,
      }));
      const first = cuts[0];
      return {
        id: ring,
        nodes: ids,
        path: this.ringPaths[ring],
        circumference_km:
          Math.round(this.ringCircumference[ring] * 100) / 100,
        cut: first
          ? { lat: first.lat, lon: first.lon, seg: first.seg, cause: first.cause }
          : null,
        cuts: cutPayload,
        isolated: cuts.length >= 2,
      };
    });
  }

  private buildTeams(): Team[] {
    return this.teams.map((team) => ({
      id: team.id,
      name: team.name,
      skill: team.skill,
      lat: Math.round(team.lat * 1e6) / 1e6,
      lon: Math.round(team.lon * 1e6) / 1e6,
      state: team.state,
      available: team.state === "IDLE",
      target: team.target,
      target_lat: team.targetLat,
      target_lon: team.targetLon,
      eta: this.teamEta(team),
      missions: team.missions,
    }));
  }

  private buildAi(): AiState {
    const now = performance.now();
    const pending = this.pending.map((action) => {
      const created = this.pendingCreated.get(action.action_id);
      const eta =
        this.autoApproveSeconds > 0 && created !== undefined
          ? Math.max(
              0,
              this.autoApproveSeconds - (now - created) / 1000)
          : undefined;
      return eta === undefined ? action : { ...action, eta };
    });
    const denom = this.preEmpted + this.stats.false_dispatch;
    return {
      ai_enabled: this.aiEnabled,
      ai_mode: this.aiMode,
      ai_policy: "auto",
      pre_empted: this.preEmpted,
      acted_upon: this.stats.acted_upon,
      false_dispatches: this.stats.false_dispatch,
      precision: denom ? this.preEmpted / denom : null,
      break_even_precision: BREAK_EVEN_PRECISION,
      crew_hours_saved: Math.round(this.crewHoursSaved * 10) / 10,
      unpredictable_pct: 25,
      pending,
    };
  }

  snapshot(): Snapshot {
    // wall-clock auto-approval, exactly like the API worker's timer
    if (this.autoApproveSeconds > 0 && this.pending.length) {
      for (const action of [...this.pending])
        if (this.buildAiEta(action.action_id) <= 0) this.approveAction(action.action_id);
    }
    return {
      run_id: this.runId,
      reset_notice: this.resetNotice,
      run_error: null,
      tick: this.tick,
      resync: true,
      kpis: this.buildKpis(),
      control: {
        paused: this.paused,
        speed: this.speed,
        seed: this.seed,
        auto_approve_seconds: this.autoApproveSeconds,
      },
      nodes: this.buildNodes(),
      teams: this.buildTeams(),
      agg: this.buildDistricts(),
      rings: this.buildRings(),
      logs: this.logs.slice(-60),
      ai: this.buildAi(),
      dashboard: this.buildDashboard(),
    };
  }

  private buildAiEta(actionId: number): number {
    const created = this.pendingCreated.get(actionId);
    if (created === undefined || this.autoApproveSeconds <= 0) return Infinity;
    return this.autoApproveSeconds - (performance.now() - created) / 1000;
  }

  telemetryHistory(
    timeframe: TelemetryTimeframe,
    runId: string,
  ): TelemetryHistory {
    if (runId !== this.runId)
      throw new Error(
        "This control belongs to an earlier demo. Refresh the dashboard and try again.");
    const minutes = { "30m": 30, "24h": 1440, "7d": 10080 }[timeframe];
    const sampleCount = Math.floor(minutes / TICK_MINUTES) + 1;
    const current = this.buildSample();
    const previous = this.history.filter((r) => r.tick < this.tick).slice(-(sampleCount - 1));
    return {
      run_id: this.runId,
      timeframe,
      tick_minutes: TICK_MINUTES,
      samples: [...previous, current],
    };
  }

  runHistory(): RunSummary[] {
    return this.summaries;
  }

  // ------------------------------------------------------------ controls
  private assertRun(runId: string) {
    if (runId !== this.runId)
      throw new Error(
        "This control belongs to an earlier demo. Refresh the dashboard and try again.");
  }
  pause(runId: string) {
    this.assertRun(runId);
    this.paused = true;
    return { ok: true, paused: true };
  }
  resume(runId: string) {
    this.assertRun(runId);
    this.paused = false;
    return { ok: true, paused: false };
  }
  stepOnce(runId: string) {
    this.assertRun(runId);
    if (!this.paused) throw new Error("Pause the simulation before stepping.");
    this.step();
    return { ok: true, tick: this.tick };
  }
  setSpeed(value: number, runId: string) {
    this.assertRun(runId);
    this.speed = value;
    this.startClock();
    return { ok: true, speed: this.speed };
  }
  inject(nodeId: string, kind: number, runId: string) {
    this.assertRun(runId);
    const node = this.nodeById(nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);
    if (node.status !== STATUS.HEALTHY)
      throw new Error(`${nodeId} already faulty`);
    node.schedKind = kind;
    node.schedTick = this.tick;
    node.gradual = false;
    node.onsetTick = this.tick;
    node.phantom = false;
    this.activateFault(node, this.tick);
    this.stats.injected += 1;
    return { ok: true, node: nodeId, status: kind };
  }
  cutFiber(ringId: number, runId: string) {
    this.assertRun(runId);
    const ring = ((ringId % this.ringSegments.length) + this.ringSegments.length) %
      this.ringSegments.length;
    const segments = this.ringSegments[ring];
    if (!segments.length)
      return { ok: false, reason: "ring has no segments" };
    const made: string[] = [];
    for (let k = 0; k < 2; k++) {
      if (this.cuts[ring].length >= 2) break;
      const seg = segments[(k * 3 + 1) % segments.length];
      const pos = 0.35 + 0.3 * k;
      const at = interpolate(seg.from[0], seg.from[1], seg.to[0], seg.to[1], pos);
      this.cuts[ring].push({
        lat: at[0], lon: at[1], seg: seg.id, cause: "construction",
        path: [seg.from, seg.to], startedTick: this.tick, dispatched: false,
      });
      made.push(seg.id);
    }
    let dark = 0;
    if (this.cuts[ring].length >= 2) {
      for (const id of this.ringNodes[ring]) {
        const node = this.nodeById(id);
        if (node && node.status === STATUS.HEALTHY) {
          node.status = STATUS.BACKHAUL;
          node.statusTimer = 0;
          node.faultStartedTick = this.tick;
          dark += 1;
        }
      }
    }
    this.log(
      `FIBER CUT ${made.join(" + ")} (construction) — ring ${ring} ${this.cuts[ring].length >= 2 ? `isolated (${dark} sites dark)` : "protection lost"}`,
      "CRITICAL", null);
    return { ok: true, ring, segments: made, dark };
  }
  setAi(enabled: boolean, runId: string, autoApproveSeconds = 0) {
    this.assertRun(runId);
    this.aiEnabled = enabled;
    this.aiMode = enabled ? "ml" : "off";
    this.autoApproveSeconds = enabled ? autoApproveSeconds : 0;
    if (!enabled) {
      this.verdicts.clear();
      this.pending = [];
      this.pendingCreated.clear();
    }
    return { ok: true, ai_enabled: enabled, auto_approve_seconds: this.autoApproveSeconds };
  }

  // ------------------------------------------------------------ run reset
  private resetCompletedRun() {
    const summary = this.buildRunSummary();
    this.summaries.unshift(summary);
    if (this.summaries.length > 10) this.summaries.pop();
    const keepPaused = this.paused;
    this.buildWorld();
    this.runId = randomHex();
    this.resetNotice = true;
    this.paused = keepPaused;
    for (let i = 0; i < WARMUP_TICKS; i++) this.step();
    this.startClock();
  }

  private buildRunSummary(): RunSummary {
    const kpis = this.buildKpis();
    const ai = this.buildAi();
    return {
      completed_at: new Date().toISOString(),
      simulated_days: RUN_DAYS,
      completed_sim_time: simTime(this.tick),
      seed: this.seed,
      availability: kpis.availability,
      injected: kpis.injected,
      masked: kpis.masked,
      repairs: kpis.repairs,
      mttr_min: kpis.mttr_min,
      ats_failures: kpis.ats_failures,
      fuel_thefts: kpis.fuel_thefts,
      active_incidents: this.buildIncidents().length,
      ai_enabled: this.aiEnabled,
      ai_mode: this.aiMode,
      pre_empted: ai.pre_empted,
      acted_upon: ai.acted_upon,
      false_dispatches: ai.false_dispatches,
      crew_hours_saved: ai.crew_hours_saved,
      precision: ai.precision,
    };
  }

  /** Two finished demos so the History modal's "Completed demos" tab has
   * content on first open, in the same shape the summary store persists. */
  private static seedSummaries(): RunSummary[] {
    const ago = (hours: number) =>
      new Date(Date.now() - hours * 3600_000).toISOString();
    return [
      {
        completed_at: ago(26),
        simulated_days: RUN_DAYS,
        completed_sim_time: "D30 23:55",
        seed: 131,
        availability: 98.88,
        injected: 41,
        masked: 236,
        repairs: 1289,
        mttr_min: 74.2,
        ats_failures: 19,
        fuel_thefts: 44,
        active_incidents: 0,
        ai_enabled: true,
        ai_mode: "ml",
        pre_empted: 451,
        acted_upon: 692,
        false_dispatches: 4,
        crew_hours_saved: 1894.2,
        precision: 0.9912,
      },
      {
        completed_at: ago(98),
        simulated_days: RUN_DAYS,
        completed_sim_time: "D30 23:55",
        seed: 42,
        availability: 98.76,
        injected: 12,
        masked: 0,
        repairs: 1301,
        mttr_min: 79.6,
        ats_failures: 21,
        fuel_thefts: 39,
        active_incidents: 0,
        ai_enabled: false,
        ai_mode: "off",
        pre_empted: 0,
        acted_upon: 0,
        false_dispatches: 0,
        crew_hours_saved: 0,
        precision: null,
      },
    ];
  }

  // ------------------------------------------------------------ static config
  private static buildConfig(): Config {
    return {
      status_names: STATUS_NAMES,
      status_colors: STATUS_COLORS,
      thresholds: {
        rsrp: -100, s11: -10, s11_high_wind: -13, temp: 72,
        packet_loss: 15, cpu: 90,
      },
      metric_labels: METRIC_LABELS,
      gauges: GAUGES,
      x733_severity: X733_SEVERITY,
      power_configs: {
        A: "Grid + Standby DG",
        B: "Hybrid DG + VRLA Bank",
        C: "Off-Grid Solar PV + LFP + DG",
      },
      vswr_alarm: 1.5,
      rapp_roles: RAPP_ROLES,
      map_center: [
        (BOUNDS.lat_min + BOUNDS.lat_max) / 2,
        (BOUNDS.lon_min + BOUNDS.lon_max) / 2,
      ],
      map_zoom: 12,
      bounds: BOUNDS,
      epc_primary: EPC_PRIMARY,
      epc_backup: EPC_BACKUP,
      depot: { lat: DEPOT[0], lon: DEPOT[1] },
      agg_sites: AGG_SITES.map((s) => ({
        id: s.id, name: s.name, lat: s.lat, lon: s.lon, nodes: s.nodes,
        clutter: s.clutter, color: s.color,
      })),
      num_nodes: AGG_SITES.reduce((sum, s) => sum + s.nodes, 0),
      num_teams: NUM_TEAMS,
      tick_minutes: TICK_MINUTES,
      break_even_precision: BREAK_EVEN_PRECISION,
      presentation: {
        roads: ROADS,
        network_name: "Sulaymaniyah",
        region_label: "IRAQ / SUL",
        palette: PALETTE,
        severity_colors: SEVERITY_COLORS,
        power_colors: POWER_COLORS,
        healthy_status: STATUS.HEALTHY,
        offline_statuses: [STATUS.POWER, STATUS.BACKHAUL],
        poll_ms: 1000,
        history_ticks: 30,
        prediction_horizon_min: PREDICTION_HORIZON_TICKS * TICK_MINUTES,
        speed_min: 0.25,
        speed_max: 10,
        fault_options: [1, 2, 3, 4, 5].map((value) => ({
          value, label: STATUS_NAMES[value],
        })),
        generation_names: { 0: "Legacy", 1: "Standard", 2: "Modernised" },
      },
    };
  }
}

/** Singleton: constructed on first import, clock starts immediately —
 * exactly like the FastAPI lifespan task owning the server-side clock. */
export const mockEngine = new MockEngine(DEFAULT_SEED);
