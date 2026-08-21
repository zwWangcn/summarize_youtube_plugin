export type SubtitleStylePreset = "classic" | "cinema" | "minimal" | "custom";

export interface SubtitleStyleSettings {
  preset: SubtitleStylePreset;
  sourceFontScale: number;
  translationFontScale: number;
  sourceColor: string;
  translationColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  bottomOffset: number;
}

type BuiltInSubtitleStylePreset = Exclude<SubtitleStylePreset, "custom">;

export const SUBTITLE_STYLE_PRESETS: Record<
  BuiltInSubtitleStylePreset,
  SubtitleStyleSettings
> = {
  classic: {
    preset: "classic",
    sourceFontScale: 100,
    translationFontScale: 100,
    sourceColor: "#DBDBDB",
    translationColor: "#FFFFFF",
    backgroundColor: "#080808",
    backgroundOpacity: 76,
    bottomOffset: 11,
  },
  cinema: {
    preset: "cinema",
    sourceFontScale: 105,
    translationFontScale: 115,
    sourceColor: "#F3F4F6",
    translationColor: "#FFFFFF",
    backgroundColor: "#000000",
    backgroundOpacity: 88,
    bottomOffset: 14,
  },
  minimal: {
    preset: "minimal",
    sourceFontScale: 90,
    translationFontScale: 100,
    sourceColor: "#D1D5DB",
    translationColor: "#FFFFFF",
    backgroundColor: "#000000",
    backgroundOpacity: 35,
    bottomOffset: 11,
  },
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  ...SUBTITLE_STYLE_PRESETS.classic,
};

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePreset(value: unknown): SubtitleStylePreset {
  return value === "classic" || value === "cinema" || value === "minimal" || value === "custom"
    ? value
    : "classic";
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toUpperCase()
    : fallback;
}

/** Normalize synced or legacy data one field at a time without mutating the input. */
export function normalizeSubtitleStyle(value: unknown): SubtitleStyleSettings {
  const input = isRecord(value) ? value : {};
  const preset = normalizePreset(input.preset);
  const presetDefaults = preset === "custom"
    ? DEFAULT_SUBTITLE_STYLE
    : SUBTITLE_STYLE_PRESETS[preset];

  return {
    preset,
    sourceFontScale: normalizeInteger(
      input.sourceFontScale,
      presetDefaults.sourceFontScale,
      75,
      150,
    ),
    translationFontScale: normalizeInteger(
      input.translationFontScale,
      presetDefaults.translationFontScale,
      75,
      150,
    ),
    sourceColor: normalizeColor(input.sourceColor, presetDefaults.sourceColor),
    translationColor: normalizeColor(
      input.translationColor,
      presetDefaults.translationColor,
    ),
    backgroundColor: normalizeColor(input.backgroundColor, presetDefaults.backgroundColor),
    backgroundOpacity: normalizeInteger(
      input.backgroundOpacity,
      presetDefaults.backgroundOpacity,
      0,
      95,
    ),
    bottomOffset: normalizeInteger(
      input.bottomOffset,
      presetDefaults.bottomOffset,
      8,
      35,
    ),
  };
}
