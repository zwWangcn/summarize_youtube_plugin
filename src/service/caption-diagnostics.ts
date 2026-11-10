import { BUILD_VERSION, IS_TEST_BUILD } from "./build-info";
import type { Transcript } from "../content/transcript";
import type { TranslationChunk } from "./transcript-translation";

export interface CaptionDiagnosticContext { videoId: string; providerId: string; modelId: string }
export interface CaptionAttemptDiagnostic {
  attempt: number;
  protocol: "source-excerpts" | "fixed-cues";
  raw: string;
  code: string;
  reason?: string;
}
interface DiagnosticInput {
  context?: CaptionDiagnosticContext;
  targetLanguage: string;
  transcript: Transcript;
  chunk: TranslationChunk;
  attempts: CaptionAttemptDiagnostic[];
  outcome: "recovered" | "failed";
}

const STORAGE_KEY = "vas-caption-diagnostics";
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 3;
let writeQueue: Promise<void> = Promise.resolve();

/** Local, bounded test-build snapshots. No credentials, custom instructions or full prompts. */
export async function saveCaptionDiagnostic(input: DiagnosticInput, signal?: AbortSignal): Promise<void> {
  if (!IS_TEST_BUILD || signal?.aborted) return;
  const task = writeQueue.then(async () => {
    if (signal?.aborted) return;
    const { transcript, chunk } = input;
    const record = {
      schemaVersion: 1, buildVersion: BUILD_VERSION, timestamp: Date.now(), context: input.context,
      targetLanguage: input.targetLanguage, outcome: input.outcome,
      // This standalone target transcript can replay matching without the video or an API call.
      transcript: { ...transcript, segments: transcript.segments.slice(chunk.targetStart, chunk.targetEnd + 1) } as Transcript | undefined,
      chunk: { id: chunk.id, targetStart: 0, targetEnd: chunk.targetEnd - chunk.targetStart, contextStart: 0, contextEnd: chunk.targetEnd - chunk.targetStart },
      originalChunk: chunk,
      contextBefore: transcript.segments.slice(chunk.contextStart, chunk.targetStart).map((cue) => cue.text).join(" ").slice(-4000),
      contextAfter: transcript.segments.slice(chunk.targetEnd + 1, chunk.contextEnd + 1).map((cue) => cue.text).join(" ").slice(0, 4000),
      attempts: input.attempts.map((attempt) => ({ ...attempt, raw: attempt.raw.slice(0, 24_000),
        rawTruncated: attempt.raw.length > 24_000, reason: attempt.reason?.slice(0, 2000) })),
      sourceTruncated: false,
    };
    // Do not let an abnormally huge single source event exhaust extension storage.
    if (JSON.stringify(record).length > 160_000) { record.transcript = undefined; record.sourceTruncated = true; }
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    const records = Array.isArray(stored) ? stored.filter((item) => item && typeof item.timestamp === "number" && item.timestamp > Date.now() - TTL) : [];
    if (signal?.aborted) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: [...records, record].slice(-MAX_RECORDS) });
  }).catch(() => { /* Diagnostics must never affect translation, even if storage fails. */ });
  writeQueue = task;
  await task;
}

export async function downloadCaptionDiagnostics(videoId: string): Promise<void> {
  if (!IS_TEST_BUILD) return;
  await writeQueue;
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  const records = Array.isArray(stored) ? stored.filter((record) => record?.context?.videoId === videoId && record.timestamp > Date.now() - TTL) : [];
  const data = JSON.stringify({ schemaVersion: 1, buildVersion: BUILD_VERSION, videoId, records }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `caption-diagnostics-${videoId.replace(/[^\w-]/gu, "_")}.json`;
  document.body.append(anchor);
  anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
