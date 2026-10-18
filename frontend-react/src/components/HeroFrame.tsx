import { useCallback, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";

/** The new UI's welcome screen, shown exactly as the single-file design renders it.
 * public/assets/hero-source.html is a verbatim copy of frontend/index.html; it is loaded in
 * a same-origin frame so its own markup, styles and animation run unchanged. The two
 * buttons are intercepted in the capture phase so the frame does not switch to its
 * own workspace; they close this screen and the React workspace takes over.
 *
 * The frame stays mounted for the whole session. Closing it uses the design's own
 * `off` state (animations paused, nothing drawn) and reports the document as hidden,
 * so its polling and drawing stop. Reopening it just removes that state: no reload
 * and no restart of the intro animation. */
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
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.getElementById("hero")?.classList.toggle("off", !openRef.current);
    // The design's loops check document.hidden / visibilityState before polling or drawing.
    Object.defineProperty(doc, "hidden", {
      configurable: true,
      get: () => !openRef.current,
    });
    Object.defineProperty(doc, "visibilityState", {
      configurable: true,
      get: () => (openRef.current ? "visible" : "hidden"),
    });
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
      style={
        open ? undefined : { visibility: "hidden", pointerEvents: "none" }
      }
    />
  );
}
