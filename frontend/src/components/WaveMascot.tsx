import { useId, type CSSProperties } from "react";
import type { WaveExpression } from "../types/wave";

const accentByExpression: Record<WaveExpression, string> = {
  idle: "#00d5f2",
  thinking: "#56eaff",
  responding: "#00e5ff",
  alert: "#ffb44a",
  offline: "#8094b4",
};

/** One Wave character in every state; the state only changes light and motion. */
export function WaveMascot({
  expression = "idle",
  className = "",
}: {
  expression?: WaveExpression;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const shellId = `${id}-wave-shell`;
  const faceId = `${id}-wave-face`;
  const glowId = `${id}-wave-glow`;
  const accent = accentByExpression[expression];

  return (
    <svg
      className={`wave-mascot wave-mascot--${expression} ${className}`.trim()}
      viewBox="0 0 280 280"
      role="img"
      aria-label={`Wave, ${expression} state`}
      style={{ "--wave-accent": accent } as CSSProperties}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Wave — {expression}</title>
      <defs>
        <linearGradient id={shellId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" />
          <stop offset=".48" stopColor="#d8f4ff" />
          <stop offset="1" stopColor="#91c9ea" />
        </linearGradient>
        <linearGradient id={faceId} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#173564" />
          <stop offset="1" stopColor="#061938" />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx="50%" cy="48%" r="66%">
          <stop stopColor="#117ce5" />
          <stop offset=".68" stopColor="#0754b9" />
          <stop offset="1" stopColor="#083779" />
        </radialGradient>
        <filter id={glowId} x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="3.2" result="soft-glow" />
          <feMerge>
            <feMergeNode in="soft-glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Fixed circular blue frame and mirrored signal waves. */}
      <circle
        className="wave-disc"
        cx="140"
        cy="140"
        r="103"
        fill={`url(#${id}-disc)`}
      />
      <circle
        className="wave-ring wave-ring--outer"
        cx="140"
        cy="140"
        r="106"
      />
      <circle className="wave-ring wave-ring--inner" cx="140" cy="140" r="99" />
      <g className="wave-signal-arcs" fill="none" strokeLinecap="round">
        <path
          className="wave-arc wave-arc--outer"
          d="M37 79C13 103 13 177 37 201"
        />
        <path
          className="wave-arc wave-arc--inner"
          d="M57 101C42 117 42 163 57 179"
        />
        <path
          className="wave-arc wave-arc--inner"
          d="M223 101C238 117 238 163 223 179"
        />
        <path
          className="wave-arc wave-arc--outer"
          d="M243 79C267 103 267 177 243 201"
        />
      </g>

      <g className="wave-figure">
        {/* Center antenna and its luminous cyan signal cap. */}
        <path className="wave-antenna-stem" d="M132 73V53h16v20" />
        <rect
          className="wave-antenna-cap"
          x="124"
          y="10"
          width="32"
          height="51"
          rx="16"
        />
        <rect
          className="wave-antenna-core"
          x="132"
          y="17"
          width="16"
          height="34"
          rx="8"
        />
        <path className="wave-antenna-glint" d="M136 22v23" />
        <rect
          className="wave-antenna-collar"
          x="117"
          y="67"
          width="46"
          height="12"
          rx="6"
        />

        {/* Symmetrical pale equipment side panels. */}
        <rect
          className="wave-side-panel"
          x="51"
          y="102"
          width="31"
          height="69"
          rx="14"
          fill={`url(#${shellId})`}
        />
        <rect
          className="wave-side-panel"
          x="198"
          y="102"
          width="31"
          height="69"
          rx="14"
          fill={`url(#${shellId})`}
        />
        <path className="wave-side-highlight" d="M59 111v49" />
        <path className="wave-side-highlight" d="M221 111v49" />
        <path className="wave-panel-seam" d="M77 110v52" />
        <path className="wave-panel-seam" d="M203 110v52" />

        {/* Pale equipment housing around the same navy face in every state. */}
        <rect
          className="wave-head-shadow"
          x="70"
          y="72"
          width="140"
          height="112"
          rx="39"
        />
        <rect
          className="wave-head-shell"
          x="68"
          y="69"
          width="144"
          height="113"
          rx="39"
          fill={`url(#${shellId})`}
        />
        <rect
          className="wave-face"
          x="79"
          y="80"
          width="122"
          height="91"
          rx="31"
          fill={`url(#${faceId})`}
        />
        <path className="wave-face-glint" d="M97 88c11-5 26-6 42-4" />

        {/* Cyan crescent eyes and the small, stable smile. */}
        <g
          className="wave-eyes"
          fill="none"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        >
          <path d="M102 127c2-17 22-17 24 0" />
          <path d="M154 127c2-17 22-17 24 0" />
        </g>
        <path
          className="wave-smile"
          d="M130 147c5 8 15 8 20 0"
          fill="none"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* Neck/status jewel and telecom-tower lattice body. */}
        <path className="wave-neck" d="M111 177h58v15h-58z" />
        <circle className="wave-status-halo" cx="140" cy="185" r="10" />
        <circle
          className="wave-status-light"
          cx="140"
          cy="185"
          r="5.5"
          filter={`url(#${glowId})`}
        />
        <path
          className="wave-tower-rail"
          d="m119 191-20 62h18l23-58 23 58h18l-20-62z"
        />
        <path
          className="wave-tower-brace"
          d="m116 201 48 42m-44-1 40-39m-43 19h47m-53 17h59"
        />
        <path className="wave-tower-highlight" d="m123 195-17 52m51-52 17 52" />
        <path className="wave-tower-foot" d="M97 254h86" />
      </g>
    </svg>
  );
}
