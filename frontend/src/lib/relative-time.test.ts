import { describe, expect, it } from "vitest";

import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { formatRelative } from "./relative-time";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Intl puts no-break spaces between a number and its unit; the test reads them as plain spaces.
const plain = (iso: string | null, language: string) => formatRelative(iso, language, language === "fr" ? fr : en, NOW).text.replace(/\s/g, " ");

describe("formatRelative", () => {
  it("says never for a date that is not there, with no exact date", () => {
    expect(formatRelative(null, "en", en, NOW)).toEqual({ text: "never", exact: null });
    expect(plain(null, "fr")).toBe("jamais");
  });

  it("counts minutes, hours and days in English, then gives the day, the year only when it differs", () => {
    expect(formatRelative(ago(20_000), "en", en, NOW).text).toBe("just now");
    expect(formatRelative(ago(5 * MINUTE), "en", en, NOW).text).toBe("5 min. ago");
    expect(formatRelative(ago(3 * HOUR), "en", en, NOW).text).toBe("3 hr. ago");
    expect(formatRelative(ago(2 * DAY), "en", en, NOW).text).toBe("2 days ago");
    expect(formatRelative("2026-08-20T10:00:00.000Z", "en", en, NOW).text).toBe("Aug 20");
    expect(formatRelative("2025-08-20T10:00:00.000Z", "en", en, NOW).text).toBe("Aug 20, 2025");
  });

  it("says the same in French, the day introduced by le", () => {
    expect(plain(ago(20_000), "fr")).toBe("à l'instant");
    expect(plain(ago(3 * HOUR), "fr")).toBe("il y a 3 h");
    expect(plain(ago(2 * DAY), "fr")).toBe("il y a 2 j");
    expect(plain("2026-08-20T10:00:00.000Z", "fr")).toBe("le 20 août");
    expect(plain("2025-08-20T10:00:00.000Z", "fr")).toBe("le 20 août 2025");
  });

  it("gives the full date and time as the exact value", () => {
    expect(formatRelative(ago(3 * HOUR), "en", en, NOW).exact).toMatch(/^October 19, 2026 at \d{1,2}:00 [AP]M$/);
  });
});
