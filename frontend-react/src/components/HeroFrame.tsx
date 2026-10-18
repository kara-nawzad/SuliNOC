import { useCallback } from "react";
import type { SyntheticEvent } from "react";

/** The new UI's welcome screen, shown exactly as the single-file design renders it.
 * public/assets/hero-source.html is a verbatim copy of frontend/index.html; it is loaded in
 * a same-origin frame so its own markup, styles and animation run unchanged. The two
 * buttons are intercepted in the capture phase so the frame does not switch to its
 * own workspace; they close this screen and the React workspace takes over. */
export function HeroFrame({ onEnter }: { onEnter: () => void }) {
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
    },
    [onEnter],
  );
  return (
    <iframe
      className="hero-frame"
      src="/assets/hero-source.html"
      title="SuliNOC welcome"
      onLoad={onLoad}
    />
  );
}
