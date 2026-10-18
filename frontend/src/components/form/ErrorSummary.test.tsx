import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { useFormErrors } from "../../lib/form-errors";
import { renderWithProviders } from "../../test-utils";
import { ErrorSummary } from "./ErrorSummary";
import { Field } from "./Field";

afterEach(cleanup);

type Errors = ReturnType<typeof useFormErrors<"name" | "code">>;

function Form({ onReady, labels }: { onReady: (errors: Errors) => void; labels?: { name?: string } }) {
  const errors = useFormErrors(["name", "code"] as const, "f");
  onReady(errors);
  return (
    <form noValidate>
      <ErrorSummary errors={errors} labels={labels} />
      <Field label="Name" defaultValue="" {...errors.field("name")} />
      <Field label="Code" defaultValue="wrong-code" data-select-on-error="" {...errors.field("code")} />
    </form>
  );
}

function setup(labels?: { name?: string }) {
  let errors!: Errors;
  const view = renderWithProviders(<Form onReady={(e) => (errors = e)} labels={labels} />);
  return { view, errors: () => errors };
}

describe("ErrorSummary", () => {
  it("renders nothing without errors", () => {
    setup();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("takes the focus as a group named by its title, with a link to each field in display order", async () => {
    const { errors } = setup();
    act(() => errors().fail("Check the highlighted fields.", { code: "Bad code.", name: "Required." }));
    const summary = screen.getByRole("group", { name: "Check the highlighted fields." });
    expect(summary).toHaveFocus();
    expect(within(summary).getAllByRole("link").map((a) => a.textContent)).toEqual(["Required.", "Bad code."]);
    expect(within(summary).getAllByRole("link")[0]).toHaveAttribute("href", "#f-name");
  });

  it("starts each field problem with the label it is given, but not a link of its own", () => {
    const { errors } = setup({ name: "Name" });
    act(() => errors().fail("Check.", { name: "Required.", code: "Required." }, { links: [{ field: "name", message: "Type the name again." }] }));
    expect(within(screen.getByRole("group")).getAllByRole("link").map((a) => a.textContent)).toEqual(["Name: Required.", "Required.", "Type the name again."]);
  });

  it("drops a field from the summary, and the summary once nothing is left", () => {
    const { errors } = setup();
    act(() => errors().fail("Check.", { name: "Required.", code: "Bad code." }));
    act(() => errors().clear("code"));
    expect(within(screen.getByRole("group")).getAllByRole("link").map((a) => a.textContent)).toEqual(["Required."]);
    act(() => errors().clear("name"));
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("focuses the field from its link and selects the text of a field that asks for it", async () => {
    const { errors } = setup();
    act(() => errors().fail("Check the highlighted fields.", { code: "Bad code." }));
    await userEvent.setup().click(screen.getByRole("link", { name: "Bad code." }));
    const code = screen.getByLabelText("Code") as HTMLInputElement;
    expect(code).toHaveFocus();
    expect(code.value.slice(code.selectionStart!, code.selectionEnd!)).toBe("wrong-code");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("takes the focus again on a new failure with the same text", async () => {
    const { errors } = setup();
    act(() => errors().fail("Something went wrong."));
    screen.getByLabelText("Name").focus();
    act(() => errors().fail("Something went wrong."));
    expect(screen.getByRole("group", { name: "Something went wrong." })).toHaveFocus();
  });

  it("shows only the title for a general error, and lists entries without a field as plain text", async () => {
    const { errors } = setup();
    act(() => errors().fail("Something went wrong."));
    expect(within(screen.getByRole("group")).queryByRole("list")).toBeNull();
    act(() => errors().fail("Check the highlighted fields.", {}, { extra: ["Unknown problem."] }));
    const item = within(screen.getByRole("group")).getByRole("listitem");
    expect(item).toHaveTextContent("Unknown problem.");
    expect(within(item).queryByRole("link")).toBeNull();
  });
});
