import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { Field } from "./Field";
import { SelectField } from "./SelectField";

afterEach(cleanup);

describe("FormField", () => {
  it("shows label, hint, control and error in that order, without outer margin", () => {
    const { container } = renderWithProviders(<Field id="email" label="E-mail" hint="Your work address." error="Enter a valid e-mail address." />);
    const field = container.querySelector('[data-slot="form-field"]')!;
    expect([...field.children].map((el) => el.tagName)).toEqual(["LABEL", "P", "INPUT", "P"]);
    expect(field.className).not.toMatch(/\bm[tblrxy]?-\d/);
    expect(field.querySelector("p")).toHaveClass("text-sm");
  });

  it("describes the control by the hint, then the error, with a hidden Error prefix and an icon", () => {
    renderWithProviders(<Field id="email" label="E-mail" hint="Your work address." error="Enter a valid e-mail address." />);
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("aria-describedby", "email-hint email-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Your work address. Error: Enter a valid e-mail address.");
    const error = document.getElementById("email-error")!;
    expect(error.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(error.querySelector(".sr-only")).toHaveTextContent("Error:");
  });

  it("describes a control marked invalid without a message by the summary title", () => {
    renderWithProviders(
      <>
        <p id="form-summary-title">Wrong e-mail or password.</p>
        <Field id="email" label="E-mail" invalid describedBy="form-summary-title" />
      </>,
    );
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "form-summary-title");
    expect(input).toHaveAccessibleDescription("Wrong e-mail or password.");
  });

  it("leaves a valid control unmarked, even with a summary title", () => {
    renderWithProviders(<Field id="name" label="Name" describedBy="form-summary-title" />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-describedby");
  });

  it("builds a select field on the same rules", () => {
    renderWithProviders(
      <SelectField id="role" label="Role" error="Choose one of the listed roles." defaultValue="user">
        <option value="user">User</option>
      </SelectField>,
    );
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("Error: Choose one of the listed roles.");
  });
});
