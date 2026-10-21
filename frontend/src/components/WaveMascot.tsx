import { useId, type CSSProperties } from "react";
import type { WaveExpression } from "../types/wave";

const expressionColor: Record<WaveExpression, string> = {
  idle: "#22c55e",
  thinking: "#2f7bff",
  alert: "#ef4444",
  focused: "#6a4bd8",
  excited: "#00d1ff",
  offline: "#94a3b8",
};

export function WaveMascot({
  expression = "idle",
  className = "",
}: {
  expression?: WaveExpression;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const accent = expressionColor[expression];
  const glowId = `${id}-wave-glow`;
  const shellId = `${id}-wave-shell`;

  return (
    <svg
      className={`wave-mascot wave-mascot--${expression} ${className}`.trim()}
      viewBox="0 0 180 260"
      role="img"
      aria-label={`Wave, ${expression} expression`}
      style={{ "--wave-accent": accent } as CSSProperties}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Wave — {expression}</title>
      <defs>
        <linearGradient id={shellId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f8fbff" />
          <stop offset=".48" stopColor="#d6e7fb" />
          <stop offset="1" stopColor="#91acd7" />
        </linearGradient>
        <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse cx="90" cy="247" rx="52" ry="5" fill="#10265c" opacity=".12" />

      {/* Center mast and status beacon */}
      {expression === "thinking" && (
        <g
          className="wave-signal"
          fill="none"
          stroke="#2f7bff"
          strokeWidth="2.5"
          opacity=".65"
        >
          <path d="M67 28c-8 8-8 20 0 28" />
          <path d="M113 28c8 8 8 20 0 28" />
          <path d="M58 20c-12 12-12 32 0 44" opacity=".6" />
          <path d="M122 20c12 12 12 32 0 44" opacity=".6" />
        </g>
      )}
      <path d="M86 47V66h8V47" fill="#183667" />
      <rect x="78" y="12" width="24" height="43" rx="10" fill="#17315f" />
      <rect
        x="81.5"
        y="8"
        width="17"
        height="40"
        rx="8"
        fill={`url(#${shellId})`}
        stroke="#b8d4f5"
        strokeWidth="2"
      />
      <rect
        className="wave-beacon"
        x="85"
        y="13"
        width="10"
        height="29"
        rx="5"
        fill={expression === "offline" ? "#94a3b8" : accent}
        filter={expression === "offline" ? undefined : `url(#${glowId})`}
      />
      <rect x="72" y="57" width="36" height="9" rx="4.5" fill="#1e3d70" />

      {/* Tower-top side panels */}
      <path
        d="M40 89h-7c-6 0-10-5-10-11V73"
        fill="none"
        stroke="#315487"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M140 89h7c6 0 10-5 10-11V73"
        fill="none"
        stroke="#315487"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect
        x="16"
        y="57"
        width="25"
        height="62"
        rx="9"
        fill={`url(#${shellId})`}
        stroke="#91acd7"
        strokeWidth="2"
      />
      <rect
        x="139"
        y="57"
        width="25"
        height="62"
        rx="9"
        fill={`url(#${shellId})`}
        stroke="#91acd7"
        strokeWidth="2"
      />
      <path
        d="M22 64v45"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        opacity=".7"
      />
      <path
        d="M145 64v45"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        opacity=".7"
      />
      <path
        d="M36 70v38M144 70v38"
        stroke="#88a7d4"
        strokeWidth="2"
        opacity=".8"
      />

      {/* Reinforced silver face housing and dark glass */}
      <path
        d="M49 62h82c15 0 26 11 26 26v35c0 15-11 26-26 26H49c-15 0-26-11-26-26V88c0-15 11-26 26-26Z"
        fill="#9ab6de"
        opacity=".45"
        transform="translate(2 4)"
      />
      <path
        d="M49 60h82c15 0 26 11 26 26v35c0 15-11 26-26 26H49c-15 0-26-11-26-26V86c0-15 11-26 26-26Z"
        fill={`url(#${shellId})`}
        stroke="#b7d0ef"
        strokeWidth="3"
      />
      <path
        d="M51 69h78c10 0 18 8 18 18v33c0 10-8 18-18 18H51c-10 0-18-8-18-18V87c0-10 8-18 18-18Z"
        fill="#071a3e"
        stroke="#183d79"
        strokeWidth="2"
      />
      <path
        d="M46 76c6-5 13-7 20-7h49"
        stroke="#fff"
        strokeWidth="2.5"
        opacity=".45"
        fill="none"
      />

      {/* Expression-specific eyes */}
      {expression === "idle" && (
        <g
          fill="none"
          stroke="#00d1ff"
          strokeWidth="5"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        >
          <path d="M55 105c1-12 19-12 20 0" />
          <path d="M105 105c1-12 19-12 20 0" />
        </g>
      )}
      {expression === "thinking" && (
        <g
          fill="none"
          stroke="#69ddff"
          strokeWidth="5"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        >
          <path d="M55 101h20" />
          <path d="M105 101h20" />
        </g>
      )}
      {expression === "alert" && (
        <g
          fill="none"
          stroke="#ff454b"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        >
          <path d="m57 91 13 8-13 8" />
          <path d="m123 91-13 8 13 8" />
        </g>
      )}
      {expression === "focused" && (
        <g fill="#00d1ff" filter={`url(#${glowId})`}>
          <rect x="57" y="92" width="17" height="16" rx="3" />
          <rect x="106" y="92" width="17" height="16" rx="3" />
          <path d="M62 96h7v2h-7zm49 0h7v2h-7z" fill="#e8fbff" />
        </g>
      )}
      {expression === "excited" && (
        <g
          fill="none"
          stroke="#00d1ff"
          strokeWidth="5"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        >
          <path d="M55 104c1-14 19-14 20 0" />
          <path d="M105 104c1-14 19-14 20 0" />
          <path d="M78 115c7 7 17 7 24 0" strokeWidth="3.5" />
        </g>
      )}
      {expression === "offline" && (
        <g
          fill="none"
          stroke="#6086b7"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".72"
        >
          <path d="M55 103c4-5 15-5 20 0" />
          <path d="M105 103c4-5 15-5 20 0" />
        </g>
      )}

      {/* Neck light and lattice tower body */}
      <rect x="68" y="148" width="44" height="12" rx="5" fill="#173467" />
      <circle cx="90" cy="154" r="7" fill="#0b8eaa" opacity=".55" />
      <circle
        cx="90"
        cy="154"
        r="4"
        fill={expression === "offline" ? "#94a3b8" : accent}
        filter={expression === "offline" ? undefined : `url(#${glowId})`}
      />
      <path
        d="M68 159 46 222h15l29-54 29 54h15l-22-63"
        fill="#244b82"
        stroke="#102a58"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="m74 160-19 60m51-60 19 60M70 176h40M63 194h54M57 211h66"
        fill="none"
        stroke="#a9c8ef"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="m71 163 43 59m-45-4 40-57M65 180l45 14m-51 18 57-20"
        fill="none"
        stroke="#426ca4"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M81 159 65 222M99 159l16 63"
        fill="none"
        stroke="#d4e5fa"
        strokeWidth="3"
        opacity=".85"
      />

      {/* Stable weighted base with cyan status ring */}
      <path
        d="M35 221c12-5 27-8 55-8s43 3 55 8l-6 18c-13 5-29 8-49 8s-36-3-49-8Z"
        fill="#15396f"
        stroke="#0d2858"
        strokeWidth="3"
      />
      <path
        d="M38 225c14-4 31-6 52-6s38 2 52 6"
        fill="none"
        stroke="#3981db"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M42 234c14 5 30 7 48 7s34-2 48-7"
        fill="none"
        stroke="#00d1ff"
        strokeWidth="3.5"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
      />
      <path
        d="M49 244c12 3 26 4 41 4s29-1 41-4"
        fill="none"
        stroke="#496d9c"
        strokeWidth="2"
        opacity=".7"
      />
    </svg>
  );
}
