/** Types shared by the content-script controllers. */

import type { Transcript } from "./transcript";
import { t } from "../utils/i18n";

export interface Extractor {
  getTranscript: (preferredCaptionLanguage?: string) => Promise<Transcript>;
  clearTranscriptCache?: (videoId: string) => void | Promise<void>;
  /** Notifies when the page itself loaded usable captions for a video. */
  onCaptionsAvailable?: (listener: (videoId: string) => void) => () => void;
  getVideoTitle: () => string;
  getVideoId: () => string;
  isOnVideoPage: () => boolean;
}

export interface ContentScriptConfig {
  /** Find injection target — used on initial load + SPA rebuilds */
  findInjectTarget: () => HTMLElement | null;
}

/** A message kept as key + substitutions so it re-renders after a UI language switch. */
export interface LocalizedMessage {
  key: string;
  substitutions?: string | string[];
}

export function localizedText(message: LocalizedMessage | null): string {
  return message ? t(message.key, message.substitutions) : "";
}
