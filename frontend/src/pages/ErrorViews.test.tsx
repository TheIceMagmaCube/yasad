import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../test-utils";
import { Forbidden, NotFound } from "./ErrorViews";

afterEach(cleanup);

const banner = () => document.querySelector('[data-slot="error-banner"]')!;

describe("ErrorViews", () => {
  it("titles the not-found page, gives it a focus target and a way home", () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toHaveAttribute("tabindex", "-1");
    expect(document.title).toBe("Page not found - YASAD");
    expect(screen.getByRole("link", { name: "Back to my links" })).toHaveAttribute("href", "/");
  });

  it("shows the status code on a decorative dusk banner that assistive technologies skip", () => {
    renderWithProviders(<NotFound />);
    expect(banner()).toHaveAttribute("aria-hidden", "true");
    expect(banner()).toHaveTextContent("404");
    expect(banner().querySelectorAll("svg")).toHaveLength(1);
  });

  it("tells a non-administrator the page is for admins, with its own code", () => {
    renderWithProviders(<Forbidden />);
    expect(screen.getByRole("heading", { level: 1, name: "Admins only" })).toHaveAttribute("tabindex", "-1");
    expect(document.title).toBe("Admins only - YASAD");
    expect(banner()).toHaveTextContent("403");
  });
});
