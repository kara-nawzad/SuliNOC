import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Activity, RefreshCw, Send, X } from "lucide-react";
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
const GREETING_TEXT = "Hey, I’m Wave 👋 Your network, made clearer.";
const WELCOME: WaveMessage = {
  id: "wave-welcome",
  role: "assistant",
  content:
    "Hi, I’m Wave. Ask about incidents, power, crews, forecasts, sites, or trends in this SuliNOC simulation. I describe the supplied data and never operate a network. Generative answers require an AI provider to be configured on the server.",
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

function providerLabel(state: WaveProviderState): string {
  const providerName = state.provider === "groq" ? "Groq" : "OpenAI";
  switch (state.status) {
    case "checking":
      return "Checking AI setup";
    case "missing_key":
      return `${providerName} setup required`;
    case "not_verified":
      return `${providerName} not verified`;
    case "connected":
      return `${providerName} connected`;
    case "unavailable":
      return "AI unavailable";
  }
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
  const launcherRef = useRef<HTMLButtonElement>(null);
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
    if (!responseExpression) return;
    const timer = window.setTimeout(() => setResponseExpression(null), 1800);
    return () => window.clearTimeout(timer);
  }, [responseExpression]);

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

  const predictorLabel = data.ai.ai_enabled
    ? `${String(data.ai.ai_mode).toUpperCase()} predictor on`
    : "Simulation predictor off";
  const serviceStatus = providerLabel(providerStatus);

  return (
    <div className="wave-assistant">
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
              <span className="wave-eyebrow">SULINOC OPERATIONS</span>
              <h2>Wave</h2>
              <span className={`wave-connection ${connection}`}>
                <i aria-hidden="true" />
                {connection === "live"
                  ? "Sim telemetry connected"
                  : connection === "connecting"
                    ? "Connecting to simulation"
                    : "Simulation reconnecting"}
              </span>
              <span
                className={`wave-provider-status ${providerStatus.status}`}
                title={providerStatus.detail}
                aria-live="polite"
              >
                <i aria-hidden="true" />
                {serviceStatus}
                {providerStatus.model && providerStatus.status === "connected"
                  ? ` · ${providerStatus.model}`
                  : ""}
              </span>
              <span className="wave-predictor">{predictorLabel}</span>
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
                  <span className="wave-message-mark" aria-hidden="true">
                    W
                  </span>
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
          <footer className="wave-panel-foot">
            <Activity size={12} />
            <span>
              When enabled, your question, up to eight recent chat messages, and
              this simulation snapshot are sent to the configured AI provider.
              Wave is read-only; don’t enter passwords or secrets.
            </span>
          </footer>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={`wave-launcher${open ? " is-open" : ""}`}
        aria-label={open ? "Close Wave assistant" : "Open Wave assistant"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggleOpen}
      >
        <WaveMascot expression={expression} className="wave-launcher-mascot" />
        <span className="wave-launcher-label">Wave</span>
      </button>
    </div>
  );
}
