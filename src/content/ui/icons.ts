/** Shared bilingual-subtitle glyph used by YouTube-facing extension UI. */
export const BILINGUAL_SUBTITLES_ICON_BODY = `
  <rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M3 12h18M6 8h7m2 0h3M6 16h4m2 0h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
`;

export function bilingualSubtitlesIconMarkup(size = 24, className = ""): string {
  const classAttribute = className ? ` class="${className}"` : "";
  return `<svg${classAttribute} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true" focusable="false">${BILINGUAL_SUBTITLES_ICON_BODY}</svg>`;
}
