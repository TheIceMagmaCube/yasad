import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Instance, InstanceContext } from "../instance";
import { mockApi, renderWithProviders } from "../test-utils";
import { SignedOut } from "./SignedOut";

const INSTANCE: Instance = { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: false, oidc: { name: "Okta" } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWith(instance: Partial<Instance>) {
  return renderWithProviders(
    <InstanceContext value={{ ...INSTANCE, ...instance }}>
      <SignedOut />
    </InstanceContext>,
  );
}

describe("SignedOut", () => {
  it("says the person is signed out and offers the provider without starting it", async () => {
    const fetchMock = mockApi({});
    renderWith({});
    expect(screen.getByRole("heading", { level: 1, name: "You are signed out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Administrator? Sign in with a password" })).toHaveAttribute("href", "/sign-in/local");
    await waitFor(() => expect(document.title).toBe("You are signed out - YASAD"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says goodbye with a line drawn from the farewells, over the desk asleep", () => {
    mockApi({});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = renderWith({});
    expect(screen.getByText("See you soon! Your links will keep the seat warm.")).toBeInTheDocument();
    expect(container.querySelector("main svg[data-state]")).toHaveAttribute("data-state", "asleep");
  });

  it("links to the password form when password sign-in is on", () => {
    mockApi({});
    renderWith({ passwordSignIn: true });
    expect(screen.getByRole("link", { name: "Sign in with a password" })).toHaveAttribute("href", "/sign-in");
  });

  it("links to the sign-in screen without a provider", () => {
    mockApi({});
    renderWith({ passwordSignIn: true, oidc: null });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/sign-in");
  });
});
