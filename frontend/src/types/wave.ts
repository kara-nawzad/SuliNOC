export type WaveExpression =
  "idle" | "thinking" | "responding" | "alert" | "offline";

/** "local" is Wave's deterministic snapshot reader: used whenever the live
 * provider cannot answer, so the assistant never goes silent. */
export type WaveProvider = "openai" | "groq" | "local";

export type WaveTurn = {
  role: "user" | "assistant";
  content: string;
};

export type WaveProviderState = {
  provider: WaveProvider;
  model: string;
  configured: boolean;
  verified: boolean;
  status:
    "checking" | "missing_key" | "not_verified" | "connected" | "unavailable";
  /** "local" means answers come from the run snapshot, not the live model. */
  mode?: "live" | "local";
  detail?: string;
};

export type WaveChatReply = {
  answer: string;
  provider: WaveProvider;
  model: string;
  ai_connected: boolean;
  run_id: string;
  tick: number;
  sim_time: string;
  /** The run rolled over (Day-30 restart) while the question was in flight. */
  run_restarted?: boolean;
};
