import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeData, HomeLink } from "@/api";
import { primeHome } from "@/lib/home-store";
import { getStatus, mockApi, renderWithProviders } from "@/test-utils";

import { SearchBox } from "./SearchBox";

const KEY = "user:ada";

const link = (id: string, title: string, extra: Partial<HomeLink> = {}): HomeLink => ({
  id,
  title,
  description: "",
  url: `https://${id}.example.invalid/`,
  icon: null,
  keywords: [],
  ...extra,
});

const DATA: HomeData = {
  signedIn: true,
  categories: [
    { id: "everyday", title: "Everyday", links: [link("mail", "Mail", { keywords: ["webmail", "courrier"] }), link("chat", "Chat")] },
    { id: "docs", title: "Docs", links: [link("lists", "Mailing lists"), link("wiki", "Wiki", { description: "Team knowledge base" })] },
  ],
  empty: null,
  pins: [],
};

const MANY: HomeData = {
  signedIn: true,
  categories: [{ id: "tools", title: "Tools", links: Array.from({ length: 12 }, (_, i) => link(`t${i}`, `Tool ${i}`)) }],
  empty: null,
  pins: [],
};

let styles: HTMLStyleElement | null = null;

/** Apply the `sm:hidden` rule, as a screen at least `sm` wide does: the toggle is then not displayed. */
function wideScreen() {
  styles = document.createElement("style");
  styles.textContent = ".sm\\:hidden { display: none; }";
  document.head.append(styles);
}

type Options = { data?: HomeData | null; before?: boolean };

/** Render the search with a button before it, the home data already stored unless `data` is null. */
function setup({ data = DATA }: Options = {}) {
  if (data) primeHome(KEY, data);
  const fetchMock = mockApi({ "GET /api/home": { status: 200, body: data ?? DATA } });
  const openLink = vi.fn();
  const openInNewTab = vi.fn();
  renderWithProviders(
    <>
      <button type="button">Before</button>
      <SearchBox homeKey={KEY} openLink={openLink} openInNewTab={openInNewTab} />
    </>,
  );
  return { fetchMock, openLink, openInNewTab, input: screen.getByRole("combobox") };
}

const options = () => within(screen.getByRole("listbox", { hidden: true })).queryAllByRole("option", { hidden: true });

/** Make the browser report `platform` (jsdom reports an empty one). */
function stubPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

beforeEach(() => stubPlatform("Win32"));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  styles?.remove();
  styles = null;
  delete (navigator as { platform?: string }).platform;
});

describe("SearchBox, ARIA", () => {
  it("is a combobox controlling a listbox that always exists", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    expect(input).toHaveAccessibleName("Search links");
    expect(screen.getByRole("search", { name: "Search links" })).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("placeholder", "Search links");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    const list = document.getElementById(input.getAttribute("aria-controls")!);
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("hidden");

    await user.type(input, "zzz");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(input.getAttribute("aria-controls")!)).toBe(list);
  });

  it("selects the first option, then moves and wraps with the arrows", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(input).toHaveAttribute("aria-expanded", "true");
    const [first, second] = options();
    expect(input).toHaveAttribute("aria-activedescendant", first!.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).not.toHaveAttribute("aria-selected");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", second!.id);
    expect(first).not.toHaveAttribute("aria-selected");
    expect(second!.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", first!.id);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", second!.id);
  });

  // Forced colors mode drops box shadows, rings included, and the fill: only an outline still shows which option
  // Enter would open, and where the focus is.
  it("marks the selected option and the focused controls with an outline, which forced colors mode keeps", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[0]).toHaveClass("aria-selected:outline-2", "aria-selected:outline-solid");
    expect(options()[0]!.className).not.toMatch(/aria-selected:ring/);
    const controls = [input, screen.getByRole("button", { name: "Clear search" }), screen.getByRole("button", { name: "Search" })];
    for (const control of controls) {
      expect(control).toHaveClass("focus-visible:outline-2", "focus-visible:outline-solid");
      expect(control.className).not.toMatch(/focus-visible:ring/);
    }
  });

  it("opens a closed list with ArrowDown, and with Alt+ArrowDown without moving", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(input).toHaveAttribute("aria-expanded", "true"));
    // A Tab keydown whose default action does not run: the list closes, the focus stays.
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]!.id);

    fireEvent.keyDown(input, { key: "Tab" });
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]!.id);
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]!.id);
  });

  it("names the shortcut for the platform", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("aria-keyshortcuts", "/ Control+K");
    cleanup();
    stubPlatform("MacIntel");
    const mac = setup();
    expect(mac.input).toHaveAttribute("aria-keyshortcuts", "/ Meta+K");
  });
});

describe("SearchBox, opening links", () => {
  it("opens the active option with Enter, in a new tab with Ctrl or Cmd", async () => {
    const user = userEvent.setup();
    const { input, openLink, openInNewTab } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(openLink).toHaveBeenCalledWith("https://lists.example.invalid/");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(openInNewTab).toHaveBeenCalledTimes(2);
    expect(openInNewTab).toHaveBeenLastCalledWith("https://lists.example.invalid/");
    expect(openLink).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter without an active option", async () => {
    const user = userEvent.setup();
    const { input, openLink } = setup();
    await user.type(input, "zzz{Enter}");
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(openLink).not.toHaveBeenCalled();
  });

  it("refuses a URL that is not http or https", async () => {
    const user = userEvent.setup();
    const { input, openLink } = setup({ data: { ...DATA, categories: [{ id: "x", title: "X", links: [link("bad", "Bad", { url: "javascript:alert(1)" })] }] } });
    await user.type(input, "bad");
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(openLink).not.toHaveBeenCalled();
  });

  it("opens an option on click, in a new tab with Ctrl+click or a middle click, keeping the focus in the field", async () => {
    const user = userEvent.setup();
    const { input, openLink, openInNewTab } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    await user.click(options()[1]!);
    expect(openLink).toHaveBeenCalledWith("https://lists.example.invalid/");
    expect(input).toHaveFocus();
    await user.keyboard("{Control>}");
    await user.click(options()[0]!);
    await user.keyboard("{/Control}");
    expect(openInNewTab).toHaveBeenCalledWith("https://mail.example.invalid/");
    fireEvent(options()[0]!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(openInNewTab).toHaveBeenCalledTimes(2);
  });

  it("makes the hovered option active", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.pointerMove(options()[1]!);
    expect(input).toHaveAttribute("aria-activedescendant", options()[1]!.id);
  });

  it("keeps the list open when its container is pressed", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    const container = screen.getByRole("listbox").parentElement!;
    const pressed = fireEvent.mouseDown(container);
    expect(pressed).toBe(false);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });
});

describe("SearchBox, Escape and Tab", () => {
  it("clears, closes and gives the focus back to the element focused before '/'", async () => {
    wideScreen();
    const user = userEvent.setup();
    const { input } = setup();
    screen.getByRole("button", { name: "Before" }).focus();
    await user.keyboard("/");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    await user.keyboard("mail");
    await vi.waitFor(() => expect(input).toHaveAttribute("aria-expanded", "true"));
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("keeps the focus in the field when it was reached with Tab", async () => {
    wideScreen();
    const user = userEvent.setup();
    const { input } = setup();
    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.keyboard("mail");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("keeps the focus in the field when the element to go back to was removed", async () => {
    wideScreen();
    mockApi({ "GET /api/home": { status: 200, body: DATA } });
    primeHome(KEY, DATA);
    function Page() {
      const [shown, setShown] = useState(true);
      return (
        <>
          {shown && (
            <button type="button" onClick={() => setShown(false)}>
              Remove me
            </button>
          )}
          <SearchBox homeKey={KEY} openLink={vi.fn()} />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    const target = screen.getByRole("button", { name: "Remove me" });
    target.focus();
    await user.keyboard("/");
    act(() => target.click());
    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(input).toHaveFocus();
  });

  it("closes the list on Tab, keeps the query and lets the focus go", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(input).toHaveAttribute("aria-expanded", "true"));
    await user.tab();
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue("mail");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("clears with the clear button and focuses the field again", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await user.type(input, "mail");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});

describe("SearchBox, global shortcuts", () => {
  it("focuses the field with '/' without typing it", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.keyboard("/");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
  });

  it.each([
    ["Ctrl+K", { key: "k", code: "KeyK", ctrlKey: true }],
    ["Cmd+K", { key: "k", code: "KeyK", metaKey: true }],
    ["Ctrl+K on a Cyrillic layout", { key: "л", code: "KeyK", ctrlKey: true }],
    ["Shift+/ (AZERTY)", { key: "/", code: "Period", shiftKey: true }],
  ])("focuses the field with %s", (_name, init) => {
    const { input } = setup();
    const event = fireEvent.keyDown(document.body, init);
    expect(event).toBe(false);
    expect(input).toHaveFocus();
  });

  it("selects the field's text on Ctrl+K inside it, and types '/' there", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "ma/il");
    expect(input).toHaveValue("ma/il");
    await user.keyboard("{Control>}k{/Control}");
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(5);
  });

  it("leaves other fields, menus and modified keys alone", () => {
    const { input } = setup();
    const field = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.tabIndex = -1;
    menu.append(item);
    document.body.append(field, area, editable, menu);
    try {
      for (const target of [field, area, editable, item]) {
        for (const init of [{ key: "/" }, { key: "k", code: "KeyK", ctrlKey: true }]) {
          expect(fireEvent.keyDown(target, init), `${target.tagName} ${init.key}`).toBe(true);
          expect(input).not.toHaveFocus();
        }
      }
      for (const init of [
        { key: "k", code: "KeyK", ctrlKey: true, altKey: true },
        { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true },
        { key: "k", code: "KeyK", ctrlKey: true, metaKey: true },
        { key: "/", altKey: true },
        { key: "/", ctrlKey: true },
        { key: "/", isComposing: true },
        { key: "/", keyCode: 229 },
        { key: "/", repeat: true },
      ]) {
        expect(fireEvent.keyDown(document.body, init)).toBe(true);
        expect(input).not.toHaveFocus();
      }
    } finally {
      field.remove();
      area.remove();
      editable.remove();
      menu.remove();
    }
  });
});

describe("SearchBox, IME", () => {
  it("ignores ArrowDown, Enter and Escape while composing", async () => {
    const user = userEvent.setup();
    const { input, openLink } = setup();
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    const active = input.getAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 229 });
    expect(input).toHaveAttribute("aria-activedescendant", active!);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(openLink).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(input).toHaveValue("mail");
  });
});

describe("SearchBox, status region", () => {
  /** Type into the field the way a change event does (user-event waits on timers the test fakes). */
  const typeIn = (input: HTMLElement, value: string) => act(() => void fireEvent.change(input, { target: { value } }));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("announces the count 300 ms after typing, and empties when the query does", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { input } = setup();
    const status = getStatus();
    expect(status).toBeEmptyDOMElement();
    act(() => input.focus());
    typeIn(input, "mail");
    wait(299);
    expect(status).toBeEmptyDOMElement();
    wait(1);
    expect(status).toHaveTextContent("2 results");
    typeIn(input, "mailzz");
    expect(status).toBeEmptyDOMElement();
    wait(300);
    expect(status).toHaveTextContent("No results");
    typeIn(input, "");
    expect(status).toBeEmptyDOMElement();
    typeIn(input, "wiki");
    wait(300);
    expect(status).toHaveTextContent("1 result");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(status).toBeEmptyDOMElement();
  });

  it("says how many are shown when there are more than 8, in the list footer too", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { input } = setup({ data: MANY });
    act(() => input.focus());
    typeIn(input, "tool");
    wait(300);
    expect(getStatus()).toHaveTextContent("Showing 8 of 12. Type more to narrow down.");
    expect(options()).toHaveLength(8);
    // The status region and the visible footer under the list.
    expect(screen.getAllByText("Showing 8 of 12. Type more to narrow down.")).toHaveLength(2);
  });
});

describe("SearchBox, loading and errors", () => {
  it("keeps the query while the links load, then shows the results with the first one active", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<SearchBox homeKey={KEY} openLink={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "mail");
    expect(screen.getByText("Loading links")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => release(new Response(JSON.stringify(DATA), { status: 200 })));
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(input).toHaveValue("mail");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]!.id);
  });

  it("shows an error, and retries on Enter or when the query changes", async () => {
    const failing = mockApi({ "GET /api/home": { status: 500, body: { error: { code: "internal_error", message: "" } } } });
    const user = userEvent.setup();
    renderWithProviders(<SearchBox homeKey={KEY} openLink={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "m");
    const error = "Links could not be loaded. Press Enter or change the search to try again.";
    expect(await screen.findByText(error)).toBeInTheDocument();
    const calls = failing.mock.calls.length;
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(calls + 1));
    expect(await screen.findByText(error)).toBeInTheDocument();

    const working = mockApi({ "GET /api/home": { status: 200, body: DATA } });
    await user.keyboard("a");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(working).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("ma");
  });

  it("says when no link matches, with the query as text", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "<b>zzz</b>");
    expect(await screen.findByText("No link matches <b>zzz</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("refreshes the links when the field gets the focus, keeping the active link", async () => {
    const user = userEvent.setup();
    const { input, fetchMock } = setup();
    await user.click(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.type(input, "mail");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    await user.keyboard("{ArrowDown}");
    act(() => primeHome(KEY, { ...DATA, categories: [...DATA.categories].reverse() }));
    await vi.waitFor(() => expect(options()[0]).toHaveTextContent("Mailing lists"));
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]!.id);
  });
});

describe("SearchBox, small screens", () => {
  it("shows the field with the toggle, and Escape folds it back onto the toggle", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    const toggle = screen.getByRole("button", { name: "Search" });
    const area = screen.getByRole("search");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", area.id);
    expect(area).toHaveAttribute("data-state", "closed");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(area).toHaveAttribute("data-state", "open");
    expect(input).toHaveFocus();
    await user.keyboard("mail{Escape}");
    expect(input).toHaveValue("");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("folds on a second press of the toggle, and when the focus leaves with an empty query", async () => {
    const user = userEvent.setup();
    setup();
    const toggle = screen.getByRole("button", { name: "Search" });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Before" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    await user.keyboard("mail");
    await user.click(screen.getByRole("button", { name: "Before" }));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("folds on a second press of the toggle when the field blurs towards nothing first, as in Safari", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    const toggle = screen.getByRole("button", { name: "Search" });
    await user.click(toggle);
    expect(input).toHaveFocus();
    fireEvent.pointerDown(toggle);
    // The press keeps the focus in the field; Safari, which never focuses a button, would blur towards nothing.
    expect(fireEvent.mouseDown(toggle)).toBe(false);
    fireEvent.focusOut(input, { relatedTarget: null });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});

describe("SearchBox, results", () => {
  it("shows the category, the matching keyword and highlights, and names options title first", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "mail cour");
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    const [option] = options();
    expect(option).toHaveAccessibleName("Mail, Everyday, Keyword: courrier");
    // Its text has the name's words with spaces between the parts, as axe compares them (WCAG 2.5.3).
    expect(option!.textContent).toBe("Mail Everyday Keyword: courrier");
    expect(within(option!).getByText("Everyday")).toBeInTheDocument();
    expect([...option!.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["Mail", "cour"]);
    expect(option!.querySelector("a, button, input")).toBeNull();
  });

  it("shows a description extract when only the description matches", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "knowledge");
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]).toHaveAccessibleName("Wiki, Docs, Team knowledge base");
    expect(options()[0]!.querySelector("mark")).toHaveTextContent("knowledge");
  });

  it("translates its texts", async () => {
    localStorage.setItem("yasad.language", "fr");
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole("combobox", { name: "Rechercher un lien" });
    expect(screen.getByRole("search", { name: "Rechercher un lien" })).toBeInTheDocument();
    await user.type(input, "mail cour");
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]).toHaveAccessibleName("Mail, Everyday, Mot-clé : courrier");
  });
});
