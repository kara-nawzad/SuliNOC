// One place to tune how crews move. crew-motion.js consumes `bands` and
// `ease`; CrewLayer consumes `spread`. Distances are remaining route metres in
// the EPSG:3857 plane the motion module runs in.
export const CREW_MOTION = {
  // Trip distance bands. A crew's remaining route distance picks its travel
  // speed factor: longer trips travel faster so a cross-city dispatch never
  // crawls, short hops stay calm. The speed is interpolated linearly between
  // band edges, so crossing a threshold never produces a speed jump. Beyond
  // the last edge the last speed holds.
  bands: [
    { name: "short", upToMeters: 1500, speed: 1.0 },
    { name: "medium", upToMeters: 4500, speed: 1.2 },
    { name: "long", upToMeters: 9000, speed: 1.45 },
    { name: "veryLong", upToMeters: 15000, speed: 1.6 },
  ],
  // Gentle ease-in at departure and ease-out at arrival: the first and last
  // `ramp` fraction of every trip follows a cosine speed ramp instead of a
  // dead start/stop. 0 disables easing; 0.5 is a full smoothstep.
  ease: {
    ramp: 0.12,
  },
  // Anti-stacking: a parked crew that lands on the same spot as another
  // parked crew is nudged onto a deterministic golden-angle ring so no two
  // trucks ever render exactly on top of each other.
  spread: {
    minSeparationPx: 24,
    radiusPx: 20,
    angleDeg: 137.508,
  },
  // Segmented repair-progress ring drawn just outside a crew's tile while it
  // repairs: `segments` notches light up one by one as the ETA counts down.
  // sizePx is the SVG box; it floats clear of the 30 px marker tile.
  repairRing: {
    segments: 8,
    sizePx: 40,
    radiusPx: 18,
    strokePx: 3,
  },
};
