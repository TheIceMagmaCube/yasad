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
  it("puts the actions and the language before the content, and the appearance in the footer", () => {
    renderWithProviders(
      <AuthLayout actions={<button type="button">Sign out</button>}>
        <h1>Sign in</h1>
      </AuthLayout>,
    );
    const preferences = screen.getByRole("group", { name: "Preferences" });
    const [action, language] = preferences.querySelectorAll("button, select");
    expect(action).toHaveAccessibleName("Sign out");
    expect(language).toHaveAccessibleName("Language / Langue");
    expect(follows(preferences, screen.getByRole("main"))).toBe(true);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByLabelText("Appearance")).toBeInTheDocument();
    expect(within(footer).queryByLabelText(/Language/)).toBeNull();
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
