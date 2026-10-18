import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InstanceContext } from "../instance";
import { Brand } from "./Brand";

afterEach(cleanup);

const instance = { title: "Acme portal", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: null } as const;

describe("Brand", () => {
  it("links the instance title to the home page", () => {
    render(
      <InstanceContext value={instance}>
        <Brand />
      </InstanceContext>,
    );
    expect(screen.getByRole("link", { name: "Acme portal" })).toHaveAttribute("href", "/");
  });

  it("sets the logo on a key cap in the header and keeps the bare logo and the wordmark on the panel", () => {
    const { container, rerender } = render(
      <InstanceContext value={instance}>
        <Brand />
      </InstanceContext>,
    );
    expect(container.querySelector("svg")!.parentElement).toHaveClass("pixel-corners", "bg-primary", "text-primary-foreground");
    expect(screen.getByText("Acme portal")).toHaveClass("text-pixel");
    rerender(
      <InstanceContext value={instance}>
        <Brand size="panel" />
      </InstanceContext>,
    );
    expect(container.querySelector("svg")!.parentElement).toBe(screen.getByRole("link"));
    expect(screen.getByText("Acme portal")).toHaveClass("wordmark");
  });

  it("draws its focus as an outline, which forced colors mode keeps", () => {
    render(
      <InstanceContext value={instance}>
        <Brand />
      </InstanceContext>,
    );
    expect(screen.getByRole("link")).toHaveClass("focus-visible:outline-2", "focus-visible:outline-solid");
  });

  it("uses the instance logo as a decorative image", () => {
    const { container } = render(
      <InstanceContext value={{ ...instance, logo: "/logo.png" }}>
        <Brand size="panel" />
      </InstanceContext>,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.getByRole("link", { name: "Acme portal" })).toBeInTheDocument();
  });
});
