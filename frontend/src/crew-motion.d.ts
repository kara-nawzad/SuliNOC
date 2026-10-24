// Types for the local JavaScript crew-motion module.
export interface CrewRender {
  x: number;
  y: number;
  heading: number;
  flip: boolean;
  moving: boolean;
  progress: number;
}

/** Remaining route metres -> speed factor from the configured distance bands. */
export function distanceSpeedMultiplier(remainingMeters: number): number;

/** Raw trip progress (0..1) -> eased progress (cosine ramps at both ends). */
export function easeRouteProgress(t: number): number;
export class CrewMotion {
  constructor(opts?: {
    render: (id: number, frame: CrewRender) => void;
    tau?: number;
    yUp?: boolean;
  });
  set(
    id: number,
    track: { route: [number, number][]; progress: number; moving?: boolean },
    now?: number,
  ): void;
  remove(id: number): void;
  setPaused(paused: boolean): void;
  step(now: number): void;
}
