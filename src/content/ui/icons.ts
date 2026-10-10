const AI_SUMMARY_ICON_BODY = `
  <path d="M17.5 3.5c.45 3.75 2.25 5.55 6 6-3.75.45-5.55 2.25-6 6-.45-3.75-2.25-5.55-6-6 3.75-.45 5.55-2.25 6-6Z" fill="var(--vas-accent-brand)"/>
  <path d="M3 7.5h6M3 12h7.5M3 17h5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
`;

export type TranslationToggleIconVariant = "translation-off" | "translation-on";

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
