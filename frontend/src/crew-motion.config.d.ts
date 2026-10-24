// Types for the local JavaScript crew-motion config module.
export interface CrewBand {
  name: string;
  upToMeters: number;
  speed: number;
}

export interface CrewMotionConfig {
  bands: CrewBand[];
  ease: { ramp: number };
  spread: { minSeparationPx: number; radiusPx: number; angleDeg: number };
  repairRing: {
    segments: number;
    sizePx: number;
    radiusPx: number;
    strokePx: number;
  };
}

export declare const CREW_MOTION: CrewMotionConfig;
