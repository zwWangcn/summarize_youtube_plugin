export type SubtitleStylePreset = "classic" | "cinema" | "minimal" | "custom";

export interface SubtitleStyleSettings {
  preset: SubtitleStylePreset;
  sourceFontScale: number;
  translationFontScale: number;
  sourceColor: string;
  translationColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundPaddingScale: number;
  maxWidth: number;
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
    backgroundPaddingScale: 100,
    maxWidth: 100,
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
    backgroundPaddingScale: 115,
    maxWidth: 95,
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
    backgroundPaddingScale: 75,
    maxWidth: 85,
    bottomOffset: 11,
  },
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  ...SUBTITLE_STYLE_PRESETS.classic,
};

export interface SubtitleTypographyCssValues {
  sourceFontSize: string;
  translationFontSize: string;
  sourceColor: string;
  translationColor: string;
}

export interface SubtitleContainerCssValues {
  background: string;
  boxShadow: string;
  padding: string;
  maxWidth: string;
}

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
    backgroundPaddingScale: normalizeInteger(
      input.backgroundPaddingScale,
      presetDefaults.backgroundPaddingScale,
      50,
      200,
    ),
    maxWidth: normalizeInteger(input.maxWidth, presetDefaults.maxWidth, 40, 100),
    bottomOffset: normalizeInteger(
      input.bottomOffset,
      presetDefaults.bottomOffset,
      8,
      35,
    ),
  };
}

function responsiveFontSize(scale: number, minPx: number, fluidVw: number, maxPx: number): string {
  const factor = scale / 100;
  const scaled = (value: number) => Number((value * factor).toFixed(4));
  return `clamp(${scaled(minPx)}px, ${scaled(fluidVw)}vw, ${scaled(maxPx)}px)`;
}

/** Convert persisted typography values into safe Shadow DOM CSS values. */
export function getSubtitleTypographyCssValues(
  value: unknown,
): SubtitleTypographyCssValues {
  const style = normalizeSubtitleStyle(value);
  return {
    sourceFontSize: responsiveFontSize(style.sourceFontScale, 15, 1.65, 24),
    translationFontSize: responsiveFontSize(style.translationFontScale, 17, 1.9, 28),
    sourceColor: style.sourceColor,
    translationColor: style.translationColor,
  };
}

/** Convert background sizing and opacity into safe Shadow DOM CSS values. */
export function getSubtitleContainerCssValues(value: unknown): SubtitleContainerCssValues {
  const style = normalizeSubtitleStyle(value);
  const rgb = [
    Number.parseInt(style.backgroundColor.slice(1, 3), 16),
    Number.parseInt(style.backgroundColor.slice(3, 5), 16),
    Number.parseInt(style.backgroundColor.slice(5, 7), 16),
  ];
  const factor = style.backgroundPaddingScale / 100;
  const scaled = (size: number) => Number((size * factor).toFixed(2));
  const shadowOpacity = Number((style.backgroundOpacity / 100 * 0.29).toFixed(3));
  return {
    background: `rgba(${rgb.join(", ")}, ${style.backgroundOpacity / 100})`,
    boxShadow: shadowOpacity === 0
      ? "none"
      : `0 2px 12px rgba(0, 0, 0, ${shadowOpacity})`,
    padding: `${scaled(7)}px ${scaled(13)}px ${scaled(8)}px`,
    maxWidth: `${style.maxWidth}%`,
  };
}
