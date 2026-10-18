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
