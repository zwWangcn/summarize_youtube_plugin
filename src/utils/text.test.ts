import { describe, expect, it } from "vitest";
import { formatTime, parseTimestampToSeconds } from "./text";

describe("timestamp helpers", () => {
  it("round-trips timestamps beyond one hour", () => {
    const seconds = 3_723;
    expect(formatTime(seconds)).toBe("1:02:03");
    expect(parseTimestampToSeconds(formatTime(seconds))).toBe(seconds);
  });

  it("accepts non-padded hour timestamps commonly returned by AI", () => {
    expect(parseTimestampToSeconds("1:2:03")).toBe(3_723);
    expect(parseTimestampToSeconds("12：3：04")).toBe(43_384);
  });

  it("treats two-part timestamps as total minutes even beyond one hour", () => {
    expect(parseTimestampToSeconds("76:20")).toBe(4_580);
    expect(parseTimestampToSeconds("76：20")).toBe(4_580);
    expect(parseTimestampToSeconds("123:45")).toBe(7_425);
  });

  it("rejects malformed or out-of-range timestamps", () => {
    expect(parseTimestampToSeconds("1:60:00")).toBeNull();
    expect(parseTimestampToSeconds("1:02:3")).toBeNull();
    expect(parseTimestampToSeconds("1x:02:03")).toBeNull();
  });
});
