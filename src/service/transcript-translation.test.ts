import { describe, expect, it } from "vitest";
import {
  buildTranslationChunks,
  validateTranslationOutput,
  validateTranslationLine,
  TranslationFormatError,
} from "./transcript-translation";
import type { TranscriptSegment } from "../content/transcript";

function segment(text: string, start: number = 0): TranscriptSegment {
  return { start, duration: 1, text };
}

describe("buildTranslationChunks", () => {
  it("covers all segments exactly once without splitting a segment", () => {
    const segments = [
      segment("aaaa", 0),
      segment("bbbb", 1),
      segment("cccc", 2),
      segment("dddd", 3),
    ];
    const chunks = buildTranslationChunks(segments, 30);

    expect(chunks.map(({ targetStart, targetEnd }) => [targetStart, targetEnd]))
      .toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(chunks[1].contextStart).toBe(0);
    expect(chunks[1].contextEnd).toBe(3);
  });

  it("returns no chunks for an empty transcript", () => {
    expect(buildTranslationChunks([])).toEqual([]);
  });

  it("assigns stable ids and never splits an oversized caption", () => {
    const segments = [
      segment("a".repeat(20), 0),
      segment("b".repeat(200), 1),
      segment("c".repeat(20), 2),
    ];
    const chunks = buildTranslationChunks(segments, 60);

    expect(chunks.map((chunk) => chunk.id)).toEqual([0, 1, 2]);
    expect(chunks.map(({ targetStart, targetEnd }) => [targetStart, targetEnd]))
      .toEqual([[0, 0], [1, 1], [2, 2]]);
  });
});

describe("validateTranslationOutput", () => {
  it("accepts merged, consecutive source ranges", () => {
    const raw = `\`\`\`json
[
  {"sourceStartId":0,"sourceEndId":1,"translatedText":"第一句。"},
  {"sourceStartId":2,"sourceEndId":3,"translatedText":"第二句。"}
]
\`\`\``;

    expect(validateTranslationOutput(raw, 0, 3)).toEqual([
      { sourceStartId: 0, sourceEndId: 1, translatedText: "第一句。" },
      { sourceStartId: 2, sourceEndId: 3, translatedText: "第二句。" },
    ]);
  });

  it("rejects gaps and overlapping ranges", () => {
    const gap = JSON.stringify([
      { sourceStartId: 0, sourceEndId: 0, translatedText: "一" },
      { sourceStartId: 2, sourceEndId: 2, translatedText: "三" },
    ]);
    expect(() => validateTranslationOutput(gap, 0, 2))
      .toThrow(TranslationFormatError);

    const overlap = JSON.stringify([
      { sourceStartId: 0, sourceEndId: 1, translatedText: "一" },
      { sourceStartId: 1, sourceEndId: 2, translatedText: "二" },
    ]);
    expect(() => validateTranslationOutput(overlap, 0, 2))
      .toThrow(TranslationFormatError);
  });

  it("rejects malformed or empty output", () => {
    expect(() => validateTranslationOutput("not json", 0, 0))
      .toThrow(TranslationFormatError);
    expect(() => validateTranslationOutput("[]", 0, 0))
      .toThrow(TranslationFormatError);
  });
});

describe("validateTranslationLine", () => {
  it("accepts the next consecutive NDJSON item", () => {
    expect(validateTranslationLine(
      '{"sourceStartId":4,"sourceEndId":6,"translatedText":"译文"}',
      4,
      9,
    )).toEqual({
      sourceStartId: 4,
      sourceEndId: 6,
      translatedText: "译文",
    });
  });

  it("rejects gaps and target-range overflow", () => {
    expect(() => validateTranslationLine(
      '{"sourceStartId":5,"sourceEndId":6,"translatedText":"译文"}',
      4,
      9,
    )).toThrow(TranslationFormatError);
    expect(() => validateTranslationLine(
      '{"sourceStartId":4,"sourceEndId":10,"translatedText":"译文"}',
      4,
      9,
    )).toThrow(TranslationFormatError);
  });
});
