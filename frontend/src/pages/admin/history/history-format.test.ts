import { describe, expect, it } from "vitest";

import { en } from "../../../i18n/en";
import { fieldRows, objectHref, objectLabel, valueText } from "./history-format";

describe("history-format: instance entries", () => {
  const entry = {
    id: 1,
    at: "2026-11-14T10:00:00.000Z",
    actor: null,
    action: "update" as const,
    object: { type: "instance" as const, id: null, label: null, exists: true },
    related: null,
    before: { title: "Lab", logo: "image:0123456789abcdef0123456789abcdef", theme: null },
    after: { title: "Lab", logo: "image:fedcba9876543210fedcba9876543210", theme: "dusk" },
    details: null,
  };

  it("names the appearance and links to its page", () => {
    expect(objectLabel(entry.object, en)).toBe("Appearance");
    expect(objectHref(entry.object)).toBe("/admin/appearance");
  });

  it("tells two uploaded images apart by the start of their id, and names the theme", () => {
    expect(fieldRows(entry).rows.map((r) => r.field)).toEqual(["logo", "theme"]);
    expect(valueText("instance", "logo", entry.before.logo, en)).toBe("Uploaded image 01234567");
    expect(valueText("instance", "logo", entry.after.logo, en)).toBe("Uploaded image fedcba98");
    expect(valueText("instance", "theme", "dusk", en)).toBe("Dusk");
    expect(valueText("instance", "theme", null, en)).toBe("(none)");
  });

  it("shows a text that only looks like an image reference as written", () => {
    const ref = "image:0123456789abcdef0123456789abcdef";
    expect(valueText("link", "title", ref, en)).toBe(ref);
    expect(valueText("category", "name", "image: the gallery", en)).toBe("image: the gallery");
    expect(valueText("instance", "title", ref, en)).toBe(ref);
    expect(valueText("instance", "logo", "image:not-an-id", en)).toBe("image:not-an-id");
    expect(valueText("link", "icon", ref, en)).toBe("Uploaded image 01234567");
  });
});
