// Types for the kit's charts.js (SuliNOC-ui-kit). The JS file is kept unchanged.
export function niceTicks(min: number, max: number, n?: number): number[];
export function hhmm(minutes: number): string;
export function xLabel(minutes: number, spanMinutes: number): string;
export interface LineChart {
  setData(points: [number, number][]): void;
  append(point: [number, number]): void;
  setDomain(min: number | null, max?: number): void;
  destroy(): void;
}
export function lineChart(
  host: HTMLElement,
  opts?: {
    color?: string;
    unit?: string;
    decimals?: number;
    zero?: boolean;
    onNote?: (text: string) => void;
  },
): LineChart;
