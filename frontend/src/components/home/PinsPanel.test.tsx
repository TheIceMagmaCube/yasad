import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeCategory } from "@/api";
import { categoryTone } from "@/lib/category-tone";
import { renderWithProviders } from "@/test-utils";

import { pinnedLinks, PinsPanel } from "./PinsPanel";

afterEach(cleanup);

const link = (id: string) => ({ id, title: id.toUpperCase(), description: "", url: `https://${id}.example.invalid`, icon: null, keywords: [] });
const CATEGORIES: HomeCategory[] = [
  { id: "first", title: "First", links: [link("l1"), link("l2")] },
  { id: "second", title: "Second", links: [link("l3")] },
];
const GESTURES = { move: vi.fn(), remove: vi.fn(), isPending: () => false };

function panel(pins: string[], categories = CATEGORIES) {
  return renderWithProviders(
    <PinsPanel categories={categories} pins={pins} managing={false} onToggle={() => {}} toggleRef={{ current: null }} gestures={GESTURES} error={null} />,
  );
}

describe("pinnedLinks", () => {
  it("returns the pinned links in pins order with their category index, dropping unknown ids", () => {
    expect(pinnedLinks(CATEGORIES, ["l3", "gone", "l1"])).toEqual([
      { link: CATEGORIES[1]!.links[0], categoryIndex: 1 },
      { link: CATEGORIES[0]!.links[0], categoryIndex: 0 },
    ]);
    expect(pinnedLinks(CATEGORIES, [])).toEqual([]);
  });
});

describe("PinsPanel", () => {
  it("uses the colour of the link's current category", () => {
    // l3 moved to the first category: its marker follows it.
    const moved: HomeCategory[] = [
      { id: "first", title: "First", links: [link("l1"), link("l3")] },
      { id: "second", title: "Second", links: [link("l2")] },
    ];
    panel(["l2", "l3"], moved);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    const marker = (row: HTMLElement) => row.querySelector("[data-slot=pin-category]")!;
    expect(marker(rows[0]!).className).toContain(categoryTone(1).bar);
    expect(marker(rows[1]!).className).toContain(categoryTone(0).bar);
    expect(marker(rows[0]!)).toHaveAttribute("aria-hidden", "true");
  });

  it("shows each favourite as a link with its icon, no description", () => {
    panel(["l1"]);
    const row = within(screen.getByRole("list")).getByRole("listitem");
    expect(within(row).getByRole("link", { name: "L1" })).toHaveAttribute("href", "https://l1.example.invalid");
    expect(row.querySelector("[data-slot=link-icon]")).not.toBeNull();
    expect(row).toHaveClass("min-h-11");
  });

  it("names the toggle Manage favourites, and Done while managing", () => {
    const { rerender } = panel([]);
    const toggle = screen.getByRole("button", { name: "Manage favourites" });
    expect(toggle).toHaveAttribute("id", "pins-toggle");
    rerender(
      <PinsPanel categories={CATEGORIES} pins={[]} managing onToggle={() => {}} toggleRef={{ current: null }} gestures={GESTURES} error={null} />,
    );
    expect(screen.getByRole("button", { name: "Done, managing favourites" })).toBe(toggle);
    expect(screen.getByText("No favourites. Choose Pin on a link.")).toBeInTheDocument();
    expect(screen.queryByText("Pin the links you open often with Manage.")).toBeNull();
  });

  it("shows an error it is given, focused", () => {
    renderWithProviders(
      <PinsPanel categories={CATEGORIES} pins={["l1"]} managing onToggle={() => {}} toggleRef={{ current: null }} gestures={GESTURES} error={{ text: "Your favourites could not be saved. Try again.", n: 1 }} />,
    );
    const alert = document.querySelector("[data-slot=alert]");
    expect(alert).toHaveTextContent("Your favourites could not be saved. Try again.");
    expect(alert).toHaveFocus();
  });

  it("marks the ends aria-disabled without disabled or pendingLabel", async () => {
    const user = userEvent.setup();
    const gestures = { move: vi.fn(), remove: vi.fn(), isPending: (id: string) => id === "pin-down-l3" };
    renderWithProviders(
      <PinsPanel categories={CATEGORIES} pins={["l1", "l2", "l3"]} managing onToggle={() => {}} toggleRef={{ current: null }} gestures={gestures} error={null} />,
    );
    const up = screen.getByRole("button", { name: "Move L1 up" });
    const down = screen.getByRole("button", { name: "Move L3 down" });
    for (const end of [up, down]) {
      expect(end).toHaveAttribute("aria-disabled", "true");
      expect(end).not.toBeDisabled();
    }
    expect(up).toHaveAttribute("id", "pin-up-l1");
    expect(screen.getByRole("button", { name: "Move L1 down" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Remove L2" })).toHaveAttribute("id", "pin-remove-l2");
    // The visible words stay while pending, hidden only on narrow screens.
    expect(down).toHaveTextContent(/^Down$/);
    expect(down.querySelector(".max-sm\\:sr-only")).not.toBeNull();
    await user.click(up);
    expect(gestures.move).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Move L2 up" }));
    expect(gestures.move).toHaveBeenCalledWith("l2", "up", "pin-up-l2");
    await user.click(screen.getByRole("button", { name: "Remove L2" }));
    expect(gestures.remove).toHaveBeenCalledWith("l2");
  });

  it("has no row button outside the manage mode", () => {
    panel(["l1", "l2"]);
    expect(screen.queryByRole("button", { name: "Remove L1" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
