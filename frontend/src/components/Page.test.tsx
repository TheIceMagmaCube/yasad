import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Page } from "./Page";

afterEach(cleanup);

describe("Page", () => {
  it.each([
    ["form", "max-w-sm"],
    ["reading", "max-w-2xl"],
    ["list", "max-w-none"],
  ] as const)("gives the %s width its class, aligned to the start", (width, className) => {
    render(<Page width={width}>Content</Page>);
    const page = screen.getByText("Content");
    expect(page).toHaveClass(className, "w-full");
    expect(page).not.toHaveClass("mx-auto");
  });
});
