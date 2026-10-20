// Types for src/adapters.js.
export interface TeamLike {
  id: number;
  lat: number;
  lon: number;
  state: string;
  available?: boolean;
  target_lat?: number | null;
  target_lon?: number | null;
  eta?: number | null;
}
export interface Track {
  route: [number, number][];
  progress: number;
  moving: boolean;
}
export class CrewTrips {
  constructor(project: (lat: number, lon: number) => [number, number]);
  update(team: TeamLike): Track;
}
export function simTimeToMinutes(
  simTime: string | null | undefined,
): number | null;
export function towerClass(
  node: { id: string; status: number; warn?: boolean; critical?: boolean },
  config: { presentation: { offline_statuses: number[] } },
  selectedId: string | null,
): { cls: string; halo: boolean; priority: boolean };
export function historyPoints(
  history: Array<Record<string, unknown>> | undefined,
  field: string,
): [number, number][];
