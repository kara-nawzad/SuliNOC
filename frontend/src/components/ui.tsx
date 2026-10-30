import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X, ArrowUpRight, MoreHorizontal } from "lucide-react";
import type { Config, Severity } from "../types/api";

export const tone = (color: string): CSSProperties =>
  ({ "--tone": color }) as CSSProperties;
export function Dot({
  color,
  pulse = false,
}: {
  color: string;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`status-dot ${pulse ? "pulse" : ""}`}
      style={{ background: color, color }}
    />
  );
}
export function Badge({
  severity,
  config,
}: {
  severity: Severity;
  config: Config;
}) {
  return (
    <span
      className="severity"
      style={tone(config.presentation.severity_colors[severity])}
    >
      {severity}
    </span>
  );
}
export function PanelInfoButton({
  title,
  compact = false,
}: {
  title: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`panel-info-button${compact ? " compact" : ""}`}
      data-panel-info={title}
      aria-label={`More information about ${title}`}
      aria-haspopup="dialog"
      title={`More information about ${title}`}
    >
      <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
export function PanelHeading({
  eyebrow,
  title,
  right,
}: {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      <div className="panel-heading-actions">
        {right}
        <PanelInfoButton title={title} />
      </div>
    </div>
  );
}
/** Chart geometry only: no derived operational metrics or synthetic samples. */
export function chartPath(
  values: number[],
  width: number,
  height: number,
  domain?: [number, number],
) {
  if (!values.length) return "";
  const lo = domain?.[0] ?? Math.min(...values);
  const hi = domain?.[1] ?? Math.max(...values);
  const span = Math.max(hi - lo, 0.001);
  return values
    .map((value, index) => {
      const x =
        values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y =
        height -
        3 -
        Math.max(0, Math.min(1, (value - lo) / span)) * (height - 6);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
export function Sparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const id = useId().replace(/:/g, "");
  const d = chartPath(values, 110, 34);
  return (
    <svg
      className="sparkline"
      viewBox="0 0 110 34"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity=".24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The path is drawn, not morphed: framer's `d` interpolation ran a rAF
          loop for 0.6 s on every tick to animate a 34 px sparkline. The static
          result is the same shape, and the numbers above it still tween. */}
      {values.length > 1 && <path d={`${d} L110,34 L0,34 Z`} fill={`url(#${id})`} />}
      <path
        d={d}
        stroke={color}
        strokeWidth="1.7"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  hideEyebrow = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  hideEyebrow?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-content">
        <div className="dialog-heading">
          <div>
            {!hideEyebrow && <span className="eyebrow">SULINOC COMMAND</span>}
            <h2 id={id}>{title}</h2>
          </div>
          <button
            className="icon-button dialog-close-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
