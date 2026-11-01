/** Source-caption preference, independent of AI output and UI languages. */
export function normalizeCaptionLanguage(value: unknown): string {
  if (typeof value !== "string" || value.length > 35 || !value.trim()) return "en";
  try {
    const code = Intl.getCanonicalLocales(value.trim().replaceAll("_", "-"))[0];
    return code && /^[a-z]{2,3}(?:-|$)/i.test(code) ? code : "en";
  } catch { return "en"; }
}
