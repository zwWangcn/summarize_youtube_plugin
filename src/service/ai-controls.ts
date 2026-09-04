export const MAX_CUSTOM_PROMPT_PROFILES = 10;
export const MAX_CUSTOM_PROMPT_NAME_CHARS = 30;
export const MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS = 500;

export interface CustomPromptProfile {
  id: string;
  name: string;
  instruction: string;
}

export type CustomPromptValidationCode =
  | "name-required"
  | "name-too-long"
  | "name-duplicate"
  | "instruction-required"
  | "instruction-too-long"
  | "profile-limit";

export class CustomPromptValidationError extends Error {
  constructor(public readonly code: CustomPromptValidationCode) {
    super(code);
    this.name = "CustomPromptValidationError";
  }
}

export const TRANSLATION_CHUNK_PRESETS = ["fast", "balanced", "context"] as const;
export type TranslationChunkPreset = (typeof TRANSLATION_CHUNK_PRESETS)[number];

export interface TranslationChunkLimits {
  maxSeconds: number;
  maxChars: number;
}

export const DEFAULT_TRANSLATION_CHUNK_PRESET: TranslationChunkPreset = "balanced";

const CHUNK_LIMITS: Record<TranslationChunkPreset, TranslationChunkLimits> = {
  fast: { maxSeconds: 30, maxChars: 2_000 },
  balanced: { maxSeconds: 60, maxChars: 4_000 },
  context: { maxSeconds: 120, maxChars: 8_000 },
};

export function unicodeLength(value: string): number {
  return [...value].length;
}

export function truncateUnicode(value: string, maxChars: number): string {
  return [...value].slice(0, maxChars).join("");
}

export function isTranslationChunkPreset(value: unknown): value is TranslationChunkPreset {
  return typeof value === "string" &&
    TRANSLATION_CHUNK_PRESETS.includes(value as TranslationChunkPreset);
}

export function normalizeTranslationChunkPreset(value: unknown): TranslationChunkPreset {
  return isTranslationChunkPreset(value) ? value : DEFAULT_TRANSLATION_CHUNK_PRESET;
}

export function getTranslationChunkLimits(value: unknown): TranslationChunkLimits {
  return CHUNK_LIMITS[normalizeTranslationChunkPreset(value)];
}

export function normalizeCustomPromptProfile(value: unknown): CustomPromptProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Partial<CustomPromptProfile>;
  if (
    typeof profile.id !== "string" || !profile.id.trim() ||
    typeof profile.name !== "string" || !profile.name.trim() ||
    typeof profile.instruction !== "string" || !profile.instruction.trim()
  ) return null;
  const name = profile.name.trim();
  const instruction = profile.instruction.trim();
  if (
    unicodeLength(name) > MAX_CUSTOM_PROMPT_NAME_CHARS ||
    unicodeLength(instruction) > MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS
  ) return null;
  return { id: profile.id, name, instruction };
}
