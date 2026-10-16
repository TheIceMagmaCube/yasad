import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { PasswordField } from "./PasswordField";

afterEach(cleanup);

function Form({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <PasswordField id="pw" label="Password" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" onClick={() => setValue("")}>
        Clear
      </button>
      <button type="submit">Send</button>
    </form>
  );
}

describe("PasswordField", () => {
  it("toggles the type and aria-pressed, with a fixed name and the focus kept on the button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form initial="secret" />);
    const input = screen.getByLabelText("Password");
    const show = screen.getByRole("button", { name: "Show password" });
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(show).toHaveAttribute("type", "button");
    expect(show).toHaveAttribute("aria-controls", "pw");
    expect(show).toHaveTextContent("Show");
    await user.click(show);
    expect(input).toHaveAttribute("type", "text");
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(show).toHaveAccessibleName("Show password");
    expect(show).toHaveFocus();
    await user.click(show);
    expect(input).toHaveAttribute("type", "password");
    expect(show).toHaveAttribute("aria-pressed", "false");
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form initial="secret" />);
    await user.click(screen.getByLabelText("Password"));
    await user.tab();
    expect(screen.getByRole("button", { name: "Show password" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("hides the password again when the form is submitted", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form initial="secret" />);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("hides the password again when the value is emptied", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form initial="secret" />);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("speaks French", () => {
    localStorage.setItem("yasad.language", "fr");
    renderWithProviders(<Form />);
    expect(screen.getByRole("button", { name: "Afficher le mot de passe" })).toHaveTextContent("Afficher");
  });
});
