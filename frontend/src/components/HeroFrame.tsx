import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

/** Minimal, same-origin welcome page; the iframe contains no copy of the app.
 * The enter action is intercepted so React can reveal the workspace. */
export function HeroFrame({
  onEnter,
  open,
}: {
  onEnter: () => void;
  open: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
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
      const document = event.currentTarget.contentDocument;
      if (!document) {
        setReady(true);
        return;
      }

      const reveal = () => {
        if (frame.current?.contentDocument !== document) return;
        sync();
        setReady(true);
      };
      const assetsReady = [
        document.fonts?.ready ?? Promise.resolve(),
        ...Array.from(document.images, (image) =>
          typeof image.decode === "function"
            ? image.decode().catch(() => undefined)
            : Promise.resolve(),
        ),
      ];
      void Promise.all(assetsReady).then(reveal, reveal);
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
      style={{
        backgroundColor: "#081426",
        visibility: open && ready ? "visible" : "hidden",
        pointerEvents: open && ready ? "auto" : "none",
      }}
    />
  );
}
