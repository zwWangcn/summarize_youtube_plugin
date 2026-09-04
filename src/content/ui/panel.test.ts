import { describe, expect, it } from "vitest";
import { getSummarizeButtonMessageKey } from "./panel";

describe("summary button label", () => {
  it("offers to reopen the summary while the transcript is displayed", () => {
    expect(getSummarizeButtonMessageKey("transcript", true)).toBe("aiSummary");
  });

  it("offers to regenerate only while the reusable summary is displayed", () => {
    expect(getSummarizeButtonMessageKey("summary", true)).toBe("summarizeAgain");
  });

  it("offers an initial summary when no reusable result exists", () => {
    expect(getSummarizeButtonMessageKey("summary", false)).toBe("aiSummary");
  });
});
