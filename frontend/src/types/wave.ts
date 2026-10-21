export type WaveExpression =
  "idle" | "thinking" | "responding" | "alert" | "offline";

export type WaveTurn = {
  role: "user" | "assistant";
  content: string;
};

export type WaveProviderState = {
  provider: "openai";
  model: string;
  configured: boolean;
  verified: boolean;
  status:
    "checking" | "missing_key" | "not_verified" | "connected" | "unavailable";
  detail?: string;
};

export type WaveChatReply = {
  answer: string;
  provider: "openai";
  model: string;
  ai_connected: boolean;
  run_id: string;
  tick: number;
  sim_time: string;
};
