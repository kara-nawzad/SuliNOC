import { useMemo } from "react";

/** Greeting from the visitor's local clock. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Good night";
}

/** Welcome screen from the single-file design. Shown on load and from the rail. */
export function Hero({
  onEnter,
  onSkip,
}: {
  onEnter: () => void;
  onSkip: () => void;
}) {
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  return (
    <section className="hero" aria-label="Welcome to SuliNOC">
      <img
        className="hero-bg"
        src="/assets/hero-city-sunset.jpg"
        alt=""
        aria-hidden="true"
      />
      <img
        className="hero-tower"
        src="/assets/hero-tower-cutout.webp"
        alt="Sulaymaniyah landmark tower at sunset"
      />
      <div className="hero-copy">
        <p className="hero-greet">{greeting}</p>
        <p className="hero-brand">SuliNOC</p>
        <h1>Looking after Slemani’s signal.</h1>
        <p className="hero-sub">
          A calmer way to watch 300 towers, and to notice the one that is about
          to struggle.
        </p>
        <div className="hero-actions">
          <button type="button" className="hero-cta" onClick={onEnter}>
            Open operations workspace
          </button>
          <button type="button" className="hero-ghost" onClick={onSkip}>
            Skip intro
          </button>
        </div>
      </div>
    </section>
  );
}
