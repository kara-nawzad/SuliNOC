import { useCallback, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";

/** Minimal, same-origin welcome page; the iframe contains no copy of the app.
 * The enter and skip actions are intercepted so React can reveal the workspace. */
export function HeroFrame({
  onEnter,
  open,
}: {
  onEnter: () => void;
  open: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const openRef = useRef(open);
  const onEnterRef = useRef(onEnter);
  openRef.current = open;
  onEnterRef.current = onEnter;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "sulinoc:enter"
      )
        return;
      onEnterRef.current();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const sync = useCallback(() => {
    const hero = frame.current?.contentDocument?.getElementById("hero");
    hero?.classList.toggle("off", !openRef.current);
  }, []);

  useEffect(() => {
    sync();
  }, [open, sync]);

  const onLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      if (!event.currentTarget.contentDocument) return;
      sync();
    },
    [sync],
  );

  const buildId = `${__BUILD_STAMP__.sha}-${__BUILD_STAMP__.built}`;
  const heroSource = `/assets/hero-source.html?v=${encodeURIComponent(buildId)}`;

  return (
    <iframe
      ref={frame}
      className="hero-frame"
      src={heroSource}
      title="SuliNOC welcome"
      onLoad={onLoad}
      style={open ? undefined : { visibility: "hidden", pointerEvents: "none" }}
    />
  );
}
