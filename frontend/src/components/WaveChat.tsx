import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Activity, RefreshCw, Send, X } from "lucide-react";
import { api } from "../services/api";
import type { Config, Snapshot } from "../types/api";
import type { WaveExpression } from "../types/wave";
import { answerWave } from "../utils/waveAssistant";
import { WaveMascot } from "./WaveMascot";

type MessageRole = "assistant" | "user";
interface WaveMessage {
  id: string;
  role: MessageRole;
  content: string;
  error?: boolean;
  retryText?: string;
}

const MAX_MESSAGES = 80;
const WELCOME: WaveMessage = {
  id: "wave-welcome",
  role: "assistant",
  content:
    "Hi, I’m Wave. Ask about the current network, incidents, power, crews, forecasts, a site ID, or a district. I answer from the latest SuliNOC simulation snapshot—not a live operator network.",
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

function makeMessage(role: MessageRole, content: string): WaveMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "I couldn’t read the current simulation snapshot. Check the connection and try again.";
}

export function WaveChat({
  data,
  config,
  connection,
  refresh,
}: {
  data: Snapshot;
  config: Config;
  connection: "connecting" | "live" | "reconnecting";
  refresh: () => void;
}) {
  const key = storageKey(data.run_id);
  const [messages, setMessages] = useState<WaveMessage[]>(() =>
    readMessages(key),
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [responseExpression, setResponseExpression] =
    useState<WaveExpression | null>(null);
  const sendingRef = useRef(false);
  const wasOpenRef = useRef(false);
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
      // The live assistant works even if this browser blocks session storage.
    }
  }, [key, messages]);

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
        setFocused(false);
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
    const timer = window.setTimeout(() => setResponseExpression(null), 2200);
    return () => window.clearTimeout(timer);
  }, [responseExpression]);

  const lastMessage = messages.at(-1);
  const expression: WaveExpression =
    connection !== "live"
      ? "offline"
      : sending
        ? "thinking"
        : lastMessage?.error || activeAlerts
          ? "alert"
          : (responseExpression ?? (focused && open ? "focused" : "idle"));

  async function ask(question: string, addUserMessage = true) {
    const text = question.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setResponseExpression(null);
    if (addUserMessage) {
      setMessages((current) =>
        [...current, makeMessage("user", text)].slice(-MAX_MESSAGES),
      );
    }
    setDraft("");

    try {
      // Reuse SuliNOC's authenticated, read-only snapshot API. The question
      // stays in this tab; only telemetry is fetched from the existing backend.
      const latest: Snapshot = await api.delta(data.tick);
      if (latest.run_id !== data.run_id) {
        throw new Error(
          "The simulation was reset while I was checking. Please send your question again.",
        );
      }
      const reply = answerWave(text, latest, config);
      setMessages((current) =>
        [...current, makeMessage("assistant", reply.text)].slice(-MAX_MESSAGES),
      );
      setResponseExpression(reply.expression);
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
    ? `${String(data.ai.ai_mode).toUpperCase()} predictor`
    : "Predictor off";

  return (
    <div className="wave-assistant">
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
                {connection === "live" ? "Live data" : "Reconnecting"}
                <span className="wave-predictor">· {predictorLabel}</span>
              </span>
            </div>
            <button
              className="wave-icon-button"
              type="button"
              aria-label="Close Wave panel"
              title="Close assistant"
              onClick={() => {
                setOpen(false);
                setFocused(false);
                launcherRef.current?.focus();
              }}
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
                Checking the latest simulation snapshot…
              </div>
            )}
          </div>

          <form className="wave-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="wave-message-input">
              Message Wave
            </label>
            <textarea
              id="wave-message-input"
              ref={inputRef}
              rows={1}
              maxLength={500}
              placeholder="Ask about the network…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
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
              Grounded in this simulation · no external chat model configured
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
        onClick={() => {
          setOpen((current) => !current);
          if (open) setFocused(false);
        }}
      >
        <WaveMascot expression={expression} className="wave-launcher-mascot" />
        {activeAlerts > 0 && (
          <span
            className="wave-alert-badge"
            aria-label={`${activeAlerts} active incidents`}
          >
            {activeAlerts > 9 ? "9+" : activeAlerts}
          </span>
        )}
        <span className="wave-launcher-label">Wave</span>
      </button>
    </div>
  );
}
