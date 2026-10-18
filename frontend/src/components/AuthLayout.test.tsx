import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../test-utils";
import { AuthLayout } from "./AuthLayout";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("AuthLayout", () => {
  it("puts the actions, the language and the appearance before the content, with no footer", () => {
    renderWithProviders(
      <AuthLayout actions={<button type="button">Sign out</button>}>
        <h1>Sign in</h1>
      </AuthLayout>,
    );
    const preferences = screen.getByRole("group", { name: "Preferences" });
    const action = screen.getByRole("button", { name: "Sign out" });
    expect(follows(action, preferences)).toBe(true);
    expect(within(preferences).getByRole("combobox")).toHaveAccessibleName("Language / Langue");
    expect(within(preferences).getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    expect(within(preferences).getAllByRole("radio")).toHaveLength(3);
    expect(follows(preferences, screen.getByRole("main"))).toBe(true);
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("One clean screen");
  });

  it("names the language in every language, each option in its own", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuthLayout>
        <h1>Sign in</h1>
      </AuthLayout>,
    );
    const select = screen.getByLabelText("Language / Langue");
    expect([...select.querySelectorAll("option")].map((o) => [o.textContent, o.lang])).toEqual([
      ["English", "en"],
      ["Français", "fr"],
    ]);
    const label = document.querySelector(`label[for="${select.id}"]`)!;
    expect([...label.querySelectorAll("[lang]")].map((el) => el.getAttribute("lang"))).toEqual(["en", "fr"]);
    await user.selectOptions(select, "fr");
    expect(screen.getByRole("group", { name: "Préférences" })).toBeInTheDocument();
    expect(localStorage.getItem("yasad.language")).toBe("fr");
  });
});
