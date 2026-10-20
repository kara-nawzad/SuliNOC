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
  openRef.current = open;

  const sync = useCallback(() => {
    const hero = frame.current?.contentDocument?.getElementById("hero");
    hero?.classList.toggle("off", !openRef.current);
  }, []);

  useEffect(() => {
    sync();
  }, [open, sync]);

  const onLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      const doc = event.currentTarget.contentDocument;
      if (!doc) return;
      doc.addEventListener(
        "click",
        (ev) => {
          const target = ev.target as Element | null;
          if (!target?.closest?.("#enter, #skip")) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
          ev.stopPropagation();
          onEnter();
        },
        true,
      );
      sync();
    },
    [onEnter, sync],
  );

  return (
    <iframe
      ref={frame}
      className="hero-frame"
      src="/assets/hero-source.html"
      title="SuliNOC welcome"
      onLoad={onLoad}
      style={open ? undefined : { visibility: "hidden", pointerEvents: "none" }}
    />
  );
}
