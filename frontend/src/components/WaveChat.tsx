import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useReducedMotion } from "framer-motion";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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
const LAUNCHER_POSITION_KEY = "sulinoc-wave-launcher-position:v1";
const LAUNCHER_EDGE_GAP = 8;
const MOBILE_NAV_HEIGHT = 76;
const GREETING_TEXT = "Hey, I’m Wave 👋";

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

function makeMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeMessage(role: WaveMessage["role"], content: string): WaveMessage {
  return {
    id: makeMessageId(),
    role,
    content,
  };
}

/** Reveal pacing that works without a compositor (tests, older WebViews). */
const scheduleFrame =
  typeof requestAnimationFrame === "function"
    ? (callback: (now: number) => void) => requestAnimationFrame(callback)
    : (callback: (now: number) => void) =>
        window.setTimeout(() => callback(performance.now()), 16);
const cancelFrame =
  typeof cancelAnimationFrame === "function"
    ? (handle: number) => cancelAnimationFrame(handle)
    : (handle: number) => window.clearTimeout(handle);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "I couldn’t reach Wave’s AI service. Check the connection and try again.";
}

/** Wave's providers answer in markdown. Two normalisations keep the model's
 * quirks parseable before rendering: a line holding only an em/en dash is a
 * divider, and a GFM table always gets a blank line before it so it parses
 * as a table instead of as loose pipes. Stored history keeps the original
 * text; this runs at render time only. */
export function normalizeWaveMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const divider = /^[ \t]*[—–][ \t]*$/.test(line);
    const tableRow = /^[ \t]*\|/.test(line);
    const previous = out[out.length - 1];
    if (
      tableRow &&
      previous !== undefined &&
      previous.trim() !== "" &&
      !/^[ \t]*\|/.test(previous)
    ) {
      out.push("");
    }
    out.push(divider ? "---" : line);
  }
  return out.join("\n");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** While a reply is still typing, trailing partial syntax is held back so
 * the bubble never shows a half-written table row, an unclosed code fence,
 * or a dangling bold/inline-code opener. The finished reply renders in
 * full. */
export function visibleWhileTyping(text: string): string {
  let visible = text;
  if (countOf(visible, "```") % 2 === 1) {
    visible = visible.slice(0, visible.lastIndexOf("```"));
  }
  const lines = visible.split("\n");
  if (lines.length && lines[lines.length - 1].trimStart().startsWith("|")) {
    lines.pop();
  }
  visible = lines.join("\n");
  if (countOf(visible, "**") % 2 === 1) {
    const at = visible.lastIndexOf("**");
    visible = visible.slice(0, at) + visible.slice(at + 2);
  }
  if (countOf(visible, "`") % 2 === 1) {
    const at = visible.lastIndexOf("`");
    visible = visible.slice(0, at) + visible.slice(at + 1);
  }
  return visible;
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="wave-md-tablewrap">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

/** Assistant replies render as sanitized markdown (no raw HTML, no
 * dangerouslySetInnerHTML): headings, lists, quotes, code, rules and GFM
 * tables. While `typing`, held-back partial syntax keeps the live text
 * valid; the caret itself is a CSS pseudo-element on the last block. */
const WaveMarkdown = memo(function WaveMarkdown({
  text,
  typing,
}: {
  text: string;
  typing: boolean;
}) {
  const normalized = normalizeWaveMarkdown(text);
  return (
    <div className="wave-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {typing ? visibleWhileTyping(normalized) : normalized}
      </ReactMarkdown>
    </div>
  );
});

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
  const [launcherPosition, setLauncherPosition] =
    useState<LauncherPosition | null>(() => readLauncherPosition());
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [responseExpression, setResponseExpression] =
    useState<WaveExpression | null>(null);
  // The assistant message currently typing out (streaming or paced locally);
  // history renders instantly because only this id animates.
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typingSkipped, setTypingSkipped] = useState(false);
  const reducedMotion = useReducedMotion() || false;
  const autoScrollRef = useRef(true);
  const flushRevealRef = useRef<() => void>(() => {});
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

  // Auto-scroll follows the growing reply, but stops the moment the user
  // scrolls up, and resumes when they return to the bottom.
  function handleMessagesScroll() {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    autoScrollRef.current = distance < 80;
  }

  useEffect(() => {
    if (!open || !autoScrollRef.current) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending, typingId, open]);

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
      const width = rect.width || (window.innerWidth <= 767 ? 72 : 88);
      const height = rect.height || (window.innerWidth <= 767 ? 72 : 88);
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

  function toggleOpen() {
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
      rect.width || (window.innerWidth <= 767 ? 72 : 88),
      rect.height || (window.innerWidth <= 767 ? 72 : 88),
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

  /** Shared post-reply bookkeeping: provider verification + mascot response. */
  function applyProviderMeta(reply: {
    provider: string;
    model: string;
    ai_connected: boolean;
  }) {
    const providerName = reply.provider === "groq" ? "Groq" : "OpenAI";
    setProviderStatus({
      provider: reply.provider === "groq" ? "groq" : "openai",
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
  }

  /** Tap on the typing bubble: stop holding back partial syntax and reveal
   * everything received so far, instantly. */
  function skipTyping() {
    setTypingSkipped(true);
    flushRevealRef.current();
  }

  /** Locally paced reveal for the JSON reply path (older backends without
   * the SSE route): the full text is known, so it types out at ~320 chars/s
   * through a frame loop, rendering markdown as it grows. */
  function revealTypewriter(
    full: string,
    meta: { provider: string; model: string; ai_connected: boolean },
  ) {
    return new Promise<void>((resolve) => {
      const id = makeMessageId();
      setTypingId(id);
      setMessages((current) =>
        [...current, { id, role: "assistant" as const, content: "" }].slice(
          -MAX_MESSAGES,
        ),
      );
      let revealed = 0;
      let last = performance.now();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        setMessages((current) =>
          current.map((message) =>
            message.id === id ? { ...message, content: full } : message,
          ),
        );
        setTypingId(null);
        applyProviderMeta(meta);
        resolve();
      };
      const step = (now: number) => {
        if (settled) return;
        const next = Math.min(
          full.length,
          revealed + Math.max(1, Math.round((now - last) * 0.32)),
        );
        if (next !== revealed) {
          revealed = next;
          setMessages((current) =>
            current.map((message) =>
              message.id === id
                ? {
                    ...message,
                    content: visibleWhileTyping(full.slice(0, revealed)),
                  }
                : message,
            ),
          );
        }
        last = now;
        if (revealed >= full.length) {
          finish();
          return;
        }
        frame = scheduleFrame(step);
      };
      let frame = scheduleFrame(step);
      flushRevealRef.current = () => {
        cancelFrame(frame);
        finish();
      };
    });
  }

  /** Streaming path: the backend relays provider deltas over SSE; each chunk
   * appends to the live message as it arrives. */
  async function askStreamed(text: string, history: WaveTurn[]) {
    const replyId = makeMessageId();
    let received = "";
    let appended = false;
    try {
      const meta = await api.waveChatStream(
        text,
        data.run_id,
        history,
        (chunk) => {
          received += chunk;
          if (reducedMotion) return; // no progressive reveal: show once, done
          const content = visibleWhileTyping(normalizeWaveMarkdown(received));
          if (!appended) {
            appended = true;
            setTypingId(replyId);
            setMessages((current) =>
              [
                ...current,
                { id: replyId, role: "assistant" as const, content },
              ].slice(-MAX_MESSAGES),
            );
            return;
          }
          setMessages((current) =>
            current.map((message) =>
              message.id === replyId ? { ...message, content } : message,
            ),
          );
        },
      );
      if (meta.run_id !== data.run_id) {
        throw new Error(
          "The simulation was reset while Wave was answering. Please ask again.",
        );
      }
      const content = normalizeWaveMarkdown(meta.answer || received);
      if (appended) {
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId ? { ...message, content } : message,
          ),
        );
        setTypingId(null);
      } else {
        setMessages((current) =>
          [
            ...current,
            { id: replyId, role: "assistant" as const, content },
          ].slice(-MAX_MESSAGES),
        );
      }
      applyProviderMeta(meta);
    } catch (error) {
      // Keep whatever arrived, final-render it, then surface the failure.
      if (appended) {
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId
              ? { ...message, content: normalizeWaveMarkdown(received) }
              : message,
          ),
        );
        setTypingId(null);
      }
      throw error;
    }
  }

  /** JSON path: one request, one reply; the reveal is paced locally. */
  async function askLegacy(text: string, history: WaveTurn[]) {
    const reply = await api.waveChat(text, data.run_id, history);
    if (reply.run_id !== data.run_id) {
      throw new Error(
        "The simulation was reset while Wave was answering. Please ask again.",
      );
    }
    const content = normalizeWaveMarkdown(reply.answer);
    if (reducedMotion) {
      setMessages((current) =>
        [...current, makeMessage("assistant", content)].slice(-MAX_MESSAGES),
      );
      applyProviderMeta(reply);
      return;
    }
    await revealTypewriter(content, reply);
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
    setTypingSkipped(false);
    setResponseExpression(null);
    autoScrollRef.current = true;
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
      if (typeof api.waveChatStream === "function") {
        await askStreamed(text, history);
      } else {
        await askLegacy(text, history);
      }
    } catch (streamError) {
      let failure: unknown = streamError;
      if ((failure as { status?: number }).status === 404) {
        // Backend without the SSE route: fall back to the JSON reply.
        try {
          await askLegacy(text, history);
          return;
        } catch (legacyError) {
          failure = legacyError;
        }
      }
      setMessages((current) =>
        [
          ...current,
          {
            ...makeMessage("assistant", errorMessage(failure)),
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
      {!open && (
        <aside className="wave-greeting" role="status" aria-live="polite">
          <p>{GREETING_TEXT}</p>
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
              <X size={18} />
            </button>
          </header>

          <div
            className="wave-messages"
            ref={listRef}
            role="log"
            aria-label="Conversation with Wave"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={handleMessagesScroll}
          >
            {messages.map((message) => (
              <article
                key={message.id}
                className={`wave-message wave-message--${message.role}${message.error ? " is-error" : ""}${message.id === typingId ? " is-typing" : ""}`}
                role={message.error ? "alert" : undefined}
                onClick={message.id === typingId ? skipTyping : undefined}
                title={
                  message.id === typingId ? "Show the full reply" : undefined
                }
              >
                {message.role === "assistant" && (
                  <img
                    className="wave-message-avatar"
                    src="/assets/wave-avatar.png"
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <div className="wave-message-content">
                  {message.role === "assistant" ? (
                    <WaveMarkdown
                      text={message.content}
                      typing={message.id === typingId && !typingSkipped}
                    />
                  ) : (
                    <p>{message.content}</p>
                  )}
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
                        <RefreshCw size={14} /> Retry
                      </button>
                      <button type="button" onClick={refresh}>
                        Refresh telemetry
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {sending && !typingId && (
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
              <Send size={18} />
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
