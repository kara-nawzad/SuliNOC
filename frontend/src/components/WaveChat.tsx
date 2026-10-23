import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RefreshCw, Send, X } from "lucide-react";
import { api } from "../services/api";
import type { Snapshot } from "../types/api";
import type {
  WaveExpression,
  WaveProviderState,
  WaveTurn,
} from "../types/wave";
import { WaveMascot } from "./WaveMascot";

interface WaveMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  error?: boolean;
  retryText?: string;
}

const MAX_MESSAGES = 80;
const GREETING_DISMISSED_KEY = "sulinoc-wave-greeting-dismissed:v1";
const LAUNCHER_POSITION_KEY = "sulinoc-wave-launcher-position:v1";
const LAUNCHER_EDGE_GAP = 8;
const MOBILE_NAV_HEIGHT = 76;
const GREETING_TEXT = "Hey, I’m Wave 👋 Your network, made clearer.";

type LauncherPosition = { right: number; bottom: number };
type LauncherDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  lastPosition: LauncherPosition;
  moved: boolean;
};

function readLauncherPosition(): LauncherPosition | null {
  try {
    const value = localStorage.getItem(LAUNCHER_POSITION_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "right" in parsed &&
      "bottom" in parsed &&
      typeof parsed.right === "number" &&
      Number.isFinite(parsed.right) &&
      typeof parsed.bottom === "number" &&
      Number.isFinite(parsed.bottom)
    ) {
      return { right: parsed.right, bottom: parsed.bottom };
    }
  } catch {
    // Keep the default CSS position when storage is unavailable or malformed.
  }
  return null;
}

function saveLauncherPosition(position: LauncherPosition) {
  try {
    localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Dragging remains available for this session if storage is blocked.
  }
}

let cachedSafeAreaInset: { width: number; value: number } | null = null;

function safeAreaBottomInset(): number {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  if (cachedSafeAreaInset?.width === width) return cachedSafeAreaInset.value;
  try {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom, 0px)";
    document.body.appendChild(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    cachedSafeAreaInset = { width, value: inset };
    return inset;
  } catch {
    cachedSafeAreaInset = { width, value: 0 };
    return 0;
  }
}

function clampLauncherPosition(
  position: LauncherPosition,
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): LauncherPosition {
  const minRight = LAUNCHER_EDGE_GAP;
  const maxRight = Math.max(
    minRight,
    viewportWidth - width - LAUNCHER_EDGE_GAP,
  );
  const safeInset = safeAreaBottomInset();
  const minBottom =
    (viewportWidth <= 767 ? MOBILE_NAV_HEIGHT : LAUNCHER_EDGE_GAP) + safeInset;
  const maxBottom = Math.max(
    minBottom,
    viewportHeight - height - LAUNCHER_EDGE_GAP,
  );
  return {
    right: Math.round(Math.min(maxRight, Math.max(minRight, position.right))),
    bottom: Math.round(
      Math.min(maxBottom, Math.max(minBottom, position.bottom)),
    ),
  };
}
const WELCOME: WaveMessage = {
  id: "wave-welcome",
  role: "assistant",
  content:
    "Hi, I’m Wave (*beep boop*)—your friendly telecom engineer for this SuliNOC simulation. Ask about incidents, power, crews, forecasts, or trends. I’ll stick to the snapshot, keep advice read-only, and say when data is missing. Let’s keep Slemani connected, one dropped packet at a time.",
};
const SUGGESTIONS = [
  "What is happening across the network right now?",
  "Are there any active power problems?",
  "Compare recent telemetry and explain the trend.",
];
const CHECKING_PROVIDER: WaveProviderState = {
  provider: "openai",
  model: "",
  configured: false,
  verified: false,
  status: "checking",
};
const UNAVAILABLE_PROVIDER: WaveProviderState = {
  provider: "openai",
  model: "",
  configured: false,
  verified: false,
  status: "unavailable",
  detail: "Wave could not check the server-side AI service.",
};

function storageKey(runId: string) {
  return `sulinoc-wave-chat:${runId}`;
}

function wasGreetingDismissed(): boolean {
  try {
    if (localStorage.getItem(GREETING_DISMISSED_KEY) === "true") return true;
  } catch {
    // Fall back to this tab's session when persistent storage is unavailable.
  }
  try {
    return sessionStorage.getItem(GREETING_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberGreetingDismissal() {
  try {
    localStorage.setItem(GREETING_DISMISSED_KEY, "true");
    return;
  } catch {
    // Continue with session storage when browser privacy settings block local storage.
  }
  try {
    sessionStorage.setItem(GREETING_DISMISSED_KEY, "true");
  } catch {
    // The greeting remains dismissed for this mounted instance even without storage.
  }
}

function readMessages(key: string): WaveMessage[] {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return [WELCOME];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [WELCOME];
    const messages = parsed.filter(
      (message): message is WaveMessage =>
        message !== null &&
        typeof message === "object" &&
        typeof message.id === "string" &&
        (message.role === "assistant" || message.role === "user") &&
        typeof message.content === "string",
    );
    return messages.length ? messages.slice(-MAX_MESSAGES) : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function makeMessage(role: WaveMessage["role"], content: string): WaveMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "I couldn’t reach Wave’s AI service. Check the connection and try again.";
}

export function WaveChat({
  data,
  connection,
  refresh,
}: {
  data: Snapshot;
  connection: "connecting" | "live" | "reconnecting";
  refresh: () => void;
}) {
  const key = storageKey(data.run_id);
  const [messages, setMessages] = useState<WaveMessage[]>(() =>
    readMessages(key),
  );
  const [providerStatus, setProviderStatus] =
    useState<WaveProviderState>(CHECKING_PROVIDER);
  const [greetingVisible, setGreetingVisible] = useState(
    () => !wasGreetingDismissed(),
  );
  const [launcherPosition, setLauncherPosition] =
    useState<LauncherPosition | null>(() => readLauncherPosition());
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [responseExpression, setResponseExpression] =
    useState<WaveExpression | null>(null);
  const sendingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const statusRequestRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const launcherDragRef = useRef<LauncherDrag | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const activeAlerts = data.dashboard.incidents.length;

  useEffect(() => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify(messages.slice(-MAX_MESSAGES)),
      );
    } catch {
      // The live assistant still works if this browser blocks session storage.
    }
  }, [key, messages]);

  useEffect(() => {
    let active = true;
    const requestId = ++statusRequestRef.current;
    void api
      .waveStatus()
      .then((status) => {
        if (active && statusRequestRef.current === requestId)
          setProviderStatus(status);
      })
      .catch(() => {
        if (active && statusRequestRef.current === requestId)
          setProviderStatus(UNAVAILABLE_PROVIDER);
      });
    return () => {
      active = false;
      if (statusRequestRef.current === requestId) statusRequestRef.current += 1;
    };
  }, [data.run_id, open]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        launcherRef.current?.focus();
      }
      return;
    }
    wasOpenRef.current = true;
    inputRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(72, Math.max(28, input.scrollHeight))}px`;
  }, [draft, open]);

  useEffect(() => {
    const assistant = assistantRef.current;
    if (!assistant) return;

    const updateViewport = () => {
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const keyboardInset = Math.max(
        0,
        window.innerHeight - viewportTop - viewportHeight,
      );
      const keyboardOpen =
        window.innerWidth <= 767 &&
        inputRef.current === document.activeElement &&
        (keyboardInset > 120 || window.screen.height - viewportHeight > 200);

      assistant.style.setProperty(
        "--wave-visual-viewport-top",
        `${viewportTop}px`,
      );
      assistant.style.setProperty(
        "--wave-visual-viewport-height",
        `${viewportHeight}px`,
      );
      assistant.style.setProperty(
        "--wave-keyboard-inset",
        `${keyboardInset}px`,
      );
      assistant.toggleAttribute("data-keyboard-open", keyboardOpen);
    };
    const updateAfterFocus = () => window.requestAnimationFrame(updateViewport);

    window.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    document.addEventListener("focusin", updateViewport);
    document.addEventListener("focusout", updateAfterFocus);
    updateViewport();

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      document.removeEventListener("focusin", updateViewport);
      document.removeEventListener("focusout", updateAfterFocus);
    };
  }, []);

  useEffect(() => {
    if (!responseExpression) return;
    const timer = window.setTimeout(() => setResponseExpression(null), 1800);
    return () => window.clearTimeout(timer);
  }, [responseExpression]);

  useEffect(() => {
    const clampSavedPosition = () => {
      const launcher = launcherRef.current;
      if (!launcher) return;
      const rect = launcher.getBoundingClientRect();
      const width = rect.width || (window.innerWidth <= 767 ? 72 : 104);
      const height = rect.height || (window.innerWidth <= 767 ? 72 : 104);
      setLauncherPosition((current) => {
        if (!current) return current;
        const next = clampLauncherPosition(
          current,
          window.innerWidth,
          window.innerHeight,
          width,
          height,
        );
        if (next.right === current.right && next.bottom === current.bottom)
          return current;
        saveLauncherPosition(next);
        return next;
      });
    };
    window.addEventListener("resize", clampSavedPosition);
    clampSavedPosition();
    return () => window.removeEventListener("resize", clampSavedPosition);
  }, []);

  const lastMessage = messages.at(-1);
  const providerUnavailable =
    providerStatus.status === "missing_key" ||
    providerStatus.status === "unavailable";
  const expression: WaveExpression =
    connection !== "live"
      ? "offline"
      : sending
        ? "thinking"
        : lastMessage?.error
          ? providerUnavailable
            ? "offline"
            : "alert"
          : (responseExpression ??
            (activeAlerts > 0
              ? "alert"
              : providerUnavailable
                ? "offline"
                : "idle"));

  function dismissGreeting() {
    setGreetingVisible(false);
    rememberGreetingDismissal();
  }

  function toggleOpen() {
    if (!open) dismissGreeting();
    setOpen(!open);
  }

  function beginLauncherDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (open || (Number.isFinite(event.button) && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startRight = window.innerWidth - rect.right;
    const startBottom = window.innerHeight - rect.bottom;
    launcherDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight,
      startBottom,
      lastPosition: { right: startRight, bottom: startBottom },
      moved: false,
    };
    if (
      Number.isFinite(event.pointerId) &&
      typeof event.currentTarget.setPointerCapture === "function"
    ) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; the pointer handlers still work normally.
      }
    }
  }

  function moveLauncher(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setDragging(true);
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const next = clampLauncherPosition(
      { right: drag.startRight - dx, bottom: drag.startBottom - dy },
      window.innerWidth,
      window.innerHeight,
      rect.width || (window.innerWidth <= 767 ? 72 : 104),
      rect.height || (window.innerWidth <= 767 ? 72 : 104),
    );
    drag.lastPosition = next;
    setLauncherPosition(next);
  }

  function finishLauncherDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    launcherDragRef.current = null;
    setDragging(false);
    if (drag.moved) {
      saveLauncherPosition(drag.lastPosition);
      suppressLauncherClickRef.current = true;
      window.setTimeout(() => {
        suppressLauncherClickRef.current = false;
      }, 0);
    }
    if (
      Number.isFinite(event.pointerId) &&
      typeof event.currentTarget.releasePointerCapture === "function"
    ) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already have been released by the browser.
      }
    }
  }

  function cancelLauncherDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    launcherDragRef.current = null;
    setDragging(false);
    if (drag.moved) saveLauncherPosition(drag.lastPosition);
  }

  function handleLauncherClick() {
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false;
      return;
    }
    toggleOpen();
  }

  async function refreshProviderStatus() {
    const requestId = ++statusRequestRef.current;
    try {
      const status = await api.waveStatus();
      if (statusRequestRef.current === requestId) setProviderStatus(status);
    } catch {
      if (statusRequestRef.current === requestId)
        setProviderStatus(UNAVAILABLE_PROVIDER);
    }
  }

  async function ask(question: string, addUserMessage = true) {
    const text = question.trim();
    if (!text || sendingRef.current) return;

    const priorMessages = addUserMessage ? messages : messages.slice(0, -2);
    const history: WaveTurn[] = priorMessages
      .filter((message) => message.id !== WELCOME.id && !message.error)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    sendingRef.current = true;
    setSending(true);
    setResponseExpression(null);
    if (addUserMessage) {
      setMessages((current) =>
        [...current, makeMessage("user", text)].slice(-MAX_MESSAGES),
      );
    } else {
      setMessages((current) =>
        current.at(-1)?.error ? current.slice(0, -1) : current,
      );
    }
    setDraft("");

    try {
      // The backend captures fresh /api/delta-equivalent telemetry for this
      // session. Only the question and bounded prior turns come from the browser.
      const reply = await api.waveChat(text, data.run_id, history);
      if (reply.run_id !== data.run_id) {
        throw new Error(
          "The simulation was reset while Wave was answering. Please ask again.",
        );
      }
      setMessages((current) =>
        [...current, makeMessage("assistant", reply.answer)].slice(
          -MAX_MESSAGES,
        ),
      );
      const providerName = reply.provider === "groq" ? "Groq" : "OpenAI";
      setProviderStatus({
        provider: reply.provider,
        model: reply.model,
        configured: true,
        verified: reply.ai_connected,
        status: reply.ai_connected ? "connected" : "not_verified",
        detail: reply.ai_connected
          ? `${providerName} answered this Wave request successfully.`
          : "The provider has not been verified by a successful request.",
      });
      statusRequestRef.current += 1;
      setResponseExpression("responding");
    } catch (error) {
      setMessages((current) =>
        [
          ...current,
          {
            ...makeMessage("assistant", errorMessage(error)),
            error: true,
            retryText: text,
          },
        ].slice(-MAX_MESSAGES),
      );
      setResponseExpression("alert");
      void refreshProviderStatus();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void ask(draft);
    }
  }

  const assistantStyle = launcherPosition
    ? ({
        "--wave-launcher-right": `${launcherPosition.right}px`,
        "--wave-launcher-bottom": `${launcherPosition.bottom}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div ref={assistantRef} className="wave-assistant" style={assistantStyle}>
      {greetingVisible && !open && (
        <aside className="wave-greeting" role="status" aria-live="polite">
          <p>{GREETING_TEXT}</p>
          <button
            type="button"
            aria-label="Dismiss Wave greeting"
            title="Dismiss greeting"
            onClick={dismissGreeting}
          >
            <X size={14} />
          </button>
        </aside>
      )}
      {open && (
        <section
          className="wave-panel"
          role="dialog"
          aria-label="Wave network operations assistant"
          aria-modal="false"
        >
          <header className="wave-panel-header">
            <WaveMascot expression={expression} className="wave-panel-avatar" />
            <div className="wave-panel-identity">
              <h2>Wave</h2>
            </div>
            <button
              className="wave-icon-button"
              type="button"
              aria-label="Close Wave panel"
              title="Close assistant"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>

          <div
            className="wave-messages"
            ref={listRef}
            role="log"
            aria-label="Conversation with Wave"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.map((message) => (
              <article
                key={message.id}
                className={`wave-message wave-message--${message.role}${message.error ? " is-error" : ""}`}
                role={message.error ? "alert" : undefined}
              >
                {message.role === "assistant" && (
                  <img
                    className="wave-message-avatar"
                    src="/assets/wave.jpg"
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <div className="wave-message-content">
                  <p>{message.content}</p>
                  {message.error && (
                    <div className="wave-error-actions">
                      <button
                        type="button"
                        onClick={() =>
                          message.retryText
                            ? void ask(message.retryText, false)
                            : refresh()
                        }
                      >
                        <RefreshCw size={12} /> Retry
                      </button>
                      <button type="button" onClick={refresh}>
                        Refresh telemetry
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {sending && (
              <div className="wave-thinking" role="status">
                <span className="wave-thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Wave is checking this simulation snapshot…
              </div>
            )}
          </div>

          {messages.length === 1 && !sending && (
            <div
              className="wave-suggestions"
              role="group"
              aria-label="Suggested questions"
            >
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form className="wave-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="wave-message-input">
              Message Wave
            </label>
            <textarea
              id="wave-message-input"
              ref={inputRef}
              rows={1}
              maxLength={500}
              placeholder="Ask about this simulation…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="submit"
              className="wave-send-button"
              aria-label="Send message to Wave"
              title="Send message"
              disabled={!draft.trim() || sending}
            >
              <Send size={16} />
            </button>
          </form>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={`wave-launcher${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
        aria-label={open ? "Close Wave assistant" : "Open Wave assistant"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={handleLauncherClick}
        onPointerDown={beginLauncherDrag}
        onPointerMove={moveLauncher}
        onPointerUp={finishLauncherDrag}
        onPointerCancel={cancelLauncherDrag}
        onLostPointerCapture={cancelLauncherDrag}
      >
        <WaveMascot expression={expression} className="wave-launcher-mascot" />
        <span className="wave-launcher-label">Wave</span>
      </button>
    </div>
  );
}
