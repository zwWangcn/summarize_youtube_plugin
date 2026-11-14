const AI_SUMMARY_ICON_BODY = `
  <path d="M17.5 3.5c.45 3.75 2.25 5.55 6 6-3.75.45-5.55 2.25-6 6-.45-3.75-2.25-5.55-6-6 3.75-.45 5.55-2.25 6-6Z" fill="var(--vas-accent-brand)"/>
  <path d="M3 7.5h6M3 12h7.5M3 17h5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
`;

export type TranslationToggleIconVariant = "translation-off" | "translation-on";

/** 1.6px-stroke line icons for panel chrome (lucide-style geometry). */
const UI_ICON_PATHS = {
  close: `<path d="M18 6 6 18M6 6l12 12"/>`,
  copy: `<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>`,
  "reset-width": `<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>`,
  trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>`,
} as const;

export type UiIconName = keyof typeof UI_ICON_PATHS;

export function uiIconMarkup(name: UiIconName, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${UI_ICON_PATHS[name]}</svg>`;
}

/** AI-summary glyph with neutral text lines and a branded red sparkle. */
export function aiSummaryIconMarkup(
  size = 24,
  className = "",
): string {
  const classAttribute = className ? ` class="${className}"` : "";
  return `<svg${classAttribute} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" data-icon="ai-summary" aria-hidden="true" focusable="false">${AI_SUMMARY_ICON_BODY}</svg>`;
}

/** Borderless translation glyph; the active sparkle uses the shared accent. */
export function translationToggleIconMarkup(
  size = 24,
  className = "",
  variant: TranslationToggleIconVariant = "translation-off",
): string {
  const classAttribute = className ? ` class="${className}"` : "";
  const active = variant === "translation-on";
  const sparklePaint = active ? "var(--vas-accent-brand)" : "currentColor";

  return `<svg${classAttribute} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" overflow="visible" data-icon-variant="${variant}" aria-hidden="true" focusable="false"><path d="M2.5 6.75h10M2.5 11.75h4.27M2.5 16.75h6M11.7 16.75h1.6" transform="translate(-2)" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17 5.3c.6 3.7 3 6.1 6.7 6.7-3.7.6-6.1 3-6.7 6.7-.6-3.7-3-6.1-6.7-6.7 3.7-.6 6.1-3 6.7-6.7Z" fill="${sparklePaint}" stroke="${sparklePaint}" stroke-width="0.6" stroke-linejoin="round" paint-order="stroke"/></svg>`;
}
