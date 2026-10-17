// Types for the kit's crew-motion.js (SuliNOC-ui-kit). The JS file is kept unchanged.
export interface CrewRender {
  x: number;
  y: number;
  heading: number;
  flip: boolean;
  moving: boolean;
  progress: number;
}
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
