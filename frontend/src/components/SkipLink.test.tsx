import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../test-utils";
import { AuthLayout } from "./AuthLayout";
import { SkipLink } from "./SkipLink";

afterEach(cleanup);

describe("SkipLink", () => {
  it("points at the content by default", () => {
    renderWithProviders(<SkipLink />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#content");
  });

  it("is the first stop of the signed-out layout, before the brand", async () => {
    renderWithProviders(<AuthLayout>Form</AuthLayout>);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "YASAD" })).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });
});
