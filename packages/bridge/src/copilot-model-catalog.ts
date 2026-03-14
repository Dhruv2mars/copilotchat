export interface CatalogModel {
  id: string;
  label: string;
}

export const OPENCODE_COPILOT_MODEL_CATALOG: CatalogModel[] = [
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5" },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "claude-opus-41", label: "Claude Opus 4.1" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (Preview)" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "gpt-5.1", label: "GPT-5.1" },
  { id: "gpt-5.1-codex", label: "GPT-5.1-Codex" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "grok-code-fast-1", label: "Grok Code Fast 1" }
];

export const KNOWN_UNAVAILABLE_COPILOT_MODELS = new Set([
  "claude-opus-41",
  "claude-sonnet-4.6",
  "gpt-5",
  "gpt-5.4"
]);
