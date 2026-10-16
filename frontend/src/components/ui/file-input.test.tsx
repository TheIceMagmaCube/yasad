import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { FileInput } from "./file-input";

afterEach(cleanup);

const file = (name: string) => new File(["categories: []"], name, { type: "application/yaml" });

describe("FileInput", () => {
  it("says no file is chosen, translated, and describes the input with it", () => {
    localStorage.setItem("yasad.language", "fr");
    renderWithProviders(<FileInput id="catalog" label="Choisir un fichier" onFile={vi.fn()} />);
    const input = screen.getByLabelText("Choisir un fichier");
    expect(input).toHaveAccessibleDescription("Aucun fichier choisi");
  });

  it("hands over the chosen file, shows its name, and empties the input so the same file can be chosen again", async () => {
    const onFile = vi.fn();
    const { rerender } = renderWithProviders(<FileInput id="catalog" label="Choose a file" onFile={onFile} />);
    const input = screen.getByLabelText<HTMLInputElement>("Choose a file");
    await userEvent.setup().upload(input, file("catalog.yaml"));
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: "catalog.yaml" }));
    expect(input.value).toBe("");
    rerender(<FileInput id="catalog" label="Choose a file" fileName="catalog.yaml" onFile={onFile} />);
    expect(input).toHaveAccessibleDescription("catalog.yaml");
  });

  it("is never disabled while pending, ignores new files meanwhile, and shows the progress", () => {
    const onFile = vi.fn();
    renderWithProviders(<FileInput id="catalog" label="Choose a file" pending pendingLabel="Checking the file…" onFile={onFile} />);
    const input = screen.getByLabelText<HTMLInputElement>("Checking the file…");
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { files: [file("other.yaml")] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("is visually hidden before a label styled as a button that shows its focus ring", () => {
    renderWithProviders(<FileInput id="catalog" label="Choose a file" onFile={vi.fn()} />);
    const input = screen.getByLabelText("Choose a file");
    expect(input).toHaveClass("sr-only", "peer");
    const label = document.querySelector('label[for="catalog"]')!;
    expect(input.nextElementSibling).toBe(label);
    expect(label).toHaveClass("peer-focus-visible:ring-2");
  });
});
