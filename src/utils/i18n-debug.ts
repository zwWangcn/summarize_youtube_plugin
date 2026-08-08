const HAN_RE = /\p{Script=Han}/u;
const HIRAGANA_RE = /\p{Script=Hiragana}/u;
const KATAKANA_RE = /\p{Script=Katakana}/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const LATIN_RE = /\p{Script=Latin}/u;

export interface TextScriptStats {
  nonWhitespace: number;
  han: number;
  hiragana: number;
  katakana: number;
  hangul: number;
  latin: number;
}

/** Return only aggregate character counts; never include user content in logs. */
export function analyzeTextScripts(text: string): TextScriptStats {
  const stats: TextScriptStats = {
    nonWhitespace: 0,
    han: 0,
    hiragana: 0,
    katakana: 0,
    hangul: 0,
    latin: 0,
  };

  for (const character of text) {
    if (/\s/u.test(character)) continue;
    stats.nonWhitespace += 1;
    if (HAN_RE.test(character)) stats.han += 1;
    else if (HIRAGANA_RE.test(character)) stats.hiragana += 1;
    else if (KATAKANA_RE.test(character)) stats.katakana += 1;
    else if (HANGUL_RE.test(character)) stats.hangul += 1;
    else if (LATIN_RE.test(character)) stats.latin += 1;
  }

  return stats;
}

export function logI18nDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  // Deliberately log metadata only: never API keys, transcript text, or output text.
  console.info(`[vas][i18n-debug] ${event}`, details);
}
