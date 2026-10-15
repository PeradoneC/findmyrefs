// Selectable Anthropic models and list prices (USD per million tokens), for display
// and pre-request information only. The backend computes the recorded estimates
// (src-tauri/src/pricing.rs - keep in sync). Prices change; the Anthropic Console
// billing page is authoritative.

export type ModelInfo = {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  note?: string;
};

export const PRICES_AS_OF = "2026-10";

export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5 (most capable, default)",
    inputPerMTok: 4,
    outputPerMTok: 20,
  },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5 (lowest cost)",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    note: "Prompts over 100K tokens are billed at $0.50 / $2.50.",
  },
];

export function modelInfo(id: string): ModelInfo | undefined {
  return ANTHROPIC_MODELS.find((m) => m.id === id);
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
