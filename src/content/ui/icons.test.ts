import { describe, expect, it } from "vitest";
import { aiSummaryIconMarkup, translationToggleIconMarkup } from "./icons";

describe("aiSummaryIconMarkup", () => {
  it("renders the plain monochrome mark by default", () => {
    const markup = aiSummaryIconMarkup(16, "test-icon");

    expect(markup).toContain('class="test-icon"');
    expect(markup).toContain('width="16" height="16"');
    expect(markup).toContain('data-icon="ai-summary"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M3 7.5h6M3 12h7.5M3 17h5.5");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/[★☆✦✧]/);
  });

  it("renders the translation-off mark in currentColor", () => {
    const markup = translationToggleIconMarkup(24, "", "translation-off");

    expect(markup).toContain('data-icon-variant="translation-off"');
    expect(markup).toContain("M2.5 6.75h10M2.5 11.75h4.27M2.5 16.75h6M11.7 16.75h1.6");
    expect(markup).toContain('transform="translate(-2)"');
    expect(markup).toContain('overflow="visible"');
    expect(markup).toContain('stroke-width="1.9"');
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M17 5.3c.6 3.7 3 6.1 6.7 6.7");
    expect(markup).toContain('stroke="currentColor" stroke-width="0.6"');
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain("M21 3H3C2.46 3");
    expect(markup).not.toContain("linearGradient");
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("renders only the active translation mark with the themed gradient", () => {
    const markup = translationToggleIconMarkup(24, "", "translation-on");

    expect(markup).toContain('data-icon-variant="translation-on"');
    expect(markup).toContain('stop-color="#ff3d4a"');
    expect(markup).toContain('stop-color="#ff7100"');
    expect(markup).toContain('fill="url(#vas-translation-active-gradient)"');
    expect(markup).toContain('stroke="url(#vas-translation-active-gradient)"');
    expect(markup).toContain('stroke="currentColor"');
  });
});
