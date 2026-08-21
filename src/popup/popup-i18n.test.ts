import { describe, expect, it, vi } from "vitest";
import {
  createPopupTranslator,
  formatCatalogMessage,
  type MessageCatalog,
} from "./popup-i18n";

const englishCatalog: MessageCatalog = {
  greeting: {
    message: "Hello, $NAME$! You have $COUNT$ items.",
    placeholders: {
      name: { content: "$1" },
      count: { content: "$2" },
    },
  },
  direct: { message: "Value: $1" },
  fallbackOnly: { message: "English fallback" },
};

describe("popup catalog translation", () => {
  it("formats named placeholders case-insensitively", () => {
    expect(formatCatalogMessage(englishCatalog, "GREETING", ["Ada", "3"]))
      .toBe("Hello, Ada! You have 3 items.");
  });

  it("formats direct positional substitutions", () => {
    expect(formatCatalogMessage(englishCatalog, "direct", "ready")).toBe("Value: ready");
  });

  it("falls back through English, Chrome, and finally the message key", () => {
    const chromeFallback = vi.fn((key: string) => key === "chromeOnly" ? "Chrome value" : "");
    const t = createPopupTranslator({}, englishCatalog, chromeFallback);

    expect(t("fallbackOnly")).toBe("English fallback");
    expect(t("chromeOnly")).toBe("Chrome value");
    expect(t("missing")).toBe("missing");
  });
});
