import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("keeps a typography utility next to a text color", () => {
    expect(cn("text-title", "text-muted-foreground")).toBe("text-title text-muted-foreground");
  });

  it("lets a later size or shadow override an earlier one", () => {
    expect(cn("text-sm", "text-caption")).toBe("text-caption");
    expect(cn("shadow-sm", "shadow-card")).toBe("shadow-card");
  });
});
