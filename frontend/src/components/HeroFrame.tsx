import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

/** Minimal, same-origin welcome page; the iframe contains no copy of the app.
 * The enter action is intercepted so React can reveal the workspace.
 *
 * The frame is mounted only while the welcome screen is open. Once the visitor
 * enters, React removes it, which releases its document and the decoded
 * full-size hero bitmap instead of keeping both alive behind the console.
 * Returning to the hero (the Home / Welcome buttons) mounts a fresh frame; the
 * document and its images are already cached, so it appears at once. */
export function HeroFrame({
  onEnter,
  open,
}: {
  onEnter: () => void;
  open: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const onEnterRef = useRef(onEnter);
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

  const onLoad = useCallback((event: SyntheticEvent<HTMLIFrameElement>) => {
    const document = event.currentTarget.contentDocument;
    if (!document) {
      setReady(true);
      return;
    }
    const reveal = () => {
      if (frame.current?.contentDocument !== document) return;
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
  }, []);

  // Every hook above runs unconditionally; only the element is conditional.
  if (!open) return null;

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
        visibility: ready ? "visible" : "hidden",
        pointerEvents: ready ? "auto" : "none",
      }}
    />
  );
}
